/**
 * Shared client-side plumbing for the live feeds (Music, Movies,
 * Memos, Tokens): a sessionStorage TTL cache, JSON fetching with a
 * timeout, URL sanitizing for remote payloads, and the site's display
 * time zone. Imported from component <script> blocks, so everything
 * here must be browser-safe.
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

function readCache<T>(
  key: string,
  valid: (data: unknown) => boolean,
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

function writeCache(key: string, data: unknown) {
  try {
    sessionStorage.setItem(key, JSON.stringify({ t: Date.now(), data }))
  } catch {
    // Storage full or unavailable (e.g. private mode) — cache is optional.
  }
}

/**
 * Wraps a loader in the sessionStorage cache so quick revisits skip the
 * network. `valid` is the feed's payload decoder: it gates both cache
 * reads (stale shape from an older deploy) and fresh responses (a
 * misbehaving endpoint), so nothing unvalidated is ever cached or
 * handed to a renderer — a bad payload rejects into the feed's
 * fallback UI instead.
 */
export function cached<T>(
  key: string,
  load: () => Promise<T>,
  valid: (data: unknown) => boolean,
): Promise<T> {
  const hit = readCache<T>(key, valid)
  if (hit) return Promise.resolve(hit)
  return load().then((data) => {
    if (!valid(data)) throw new Error("Unexpected payload shape")
    writeCache(key, data)
    return data
  })
}

/**
 * Remote feed payloads (Letterboxd diary entries, Mastodon statuses)
 * supply hrefs and image URLs that get written straight into the DOM.
 * This is the trust boundary: anything that isn't plain http(s) —
 * javascript:, data:, blob:, malformed — comes back as null and must
 * not render.
 */
export function safeHttpUrl(url: unknown): string | null {
  if (typeof url !== "string") return null
  try {
    const parsed = new URL(url)
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? parsed.href
      : null
  } catch {
    return null
  }
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
