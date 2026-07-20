/**
 * Tests for the pure data layer behind the Memos feed: status → memo
 * normalization (the URL trust boundary, boost/empty filtering),
 * emoji tokenization, and image/srcset selection.
 */

import { describe, expect, it } from "bun:test"
import {
  emojiMap,
  type MastodonStatus,
  splitEmojiText,
  toImage,
  toMemo,
} from "./memos"

/* Fixtures ------------------------------------------------------------ */

const status = (extra: Partial<MastodonStatus> = {}): MastodonStatus => ({
  url: "https://mastodon.example/@me/1",
  content: "<p>Hello world</p>",
  created_at: "2026-06-30T15:23:21.058Z",
  ...extra,
})

const image = (extra = {}) => ({
  type: "image",
  url: "https://files.example/original.png",
  preview_url: "https://files.example/small.png",
  meta: {
    original: { width: 1988, height: 1954 },
    small: { width: 484, height: 476 },
  },
  ...extra,
})

/* toMemo --------------------------------------------------------------- */

describe("toMemo", () => {
  it("normalizes a plain text status", () => {
    const result = toMemo(status({ language: "zh-CN" }))
    expect(result).not.toBeNull()
    expect(result?.text).toBe("Hello world")
    expect(result?.language).toBe("zh-CN")
    expect(result?.edited).toBe(false)
    expect(result?.images).toEqual([])
  })

  it("flags edited statuses", () => {
    expect(toMemo(status({ edited_at: "2026-07-01T00:00:00Z" }))?.edited).toBe(
      true,
    )
  })

  it("rejects boosts, bad permalinks, and bad dates", () => {
    expect(toMemo(status({ reblog: {} }))).toBeNull()
    expect(toMemo(status({ url: "javascript:alert(1)" }))).toBeNull()
    expect(toMemo(status({ url: undefined }))).toBeNull()
    expect(toMemo(status({ created_at: "not a date" }))).toBeNull()
    expect(toMemo(status({ created_at: undefined }))).toBeNull()
    expect(toMemo(null)).toBeNull()
    expect(toMemo("nope")).toBeNull()
  })

  it("rejects statuses with neither text nor images", () => {
    expect(toMemo(status({ content: "<p> </p>" }))).toBeNull()
  })

  it("keeps image-only statuses", () => {
    const result = toMemo(status({ content: "", media_attachments: [image()] }))
    expect(result?.text).toBe("")
    expect(result?.images).toHaveLength(1)
    expect(result?.images[0]?.alt).toBe("Attached image")
  })
})

/* toImage -------------------------------------------------------------- */

describe("toImage", () => {
  it("builds a srcset from preview + original widths", () => {
    const result = toImage(image(), "fallback")
    expect(result?.href).toBe("https://files.example/original.png")
    expect(result?.src).toBe("https://files.example/small.png")
    expect(result?.srcset).toBe(
      "https://files.example/small.png 484w, https://files.example/original.png 1988w",
    )
    expect(result?.width).toBe(1988)
    expect(result?.height).toBe(1954)
  })

  it("falls back to the original when widths are missing", () => {
    const result = toImage(image({ meta: undefined }), "fallback")
    expect(result?.src).toBe("https://files.example/original.png")
    expect(result?.srcset).toBeUndefined()
    expect(result?.width).toBeUndefined()
  })

  it("prefers the attachment description for alt text", () => {
    expect(toImage(image({ description: "A cat" }), "fallback")?.alt).toBe(
      "A cat",
    )
    expect(toImage(image({ description: "  " }), "fallback")?.alt).toBe(
      "fallback",
    )
  })

  it("rejects non-images and unsafe URLs", () => {
    expect(toImage(image({ type: "video" }), "x")).toBeNull()
    expect(toImage(image({ url: "data:image/png;base64,x" }), "x")).toBeNull()
    expect(toImage(image({ url: undefined }), "x")).toBeNull()
  })
})

/* Emoji ---------------------------------------------------------------- */

describe("emojiMap", () => {
  it("maps shortcodes to safe URLs, preferring the animated one", () => {
    expect(
      emojiMap([
        {
          shortcode: "blob",
          url: "https://files.example/blob.gif",
          static_url: "https://files.example/blob.png",
        },
        { shortcode: "bad", url: "javascript:alert(1)" },
        { shortcode: "half", static_url: "https://files.example/half.png" },
      ]),
    ).toEqual({
      blob: "https://files.example/blob.gif",
      half: "https://files.example/half.png",
    })
  })
})

describe("splitEmojiText", () => {
  const map = { wave: "https://files.example/wave.png" }

  it("splits resolvable shortcodes into emoji tokens", () => {
    expect(splitEmojiText("hi :wave: bye", map)).toEqual([
      { type: "text", value: "hi " },
      { type: "emoji", shortcode: ":wave:", url: map.wave },
      { type: "text", value: " bye" },
    ])
  })

  it("leaves unknown shortcodes as plain text", () => {
    expect(splitEmojiText("hi :nope:", map)).toEqual([
      { type: "text", value: "hi :nope:" },
    ])
  })
})
