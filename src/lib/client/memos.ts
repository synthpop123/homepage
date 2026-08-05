/**
 * Data layer for the Memos feed: types for the slice of the Mastodon
 * status payload the feed reads, plus the pure helpers the renderer
 * draws from — status → memo normalization (the URL trust boundary
 * included), custom-emoji tokenization, attachment selection and the
 * `sizes` the media grid renders images at. DOM-free and browser-safe,
 * which is what keeps it testable; the allow-list HTML sanitizer needs
 * DOMParser and lives in `memos-feed/sanitize.ts`.
 */

import { safeHttpUrl, TIME_ZONE } from "./feed"

/* Mastodon payload types ---------------------------------------------- */

export type MastodonEmoji = {
  shortcode?: string
  url?: string
  static_url?: string
}

type ImageDim = { width?: number; height?: number }

export type MastodonMedia = {
  type?: string
  url?: string
  preview_url?: string
  description?: string | null
  meta?: { small?: ImageDim; original?: ImageDim }
}

export type MastodonStatus = {
  url?: string
  content?: string
  spoiler_text?: string
  sensitive?: boolean
  created_at?: string
  edited_at?: string | null
  language?: string | null
  emojis?: MastodonEmoji[]
  media_attachments?: MastodonMedia[]
  reblog?: unknown
}

/* Normalized memo shape ------------------------------------------------ */

/**
 * What an attachment renders as. Mastodon's `gifv` is an mp4 standing
 * in for an animated GIF, so it becomes a video that loops silently
 * rather than a kind of its own; anything the feed can't render (an
 * `unknown` attachment from a failed transcode) is dropped.
 */
export type MemoMediaKind = "image" | "video" | "audio"

export type MemoMedia = {
  kind: MemoMediaKind
  /** The original file — the link target for images, the source for
   *  video and audio. */
  href: string
  /** What paints first: the preview for images, the poster frame for
   *  video. Absent when the attachment carries neither. */
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
  emojis: Record<string, string>
  media: MemoMedia[]
}

/**
 * Payload validator for the sessionStorage cache: a list whose entries
 * at least look like statuses, so a stale or misbehaving response can't
 * be cached and handed to the renderer. An empty timeline is valid —
 * the feed renders its empty state, not the error one.
 */
export const isStatusList = (data: unknown): data is MastodonStatus[] =>
  Array.isArray(data) &&
  data.every(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as MastodonStatus).created_at === "string",
  )

export const stripTags = (html?: string) => (html ?? "").replace(/<[^>]*>/g, "")

/** shortcode → image URL, dropping anything that isn't plain http(s). */
export function emojiMap(emojis?: MastodonEmoji[]): Record<string, string> {
  const map: Record<string, string> = {}
  for (const emoji of emojis ?? []) {
    const url = safeHttpUrl(emoji.url) ?? safeHttpUrl(emoji.static_url)
    if (emoji.shortcode && url) map[emoji.shortcode] = url
  }
  return map
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
  emojis: Record<string, string>,
): EmojiToken[] {
  const tokens: EmojiToken[] = []
  let last = 0
  for (const match of text.matchAll(/:([a-zA-Z0-9_]+):/g)) {
    const url = emojis[match[1]]
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

const KINDS: Record<string, MemoMediaKind> = {
  image: "image",
  video: "video",
  gifv: "video",
  audio: "audio",
}

const DEFAULT_ALT: Record<MemoMediaKind, string> = {
  image: "Attached image",
  video: "Attached video",
  audio: "Attached audio",
}

/**
 * Normalizes one attachment into something renderable, or null for
 * unsupported types and non-http(s) URLs. For images, `srcset` pairs
 * the small preview with the original when both sides carry widths, so
 * the grid can serve the preview at cell size and the original on dense
 * screens; video and audio stream from the original with the preview as
 * their poster.
 */
export function toMedia(
  media: MastodonMedia,
  fallbackAlt: string,
): MemoMedia | null {
  const kind = KINDS[media.type ?? ""]
  const href = safeHttpUrl(media.url)
  if (!kind || !href) return null
  const preview = safeHttpUrl(media.preview_url) ?? undefined
  const small = media.meta?.small
  const original = media.meta?.original
  const dim = original ?? small
  const alt = media.description?.trim() || fallbackAlt || DEFAULT_ALT[kind]

  if (kind !== "image") {
    return {
      kind,
      href,
      src: preview,
      width: dim?.width,
      height: dim?.height,
      alt,
      loop: media.type === "gifv" ? true : undefined,
    }
  }

  const candidates: string[] = []
  if (preview && small?.width) candidates.push(`${preview} ${small.width}w`)
  if (original?.width) candidates.push(`${href} ${original.width}w`)
  const srcset = candidates.length > 1 ? candidates.join(", ") : undefined
  return {
    kind,
    href,
    src: srcset && preview ? preview : href,
    srcset,
    width: dim?.width,
    height: dim?.height,
    alt,
  }
}

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

/* Statuses ------------------------------------------------------------- */

/**
 * Validates and normalizes one status. Returns null for anything the
 * timeline shouldn't render: boosts, statuses without a safe permalink
 * or a parseable date, and statuses left with nothing to show — no
 * text, no content warning, no renderable attachment.
 */
export function toMemo(status: unknown): Memo | null {
  if (typeof status !== "object" || status === null) return null
  const raw = status as MastodonStatus
  if (raw.reblog) return null
  const url = safeHttpUrl(raw.url)
  if (!url) return null
  if (
    typeof raw.created_at !== "string" ||
    Number.isNaN(Date.parse(raw.created_at))
  ) {
    return null
  }
  const html = typeof raw.content === "string" ? raw.content : ""
  const text = stripTags(html).trim()
  const spoiler =
    typeof raw.spoiler_text === "string" ? raw.spoiler_text.trim() : ""
  // A warned status describes itself by its warning; falling back to the
  // hidden text would leak it into an alt attribute.
  const alt = spoiler || text
  const media = (raw.media_attachments ?? []).flatMap((attachment) => {
    const item = toMedia(attachment, alt)
    return item ? [item] : []
  })
  if (!text && !spoiler && media.length === 0) return null
  return {
    url,
    html,
    text,
    spoiler,
    sensitive: Boolean(raw.sensitive),
    createdAt: raw.created_at,
    edited: Boolean(raw.edited_at),
    language: typeof raw.language === "string" ? raw.language : null,
    emojis: emojiMap(raw.emojis),
    media,
  }
}

/* Dates ---------------------------------------------------------------- */

/** "Jun 30, 2026, 11:23 PM" — full timestamp for hover titles. */
const timeFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: TIME_ZONE,
})

export const timeLabel = (iso: string) => timeFormatter.format(new Date(iso))
