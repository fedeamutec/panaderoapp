const CACHE_VERSION = 'panadero-shell-2026-10-15-1'
const CORE_FILES = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/pwa-icon-192.png',
  '/pwa-icon-512.png',
]

async function cacheCurrentApplication() {
  const cache = await caches.open(CACHE_VERSION)
  const response = await fetch('/', { cache: 'reload' })
  if (!response.ok) throw new Error('No se pudo preparar Panadero para usarlo sin conexión.')

  const html = await response.clone().text()
  await cache.put('/', response.clone())
  await cache.put('/index.html', response)

  const assets = [...html.matchAll(/(?:src|href)="([^"#]+)"/g)]
    .map((match) => new URL(match[1], self.location.origin))
    .filter((url) => url.origin === self.location.origin)
    .map((url) => `${url.pathname}${url.search}`)

  const files = [...new Set([...CORE_FILES, ...assets])]
  await Promise.allSettled(files.map(async (file) => {
    if (file === '/' || file === '/index.html') return
    const assetResponse = await fetch(file, { cache: 'reload' })
    if (assetResponse.ok) await cache.put(file, assetResponse)
  }))
}

self.addEventListener('install', (event) => {
  event.waitUntil(cacheCurrentApplication().then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys()
    await Promise.all(names.filter((name) => name.startsWith('panadero-shell-') && name !== CACHE_VERSION).map((name) => caches.delete(name)))
    await self.clients.claim()
  })())
})

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request)
        if (response.ok) {
          const cache = await caches.open(CACHE_VERSION)
          await cache.put('/', response.clone())
          await cache.put('/index.html', response.clone())
        }
        return response
      } catch {
        return (await caches.match('/')) || (await caches.match('/index.html'))
      }
    })())
    return
  }

  event.respondWith((async () => {
    const cached = await caches.match(request)
    if (cached) return cached
    try {
      const response = await fetch(request)
      if (response.ok) {
        const cache = await caches.open(CACHE_VERSION)
        await cache.put(request, response.clone())
      }
      return response
    } catch {
      return new Response('', { status: 503, statusText: 'Sin conexión' })
    }
  })())
})
