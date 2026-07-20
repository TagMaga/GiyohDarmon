import { useEffect, useState } from 'react'
import { Image } from 'react-native'
import { getCachedImageUri } from '../api/imageCache'

// Renders uri like a plain <Image>, but persists it to local device storage
// keyed by cacheKey (a stable ID — NOT the possibly-signed uri) so a later
// mount, even after the app was fully closed and reopened, reuses the
// downloaded file instead of hitting the network again. Renders uri
// directly while the cache lookup/download is in flight (and forever, if
// cacheKey is missing or the download fails), so there's no blank flash on
// first view.
export default function CachedImage({ uri, cacheKey, style, ...props }) {
  const [source, setSource] = useState(uri)

  useEffect(() => {
    let cancelled = false
    setSource(uri)
    if (!uri || !cacheKey) return undefined
    getCachedImageUri(cacheKey, uri).then((cachedUri) => {
      if (!cancelled && cachedUri) setSource(cachedUri)
    })
    return () => { cancelled = true }
  }, [uri, cacheKey])

  if (!source) return null
  return <Image source={{ uri: source }} style={style} {...props} />
}
