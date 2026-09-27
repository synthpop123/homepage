/**
 * Data layer for the Memos feed: types for cf-workers-api's /memos/site
 * view (see src/services/memos/ there), the latest public Mastodon
 * statuses with attachments already resolved to what renders and photos
 * copied to img.lkwplus.com as WebP, plus the decoder the feed validates
 * against and the pure helpers the renderer draws from: payload → memo
 * (alt text fallbacks, the emoji table), custom-emoji tokenization and
 * the `sizes` the media grid renders images at. DOM-free and
 * browser-safe; the allow-list HTML sanitizer needs DOMParser and lives
 * in `memos-feed/sanitize.ts`.
 */

import {
  fetchJson,
  isCount,
  isRecord,
  safeHttpUrl,
  swr,
  TIME_ZONE,
} from "./feed"

/* Payload -------------------------------------------------------------- */

/**
 * What an attachment renders as. Mastodon's `gifv` is an mp4 standing
 * in for an animated GIF, so the Worker makes it a video that loops
 * silently (`loop`) rather than a kind of its own.
 */
export type MemoMediaKind = "image" | "video" | "audio"

export type SiteMedia = {
  kind: MemoMediaKind
  /** The original file: a photo's link target, a video's or audio's
   *  source. */
  href: string
  /** What paints first: the photo, or a video's poster frame. */
  src: string | null
  srcset: string | null
  width: number | null
  height: number | null
  /** The attachment's own description. */
  alt: string | null
  loop: boolean
}

export type SiteMemo = {
  url: string
  /** ISO instant it was posted. */
  at: string
  edited: boolean
  /** Status HTML as Mastodon renders it; sanitized before it is drawn. */
  html: string
  /** The content warning, `""` when there is none. */
  spoiler: string
  sensitive: boolean
  language: string | null
  emojis: { shortcode: string; url: string }[]
  media: SiteMedia[]
}

export type Site = {
  schemaVersion: number
  profileUrl: string
  /** Newest first. */
  memos: SiteMemo[]
}

/** Lockstep with cf-workers-api's SITE_VERSION in src/services/memos/compose.ts. */
export const SITE_SCHEMA_VERSION = 1

const KINDS: ReadonlySet<string> = new Set(["image", "video", "audio"])

const isUrl = (value: unknown) => safeHttpUrl(value) !== null
const isNullableUrl = (value: unknown) => value === null || isUrl(value)
const isNullableCount = (value: unknown) => value === null || isCount(value)
const isNullableString = (value: unknown) =>
  value === null || typeof value === "string"

/** A srcset whose every candidate is an http(s) URL with a width. */
const isSrcset = (value: unknown) =>
  value === null ||
  (typeof value === "string" &&
    value.split(", ").every((candidate) => {
      const [url, width, ...rest] = candidate.split(" ")
      return rest.length === 0 && isUrl(url) && /^\d+w$/.test(width ?? "")
    }))

const isMedia = (value: unknown): value is SiteMedia =>
  isRecord(value) &&
  typeof value.kind === "string" &&
  KINDS.has(value.kind) &&
  isUrl(value.href) &&
  isNullableUrl(value.src) &&
  isSrcset(value.srcset) &&
  isNullableCount(value.width) &&
  isNullableCount(value.height) &&
  isNullableString(value.alt) &&
  typeof value.loop === "boolean"

const isEmoji = (value: unknown) =>
  isRecord(value) &&
  typeof value.shortcode === "string" &&
  /^\w+$/.test(value.shortcode) &&
  isUrl(value.url)

const isMemo = (value: unknown): value is SiteMemo =>
  isRecord(value) &&
  isUrl(value.url) &&
  typeof value.at === "string" &&
  !Number.isNaN(Date.parse(value.at)) &&
  typeof value.edited === "boolean" &&
  typeof value.html === "string" &&
  typeof value.spoiler === "string" &&
  typeof value.sensitive === "boolean" &&
  isNullableString(value.language) &&
  Array.isArray(value.emojis) &&
  value.emojis.every(isEmoji) &&
  Array.isArray(value.media) &&
  value.media.every(isMedia)

export function isSite(data: unknown): data is Site {
  return (
    isRecord(data) &&
    data.schemaVersion === SITE_SCHEMA_VERSION &&
    isUrl(data.profileUrl) &&
    Array.isArray(data.memos) &&
    data.memos.every(isMemo)
  )
}

export const loadSite = (
  endpoint: string,
  onData: (site: Site) => void,
): Promise<void> =>
  swr(
    `memos:site:v${SITE_SCHEMA_VERSION}:${endpoint}`,
    () => fetchJson<Site>(endpoint),
    isSite,
    onData,
  )

/* What the renderer draws ---------------------------------------------- */

export type MemoMedia = {
  kind: MemoMediaKind
  href: string
  src?: string
  srcset?: string
  width?: number
  height?: number
  alt: string
  /** gifv: autoplay, muted, looping, no controls. */
  loop?: boolean
}

export type Memo = {
  url: string
  html: string
  /** Plain text of `html`, used for presence checks and alt fallback. */
  text: string
  /** The content warning, `""` when there is none. Non-empty folds the
   *  whole entry behind it. */
  spoiler: string
  /** Media marked sensitive. Without a `spoiler` the text stays visible
   *  and only the media folds — Mastodon's own split. */
  sensitive: boolean
  createdAt: string
  edited: boolean
  language: string | null
  /** shortcode → image URL. A Map, so a shortcode such as `constructor`
   *  finds nothing rather than something from Object.prototype. */
  emojis: ReadonlyMap<string, string>
  media: MemoMedia[]
}

export const stripTags = (html?: string) => (html ?? "").replace(/<[^>]*>/g, "")

const DEFAULT_ALT: Record<MemoMediaKind, string> = {
  image: "Attached image",
  video: "Attached video",
  audio: "Attached audio",
}

/**
 * One memo as the renderer takes it. Alt text is the attachment's own
 * description, else the memo's words, else its kind; a warned memo
 * describes its attachments by the warning, since the words behind it
 * would otherwise leak into an alt attribute.
 */
export function toMemo(memo: SiteMemo): Memo {
  const text = stripTags(memo.html).trim()
  const fallback = memo.spoiler || text
  return {
    url: memo.url,
    html: memo.html,
    text,
    spoiler: memo.spoiler,
    sensitive: memo.sensitive,
    createdAt: memo.at,
    edited: memo.edited,
    language: memo.language,
    emojis: new Map(memo.emojis.map(({ shortcode, url }) => [shortcode, url])),
    media: memo.media.map((item) => ({
      kind: item.kind,
      href: item.href,
      src: item.src ?? (item.kind === "image" ? item.href : undefined),
      srcset: item.srcset ?? undefined,
      width: item.width ?? undefined,
      height: item.height ?? undefined,
      alt: item.alt || fallback || DEFAULT_ALT[item.kind],
      loop: item.loop || undefined,
    })),
  }
}

export type EmojiToken =
  | { type: "text"; value: string }
  | { type: "emoji"; shortcode: string; url: string }

/**
 * Splits text on the :shortcode: occurrences that resolve in the emoji
 * map; unknown shortcodes stay plain text. The renderer turns emoji
 * tokens into inline <img> nodes.
 */
export function splitEmojiText(
  text: string,
  emojis: ReadonlyMap<string, string>,
): EmojiToken[] {
  const tokens: EmojiToken[] = []
  let last = 0
  for (const match of text.matchAll(/:([a-zA-Z0-9_]+):/g)) {
    const url = emojis.get(match[1])
    if (!url) continue
    if (match.index > last) {
      tokens.push({ type: "text", value: text.slice(last, match.index) })
    }
    tokens.push({ type: "emoji", shortcode: match[0], url })
    last = match.index + match[0].length
  }
  if (tokens.length === 0) return [{ type: "text", value: text }]
  if (last < text.length) tokens.push({ type: "text", value: text.slice(last) })
  return tokens
}

/* Attachments ---------------------------------------------------------- */

/**
 * Splits attachments into what the media grid draws and what renders as
 * its own player below it: audio has no thumbnail worth a cell, so it
 * would only ever be a gray box in the grid.
 */
export function splitMedia(media: MemoMedia[]) {
  return {
    grid: media.filter((item) => item.kind !== "audio"),
    audio: media.filter((item) => item.kind === "audio"),
  }
}

/**
 * The rendered widths behind each grid cell's `sizes`. A single image
 * renders at a fixed height with its own ratio (see the CSS), so its
 * width follows from the attachment dimensions; multi-cell layouts
 * divide the ~30rem main column left of the date rail.
 */
export function sizesFor(media: MemoMedia[], index: number): string {
  const count = media.length
  if (count === 1) {
    const { width, height } = media[0] ?? {}
    if (width && height) {
      const rem = Math.min((22 * width) / height, 30)
      return `min(${rem.toFixed(1)}rem, 92vw)`
    }
    return "(min-width: 40rem) 30rem, 92vw"
  }
  if (count === 3) {
    return index === 0
      ? "(min-width: 40rem) 20rem, 61vw"
      : "(min-width: 40rem) 10rem, 31vw"
  }
  return "(min-width: 40rem) 15rem, 46vw"
}

/* Dates ---------------------------------------------------------------- */

/** "Jun 30, 2026, 11:23 PM" — full timestamp for hover titles. */
const timeFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: TIME_ZONE,
})

export const timeLabel = (iso: string) => timeFormatter.format(new Date(iso))
