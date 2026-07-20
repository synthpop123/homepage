/**
 * Data layer for the Memos feed: types for the slice of the Mastodon
 * status payload the feed reads, plus the pure helpers the renderer
 * draws from — status → memo normalization (the URL trust boundary
 * included), custom-emoji tokenization, and image/srcset selection.
 * DOM-free and browser-safe, which is what keeps it testable; the
 * HTML sanitizer needs DOMParser and stays in Memos.astro.
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
  created_at?: string
  edited_at?: string | null
  language?: string | null
  emojis?: MastodonEmoji[]
  media_attachments?: MastodonMedia[]
  reblog?: unknown
}

/* Normalized memo shape ------------------------------------------------ */

export type MemoImage = {
  /** Link target — always the full-size original. */
  href: string
  src: string
  srcset?: string
  width?: number
  height?: number
  alt: string
}

export type Memo = {
  url: string
  html: string
  /** Plain text of `html`, used for presence checks and alt fallback. */
  text: string
  createdAt: string
  edited: boolean
  language: string | null
  emojis: Record<string, string>
  images: MemoImage[]
}

/** Payload validator for the sessionStorage cache. */
export const isStatusList = (data: unknown): data is MastodonStatus[] =>
  Array.isArray(data)

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

/**
 * Normalizes one media attachment into a renderable image, or null for
 * non-images and non-http(s) URLs. `srcset` pairs the small preview
 * with the original when both sides carry widths, so the grid can
 * serve the preview at cell size and the original on dense screens.
 */
export function toImage(
  media: MastodonMedia,
  fallbackAlt: string,
): MemoImage | null {
  if (media.type !== "image") return null
  const href = safeHttpUrl(media.url)
  if (!href) return null
  const preview = safeHttpUrl(media.preview_url)
  const small = media.meta?.small
  const original = media.meta?.original
  const candidates: string[] = []
  if (preview && small?.width) candidates.push(`${preview} ${small.width}w`)
  if (original?.width) candidates.push(`${href} ${original.width}w`)
  const srcset = candidates.length > 1 ? candidates.join(", ") : undefined
  const dim = original ?? small
  return {
    href,
    src: srcset && preview ? preview : href,
    srcset,
    width: dim?.width,
    height: dim?.height,
    alt: media.description?.trim() || fallbackAlt,
  }
}

/**
 * Validates and normalizes one status. Returns null for anything the
 * timeline shouldn't render: boosts, statuses without a safe permalink
 * or a parseable date, and statuses with neither text nor images.
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
  const alt = text || "Attached image"
  const images = (raw.media_attachments ?? []).flatMap((media) => {
    const image = toImage(media, alt)
    return image ? [image] : []
  })
  if (!text && images.length === 0) return null
  return {
    url,
    html,
    text,
    createdAt: raw.created_at,
    edited: Boolean(raw.edited_at),
    language: typeof raw.language === "string" ? raw.language : null,
    emojis: emojiMap(raw.emojis),
    images,
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
