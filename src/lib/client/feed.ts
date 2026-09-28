/**
 * Shared client-side plumbing for the live feeds (Now, Memos, Tokens
 * and the /misc sections): a stale-while-revalidate cache over
 * localStorage, JSON fetching with a timeout, URL sanitizing for remote
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

/* Cache --------------------------------------------------------------- */

export const TIME_ZONE = "Asia/Shanghai"

/** "Jun 21, 2026" — the shared date style for feed entries. */
export const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: TIME_ZONE,
})

const dayParts = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: TIME_ZONE,
})

/**
 * The calendar day it is in the site's zone, `YYYY-MM-DD`: what a
 * payload's `today` meant when it was composed, and what it stops
 * meaning at midnight, or the moment a cached copy outlives its day.
 */
export function calendarDay(now = Date.now()): string {
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    dayParts.formatToParts(now).find((entry) => entry.type === type)?.value
  return `${part("year")}-${part("month")}-${part("day")}`
}

/** Resolved lazily because merely touching `localStorage` can throw
 *  under some privacy settings. */
const storage = (): Storage | null => {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

function readCache<T>(
  key: string,
  valid: (data: unknown) => boolean,
): T | null {
  try {
    const raw = storage()?.getItem(key)
    if (!raw) return null
    const { data } = JSON.parse(raw)
    return valid(data) ? (data as T) : null
  } catch {
    return null
  }
}

function writeCache(key: string, data: unknown) {
  try {
    storage()?.setItem(key, JSON.stringify({ t: Date.now(), data }))
  } catch {
    // Storage full or unavailable (e.g. private mode) — cache is optional.
  }
}

/**
 * A cache key names its feed, its schema version and its endpoint —
 * `tokens:site:v14:https://…` — so a deploy that bumps the version
 * writes a new key and never reads the previous build's entry. In
 * localStorage the old entry would outlive every deploy, so the writer
 * sweeps its own family: every key of the same feed under any other
 * version.
 */
function evictSiblings(key: string) {
  const family = key.replace(/:v\d+:.*$/, ":v")
  if (family === key) return
  try {
    const store = storage()
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
 * Stale-while-revalidate, for a feed whose endpoint revalidates cheaply
 * (the tokens collector serves `no-cache` + ETag, so an unchanged
 * payload costs a ~0-byte 304): any cached copy paints immediately
 * regardless of age, while a fetch runs regardless of the cache and
 * hands the network's answer to the same callback — deciding whether
 * it actually changed is the caller's business.
 *
 * The cache is localStorage: this discipline already accepts a copy of
 * any age, so there is no reason to forget it when the tab closes — a
 * new tab or next week's visit paints from the last payload instead of
 * from skeletons, and the revalidation that follows is the same one a
 * same-tab revisit makes.
 *
 * `valid` is the feed's payload decoder and gates both deliveries (a
 * stale shape from an older deploy, a misbehaving endpoint), so nothing
 * unvalidated is ever cached or handed to a renderer. The cached
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
  const hit = readCache<T>(key, valid)
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
    evictSiblings(key)
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

/** How long a visible page keeps a payload before asking again. */
const REVALIDATE_MS = 5 * 60_000

/**
 * The one clock the live sections keep time by. `tick` runs every
 * minute while the page is visible, and at once when a hidden tab comes
 * back, so every relative time ("3m ago", "Online", a quota countdown)
 * stays true without a new payload. `reload` runs on the same clock but
 * only when what is on screen may have gone stale behind the reader's
 * back: five minutes since the last ask, or the site's calendar day
 * turning over (a payload's "today" is yesterday by then). Both are
 * cheap, since the workers answer an unchanged payload with a 304.
 * Browser-only.
 */
export function keepFresh({
  tick,
  reload,
}: {
  tick?: () => void
  reload?: () => void
}) {
  let day = calendarDay()
  let asked = Date.now()
  const run = () => {
    if (document.hidden) return
    const now = Date.now()
    const today = calendarDay(now)
    if (reload && (today !== day || now - asked >= REVALIDATE_MS)) {
      day = today
      asked = now
      reload()
    }
    tick?.()
  }
  setInterval(run, 60_000)
  document.addEventListener("visibilitychange", run)
}
