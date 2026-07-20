import { Directory, File, Paths } from 'expo-file-system'

// Private media (cash-handover proofs, etc.) is served through short-lived
// HMAC-signed URLs that get a fresh signature — and therefore a different
// URL string — on every fetch (see internal/media.Service.SignedURL). A
// cache keyed by URL would never hit. This caches by the media asset's own
// stable ID instead, so the same photo is only ever downloaded once per
// device, even across app restarts.
const cacheDir = new Directory(Paths.cache, 'media-cache')

function ensureCacheDir() {
  if (!cacheDir.exists) {
    cacheDir.create({ intermediates: true, idempotent: true })
  }
}

function safeKey(key) {
  return String(key).replace(/[^a-zA-Z0-9._-]/g, '_')
}

// Dedupes concurrent requests for the same key so two components rendering
// the same photo at once don't both start a download.
const inFlight = new Map()

/**
 * Returns a local file:// URI for remoteUrl, downloading it once per key and
 * reusing the cached file on every later call. Falls back to remoteUrl
 * itself if the download fails, so a transient network error never blocks
 * rendering.
 */
export async function getCachedImageUri(key, remoteUrl) {
  if (!key || !remoteUrl) return remoteUrl

  ensureCacheDir()
  const file = new File(cacheDir, `${safeKey(key)}.img`)
  if (file.exists) return file.uri

  if (!inFlight.has(file.uri)) {
    inFlight.set(
      file.uri,
      File.downloadFileAsync(remoteUrl, file, { idempotent: true })
        .then((downloaded) => downloaded.uri)
        .catch(() => remoteUrl)
        .finally(() => inFlight.delete(file.uri))
    )
  }
  return inFlight.get(file.uri)
}
