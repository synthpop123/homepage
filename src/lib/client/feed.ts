/**
 * Shared client-side plumbing for the live feeds (Music, Movies,
 * Memos, Tokens): a sessionStorage cache with two reading disciplines
 * (TTL for the leisurely feeds, stale-while-revalidate for the
 * freshness-critical one), JSON fetching with a timeout, URL sanitizing
 * for remote payloads, the decoder primitives every payload validator
 * is built from, and the site's display time zone. Imported from
 * component <script> blocks, so everything here must be browser-safe.
 */

/* Decoder primitives -------------------------------------------------- */

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/** A finite number — every count and cost the payloads carry (costs may
 *  be fractional, so this is not an integer check). */
export const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value)

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** A calendar day as the workers spell it, `YYYY-MM-DD`. */
export const isCalendarDay = (value: unknown): value is string =>
  typeof value === "string" && DATE_RE.test(value)

/* Session cache --------------------------------------------------------- */

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
  maxAge = CACHE_TTL,
): T | null {
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) return null
    const { t, data } = JSON.parse(raw)
    if (Date.now() - t > maxAge) return null
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
 * Stale-while-revalidate over the same cache, for a feed whose endpoint
 * revalidates cheaply (the tokens collector serves `no-cache` + ETag,
 * so an unchanged payload costs a ~0-byte 304): any cached copy paints
 * immediately regardless of age, while a fetch runs regardless of the
 * cache and hands the network's answer to the same callback — deciding
 * whether it actually changed is the caller's business. `valid` gates
 * both deliveries, exactly as in `cached`. The cached paint is fenced:
 * if rendering the stale copy throws, the failure must not abort the
 * revalidation — the network answer is exactly what recovers from a
 * bad cache. Rejects only when there is nothing on screen at all (no
 * usable cached paint and the network delivery failed too); once
 * painted, a failed refresh keeps the stale data visible, which beats
 * swapping it for a fallback message.
 */
export async function swr<T>(
  key: string,
  load: () => Promise<T>,
  valid: (data: unknown) => boolean,
  onData: (data: T) => void,
): Promise<void> {
  const hit = readCache<T>(key, valid, Number.POSITIVE_INFINITY)
  let painted = false
  if (hit) {
    try {
      onData(hit)
      painted = true
    } catch {
      // A stale copy the renderer chokes on is as good as no cache.
    }
  }
  try {
    const data = await load()
    if (!valid(data)) throw new Error("Unexpected payload shape")
    writeCache(key, data)
    onData(data)
  } catch (error) {
    if (!painted) throw error
  }
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
