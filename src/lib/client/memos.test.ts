/**
 * Tests for the pure data layer behind the Memos feed: status → memo
 * normalization (the URL trust boundary, boost/empty filtering),
 * emoji tokenization, and image/srcset selection.
 */

import { describe, expect, it } from "bun:test"
import {
  emojiMap,
  isStatusList,
  type MastodonStatus,
  sizesFor,
  splitEmojiText,
  splitMedia,
  toMedia,
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
    expect(result?.media).toEqual([])
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

  it("rejects statuses with nothing to show at all", () => {
    expect(toMemo(status({ content: "<p> </p>" }))).toBeNull()
  })

  it("keeps image-only statuses", () => {
    const result = toMemo(status({ content: "", media_attachments: [image()] }))
    expect(result?.text).toBe("")
    expect(result?.media).toHaveLength(1)
    expect(result?.media[0]?.alt).toBe("Attached image")
  })

  it("carries the content warning and the sensitive flag", () => {
    const warned = toMemo(status({ spoiler_text: "  spoilers  " }))
    expect(warned?.spoiler).toBe("spoilers")
    expect(warned?.sensitive).toBe(false)
    expect(toMemo(status({ sensitive: true }))?.sensitive).toBe(true)
    expect(toMemo(status())?.spoiler).toBe("")
  })

  it("keeps a status that is nothing but a content warning", () => {
    expect(toMemo(status({ content: "", spoiler_text: "cw" }))).not.toBeNull()
  })

  it("describes warned attachments by the warning, never the hidden text", () => {
    const result = toMemo(
      status({ spoiler_text: "food", media_attachments: [image()] }),
    )
    expect(result?.media[0]?.alt).toBe("food")
  })
})

/* toMedia -------------------------------------------------------------- */

describe("toMedia", () => {
  it("builds a srcset from preview + original widths", () => {
    const result = toMedia(image(), "fallback")
    expect(result?.href).toBe("https://files.example/original.png")
    expect(result?.src).toBe("https://files.example/small.png")
    expect(result?.srcset).toBe(
      "https://files.example/small.png 484w, https://files.example/original.png 1988w",
    )
    expect(result?.width).toBe(1988)
    expect(result?.height).toBe(1954)
  })

  it("falls back to the original when widths are missing", () => {
    const result = toMedia(image({ meta: undefined }), "fallback")
    expect(result?.src).toBe("https://files.example/original.png")
    expect(result?.srcset).toBeUndefined()
    expect(result?.width).toBeUndefined()
  })

  it("prefers the attachment description for alt text", () => {
    expect(toMedia(image({ description: "A cat" }), "fallback")?.alt).toBe(
      "A cat",
    )
    expect(toMedia(image({ description: "  " }), "fallback")?.alt).toBe(
      "fallback",
    )
  })

  it("renders video from the original with the preview as its poster", () => {
    const result = toMedia(image({ type: "video" }), "fallback")
    expect(result?.kind).toBe("video")
    expect(result?.href).toBe("https://files.example/original.png")
    expect(result?.src).toBe("https://files.example/small.png")
    expect(result?.srcset).toBeUndefined()
    expect(result?.loop).toBeUndefined()
  })

  it("marks gifv as a silent loop", () => {
    expect(toMedia(image({ type: "gifv" }), "x")?.loop).toBe(true)
  })

  it("names attachments by kind when nothing else describes them", () => {
    expect(toMedia(image({ type: "audio" }), "")?.alt).toBe("Attached audio")
    expect(toMedia(image({ type: "video" }), "")?.alt).toBe("Attached video")
  })

  it("rejects unsupported types and unsafe URLs", () => {
    expect(toMedia(image({ type: "unknown" }), "x")).toBeNull()
    expect(toMedia(image({ type: undefined }), "x")).toBeNull()
    expect(toMedia(image({ url: "data:image/png;base64,x" }), "x")).toBeNull()
    expect(toMedia(image({ url: undefined }), "x")).toBeNull()
  })
})

/* splitMedia / sizesFor ------------------------------------------------ */

describe("splitMedia", () => {
  it("keeps audio out of the grid", () => {
    const media = toMemo(
      status({
        media_attachments: [image(), image({ type: "audio" })],
      }),
    )?.media
    const { grid, audio } = splitMedia(media ?? [])
    expect(grid).toHaveLength(1)
    expect(grid[0]?.kind).toBe("image")
    expect(audio).toHaveLength(1)
  })
})

describe("sizesFor", () => {
  const shot = (width: number, height: number) =>
    ({ kind: "image", href: "x", alt: "", width, height }) as const

  it("sizes a lone image from its own ratio, capped at the column", () => {
    expect(sizesFor([shot(1000, 1000)], 0)).toBe("min(22.0rem, 92vw)")
    // Wide enough that 22rem of height would overflow the column.
    expect(sizesFor([shot(3000, 1000)], 0)).toBe("min(30.0rem, 92vw)")
  })

  it("falls back to the column width when dimensions are missing", () => {
    expect(sizesFor([{ kind: "image", href: "x", alt: "" }], 0)).toBe(
      "(min-width: 40rem) 30rem, 92vw",
    )
  })

  it("gives the lead cell of a 3-up the wide column", () => {
    const three = [shot(10, 10), shot(10, 10), shot(10, 10)]
    expect(sizesFor(three, 0)).toBe("(min-width: 40rem) 20rem, 61vw")
    expect(sizesFor(three, 1)).toBe("(min-width: 40rem) 10rem, 31vw")
    expect(sizesFor([shot(10, 10), shot(10, 10)], 1)).toBe(
      "(min-width: 40rem) 15rem, 46vw",
    )
  })
})

/* isStatusList --------------------------------------------------------- */

describe("isStatusList", () => {
  it("accepts an empty timeline but not a list of junk", () => {
    expect(isStatusList([])).toBe(true)
    expect(isStatusList([status()])).toBe(true)
    expect(isStatusList([status(), { url: "x" }])).toBe(false)
    expect(isStatusList([null])).toBe(false)
    expect(isStatusList(["nope"])).toBe(false)
    expect(isStatusList({ statuses: [] })).toBe(false)
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
