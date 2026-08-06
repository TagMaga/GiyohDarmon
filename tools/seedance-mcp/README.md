# seedance-mcp

A small MCP (Model Context Protocol) server that exposes ByteDance's
**Seedance 2.5** video generation model as tools Claude can call directly —
`generate_video`, `check_video_status`, and `generate_video_and_wait`.

This is a standalone tool, unrelated to the MegaMall CRM app in this repo —
it lives under `tools/` so it's easy to copy out or run independently.

## 1. Get API access

Seedance 2.5 isn't called directly — it's served through ByteDance's cloud
platforms:

- **BytePlus ModelArk** (international) — https://www.byteplus.com/en/product/seedance
- **Volcengine Ark** (China) — https://www.volcengine.com/product/doubao

Sign up, create an API key, and note which base URL applies to your account
(see `.env.example`). Model IDs and optional-parameter field names can shift
between Ark model versions — if a call fails with a 4xx about an unknown
field, check the current BytePlus docs at
https://docs.byteplus.com/en/docs/ModelArk/1520757 and adjust
`buildTaskBody()` in `src/index.js` accordingly.

## 2. Install

```bash
cd tools/seedance-mcp
npm install
cp .env.example .env   # then fill in SEEDANCE_API_KEY
```

## 3. Register it with Claude Code

Run this once, from anywhere, to add it as a user-level MCP server (available
in every Claude Code session, not just this repo):

```bash
claude mcp add seedance \
  --scope user \
  --env SEEDANCE_API_KEY=your_key_here \
  --env SEEDANCE_BASE_URL=https://ark.ap-southeast.bytepluses.com/api/v3 \
  --env SEEDANCE_MODEL=seedance-2-5-pro \
  -- node /absolute/path/to/tools/seedance-mcp/src/index.js
```

(Swap in the actual absolute path after cloning this repo locally, and the
Volcengine base URL instead if you're on a China account.)

Alternatively, add it by hand to your user-level Claude config
(`~/.claude.json`, under `"mcpServers"`):

```json
{
  "mcpServers": {
    "seedance": {
      "command": "node",
      "args": ["/absolute/path/to/tools/seedance-mcp/src/index.js"],
      "env": {
        "SEEDANCE_API_KEY": "your_key_here",
        "SEEDANCE_BASE_URL": "https://ark.ap-southeast.bytepluses.com/api/v3",
        "SEEDANCE_MODEL": "seedance-2-5-pro"
      }
    }
  }
}
```

Restart Claude Code, and the three tools above will be available in every
session.

## 4. Test it standalone

```bash
SEEDANCE_API_KEY=your_key node src/index.js
```

It talks MCP over stdio, so it won't print anything interactive — use the
Claude Code integration to actually exercise it, or the
[MCP inspector](https://modelcontextprotocol.io/docs/tools/inspector).

## Notes

- Video generation is asynchronous: `generate_video` returns a `task_id`
  right away; poll with `check_video_status`, or use
  `generate_video_and_wait` to block until it's ready (default timeout 300s).
- This server does not download or store videos — it returns whatever URL
  Ark hands back, which is typically time-limited, so fetch it promptly.
