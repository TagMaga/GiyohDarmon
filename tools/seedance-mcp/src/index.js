#!/usr/bin/env node
// MCP server that wraps ByteDance's Seedance video generation API (served via
// BytePlus ModelArk internationally, or Volcengine Ark in China).
//
// Docs: https://docs.byteplus.com/en/docs/ModelArk/1520757 (create task)
//       https://docs.byteplus.com/en/docs/ModelArk/1099455 (overview)
//
// The exact JSON field names for optional parameters (resolution, ratio,
// duration, seed, audio) have shifted across Ark model versions and are not
// publicly fetchable from this environment, so this server sends them as
// top-level fields AND is defensive when parsing the response. If BytePlus
// rejects a field, check their current docs and adjust buildTaskBody().

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const API_KEY = process.env.SEEDANCE_API_KEY;
const BASE_URL = (
  process.env.SEEDANCE_BASE_URL || "https://ark.ap-southeast.bytepluses.com/api/v3"
).replace(/\/+$/, "");
const MODEL = process.env.SEEDANCE_MODEL || "seedance-2-5-pro";

if (!API_KEY) {
  console.error(
    "[seedance-mcp] SEEDANCE_API_KEY is not set. The server will start, but every tool call will fail until it's configured."
  );
}

function buildTaskBody({ prompt, image_url, duration, resolution, ratio, seed, generate_audio }) {
  const content = [{ type: "text", text: prompt }];
  if (image_url) {
    content.push({ type: "image_url", image_url: { url: image_url } });
  }
  const body = { model: MODEL, content };
  if (duration !== undefined) body.duration = duration;
  if (resolution !== undefined) body.resolution = resolution;
  if (ratio !== undefined) body.ratio = ratio;
  if (seed !== undefined) body.seed = seed;
  if (generate_audio !== undefined) body.generate_audio = generate_audio;
  return body;
}

async function arkFetch(path, options = {}) {
  if (!API_KEY) {
    throw new Error(
      "SEEDANCE_API_KEY is not set. Export it in the environment that launches this MCP server."
    );
  }
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`Ark API ${res.status} ${res.statusText}: ${JSON.stringify(json)}`);
  }
  return json;
}

function extractTaskId(json) {
  return json.id || json.task_id || json.data?.id || null;
}

function extractStatus(json) {
  return json.status || json.task_status || json.data?.status || "unknown";
}

function extractVideoUrl(json) {
  return (
    json.content?.video_url ||
    json.video?.url ||
    json.output?.video_url ||
    json.data?.video_url ||
    json.result?.video_url ||
    null
  );
}

async function createVideoTask(args) {
  const body = buildTaskBody(args);
  const json = await arkFetch("/contents/generations/tasks", {
    method: "POST",
    body: JSON.stringify(body),
  });
  const taskId = extractTaskId(json);
  if (!taskId) {
    throw new Error(
      `Task created but no task id found in response, inspect manually: ${JSON.stringify(json)}`
    );
  }
  return { taskId, raw: json };
}

async function getVideoTask(taskId) {
  const json = await arkFetch(`/contents/generations/tasks/${encodeURIComponent(taskId)}`, {
    method: "GET",
  });
  return {
    taskId,
    status: extractStatus(json),
    videoUrl: extractVideoUrl(json),
    raw: json,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const TOOLS = [
  {
    name: "generate_video",
    description:
      "Submit a Seedance 2.5 video generation task (text-to-video, or image-to-video if image_url is given). Returns immediately with a task_id — the video is not ready yet. Use check_video_status to poll it, or generate_video_and_wait to block until it's done.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Text description of the video to generate." },
        image_url: {
          type: "string",
          description: "Optional URL of a reference/first-frame image for image-to-video generation.",
        },
        duration: { type: "number", description: "Optional video duration in seconds." },
        resolution: { type: "string", description: "Optional resolution, e.g. '720p' or '1080p'." },
        ratio: { type: "string", description: "Optional aspect ratio, e.g. '16:9', '9:16', '1:1'." },
        seed: { type: "number", description: "Optional seed for reproducibility." },
        generate_audio: { type: "boolean", description: "Optional: whether to generate native audio." },
      },
      required: ["prompt"],
    },
  },
  {
    name: "check_video_status",
    description: "Check the status of a previously submitted Seedance video task, and get the video URL once it's done.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "The task id returned by generate_video." },
      },
      required: ["task_id"],
    },
  },
  {
    name: "generate_video_and_wait",
    description:
      "Submit a Seedance video generation task and poll until it succeeds or fails, returning the final video URL. Convenience wrapper around generate_video + check_video_status. May take up to a few minutes.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Text description of the video to generate." },
        image_url: { type: "string", description: "Optional reference/first-frame image URL." },
        duration: { type: "number", description: "Optional video duration in seconds." },
        resolution: { type: "string", description: "Optional resolution, e.g. '720p' or '1080p'." },
        ratio: { type: "string", description: "Optional aspect ratio, e.g. '16:9', '9:16', '1:1'." },
        seed: { type: "number", description: "Optional seed for reproducibility." },
        generate_audio: { type: "boolean", description: "Optional: whether to generate native audio." },
        max_wait_seconds: {
          type: "number",
          description: "Max time to poll before giving up (default 300).",
        },
      },
      required: ["prompt"],
    },
  },
];

const server = new Server(
  { name: "seedance-video", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  try {
    if (name === "generate_video") {
      const { taskId } = await createVideoTask(args);
      return {
        content: [
          {
            type: "text",
            text: `Submitted. task_id=${taskId}\nPoll it with check_video_status.`,
          },
        ],
      };
    }

    if (name === "check_video_status") {
      const result = await getVideoTask(args.task_id);
      return {
        content: [
          {
            type: "text",
            text:
              `status=${result.status}` +
              (result.videoUrl ? `\nvideo_url=${result.videoUrl}` : "") +
              `\nraw=${JSON.stringify(result.raw)}`,
          },
        ],
      };
    }

    if (name === "generate_video_and_wait") {
      const maxWaitMs = (args.max_wait_seconds ?? 300) * 1000;
      const { taskId } = await createVideoTask(args);
      const deadline = Date.now() + maxWaitMs;
      let delay = 3000;
      while (Date.now() < deadline) {
        const result = await getVideoTask(taskId);
        if (result.status === "succeeded" || result.videoUrl) {
          return {
            content: [
              { type: "text", text: `Done. task_id=${taskId}\nvideo_url=${result.videoUrl}` },
            ],
          };
        }
        if (result.status === "failed" || result.status === "error") {
          return {
            content: [
              {
                type: "text",
                text: `Task failed. task_id=${taskId}\nraw=${JSON.stringify(result.raw)}`,
              },
            ],
            isError: true,
          };
        }
        await sleep(delay);
        delay = Math.min(delay * 1.5, 15000);
      }
      return {
        content: [
          {
            type: "text",
            text: `Timed out after ${maxWaitMs / 1000}s waiting for task_id=${taskId}. It may still finish — poll it with check_video_status.`,
          },
        ],
        isError: true,
      };
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (err) {
    return {
      content: [{ type: "text", text: `Error: ${err.message}` }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[seedance-mcp] server running on stdio");
