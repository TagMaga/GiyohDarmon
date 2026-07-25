import React from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import Providers from './app/providers'
import router   from './app/router'
import './styles/index.css'

// After a new deploy, an already-open tab can still hold a route that lazy-
// loads a JS chunk whose hashed filename no longer exists (the build replaced
// it). Reload once to pick up the current build instead of showing the error
// screen; the reload guard avoids looping if the fetch keeps failing.
function isStaleChunkError(message) {
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i.test(message || '')
}

function reloadOnceForStaleChunk() {
  const key = 'stale-chunk-reload-at'
  const lastReload = Number(sessionStorage.getItem(key) || 0)
  if (Date.now() - lastReload < 10_000) return // already just tried, avoid a loop
  sessionStorage.setItem(key, String(Date.now()))
  window.location.reload()
}

window.addEventListener('vite:preloadError', () => reloadOnceForStaleChunk())
window.addEventListener('unhandledrejection', (event) => {
  if (isStaleChunkError(event.reason?.message)) reloadOnceForStaleChunk()
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Providers>
      <RouterProvider router={router} future={{ v7_startTransition: true }} />
    </Providers>
  </React.StrictMode>
)
