/**
 * Shared client-side plumbing for the live feeds (Music, Movies,
 * Memos, Tokens, Switch): a Web Storage cache with two reading
 * disciplines (a short TTL in sessionStorage for the leisurely feeds,
 * stale-while-revalidate over localStorage for the freshness-critical
 * ones), JSON fetching with a timeout, URL sanitizing for remote
 * payloads, the decoder primitives every payload validator is built
 * from, and the site's display time zone. Imported from component
 * <script> blocks, so everything here must be browser-safe.
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

/** Either Web Storage area; resolved lazily because merely touching
 *  `localStorage` can throw under some privacy settings. */
type Area = "sessionStorage" | "localStorage"

const storage = (area: Area): Storage | null => {
  try {
    return globalThis[area] ?? null
  } catch {
    return null
  }
}

function readCache<T>(
  area: Area,
  key: string,
  valid: (data: unknown) => boolean,
  maxAge = CACHE_TTL,
): T | null {
  try {
    const raw = storage(area)?.getItem(key)
    if (!raw) return null
    const { t, data } = JSON.parse(raw)
    if (Date.now() - t > maxAge) return null
    return valid(data) ? (data as T) : null
  } catch {
    return null
  }
}

function writeCache(area: Area, key: string, data: unknown) {
  try {
    storage(area)?.setItem(key, JSON.stringify({ t: Date.now(), data }))
  } catch {
    // Storage full or unavailable (e.g. private mode) — cache is optional.
  }
}

/**
 * A cache key names its feed, its schema version and its endpoint —
 * `tokens:site:v14:https://…` — so a deploy that bumps the version
 * writes a new key and never reads the previous build's entry. In
 * sessionStorage the old entry died with the tab; in localStorage it
 * would outlive every deploy, so the writer sweeps its own family:
 * every key of the same feed under any other version.
 */
function evictSiblings(area: Area, key: string) {
  const family = key.replace(/:v\d+:.*$/, ":v")
  if (family === key) return
  try {
    const store = storage(area)
    if (!store) return
    for (let i = store.length - 1; i >= 0; i--) {
      const other = store.key(i)
      if (other && other !== key && other.startsWith(family)) {
        store.removeItem(other)
      }
    }
  } catch {
    // Same footing as writeCache: a sweep that fails costs disk, not data.
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
  const hit = readCache<T>("sessionStorage", key, valid)
  if (hit) return Promise.resolve(hit)
  return load().then((data) => {
    if (!valid(data)) throw new Error("Unexpected payload shape")
    writeCache("sessionStorage", key, data)
    return data
  })
}

/**
 * Stale-while-revalidate, for a feed whose endpoint revalidates cheaply
 * (the tokens collector serves `no-cache` + ETag, so an unchanged
 * payload costs a ~0-byte 304): any cached copy paints immediately
 * regardless of age, while a fetch runs regardless of the cache and
 * hands the network's answer to the same callback — deciding whether
 * it actually changed is the caller's business.
 *
 * The cache is localStorage, not the session cache `cached` uses: this
 * discipline already accepts a copy of any age, so there is no reason
 * to forget it when the tab closes — a new tab or next week's visit
 * paints from the last payload instead of from skeletons, and the
 * revalidation that follows is the same one a same-tab revisit makes.
 *
 * `valid` gates both deliveries, exactly as in `cached`. The cached
 * paint is fenced: if rendering the stale copy throws, the failure must
 * not abort the revalidation — the network answer is exactly what
 * recovers from a bad cache. Rejects only when there is nothing on
 * screen at all (no usable cached paint and the network delivery failed
 * too); once painted, a failed refresh keeps the stale data visible,
 * which beats swapping it for a fallback message.
 */
export async function swr<T>(
  key: string,
  load: () => Promise<T>,
  valid: (data: unknown) => boolean,
  onData: (data: T) => void,
): Promise<void> {
  const hit = readCache<T>("localStorage", key, valid, Number.POSITIVE_INFINITY)
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
    writeCache("localStorage", key, data)
    evictSiblings("localStorage", key)
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
