/**
 * Shared client-side plumbing for the live feeds (Music, Movies,
 * Mastodon, GitHub): a sessionStorage TTL cache, JSON fetching with a
 * timeout, and the site's display time zone. Imported from component <script>
 * blocks, so everything here must be browser-safe.
 */

const CACHE_TTL = 60_000

export const TIME_ZONE = "Asia/Shanghai"

/** "Jun 21, 2026" — the shared date style for feed entries. */
export const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: TIME_ZONE,
})

export function readCache<T>(
  key: string,
  valid: (data: unknown) => boolean = Array.isArray,
): T | null {
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) return null
    const { t, data } = JSON.parse(raw)
    if (Date.now() - t > CACHE_TTL) return null
    return valid(data) ? (data as T) : null
  } catch {
    return null
  }
}

export function writeCache(key: string, data: unknown) {
  try {
    sessionStorage.setItem(key, JSON.stringify({ t: Date.now(), data }))
  } catch {
    // Storage full or unavailable (e.g. private mode) — cache is optional.
  }
}

/** Wraps a loader in readCache/writeCache so quick revisits skip the network. */
export function cached<T>(
  key: string,
  load: () => Promise<T>,
  valid?: (data: unknown) => boolean,
): Promise<T> {
  const hit = readCache<T>(key, valid)
  if (hit) return Promise.resolve(hit)
  return load().then((data) => {
    writeCache(key, data)
    return data
  })
}

/**
 * The timeout guards against a hanging instance: an outright failure
 * already rejects, but a stalled connection would otherwise leave the
 * skeleton pulsing until the browser gives up.
 */
export function fetchJson<T>(url: string, timeoutMs = 10_000): Promise<T> {
  return fetch(url, { signal: AbortSignal.timeout(timeoutMs) }).then(
    (response) => {
      if (!response.ok) throw new Error(`Request failed: ${response.status}`)
      return response.json() as Promise<T>
    },
  )
}
