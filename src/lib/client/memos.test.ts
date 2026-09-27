/**
 * Tests for the pure data layer behind the Memos feed: the /memos/site
 * decoder (pinned against a captured production payload, and the URL
 * trust boundary on every link the renderer writes), payload → memo
 * (alt text fallbacks), emoji tokenization and the media grid's sizes.
 */

import { describe, expect, it } from "bun:test"
import {
  isSite,
  SITE_SCHEMA_VERSION,
  type SiteMedia,
  type SiteMemo,
  sizesFor,
  splitEmojiText,
  splitMedia,
  toMemo,
} from "./memos"
import fixture from "./memos.site-fixture.json"

/* Fixtures ------------------------------------------------------------ */

const photo = (extra: Partial<SiteMedia> = {}): SiteMedia => ({
  kind: "image",
  href: "https://files.example/original.png",
  src: "https://img.example/1-640.webp",
  srcset:
    "https://img.example/1-640.webp 640w, https://img.example/1-1600.webp 1600w",
  width: 1988,
  height: 1954,
  alt: null,
  loop: false,
  ...extra,
})

const memo = (extra: Partial<SiteMemo> = {}): SiteMemo => ({
  url: "https://mastodon.example/@me/1",
  at: "2026-06-30T15:23:21.058Z",
  edited: false,
  html: "<p>Hello world</p>",
  spoiler: "",
  sensitive: false,
  language: "zh-CN",
  emojis: [],
  media: [],
  ...extra,
})

const site = (memos: unknown[]) => ({ ...fixture, memos })

/* isSite --------------------------------------------------------------- */

describe("isSite", () => {
  it("accepts the pinned production fixture", () => {
    expect(isSite(fixture)).toBe(true)
    expect(fixture.schemaVersion).toBe(SITE_SCHEMA_VERSION)
  })

  it("accepts an account with nothing to show", () => {
    expect(isSite(site([]))).toBe(true)
  })

  it("rejects another schema version", () => {
    expect(isSite({ ...fixture, schemaVersion: SITE_SCHEMA_VERSION + 1 })).toBe(
      false,
    )
  })

  it("rejects a link that is not http(s), wherever it sits", () => {
    const bad = "javascript:alert(1)"
    expect(isSite({ ...fixture, profileUrl: bad })).toBe(false)
    expect(isSite(site([memo({ url: bad })]))).toBe(false)
    expect(isSite(site([memo({ media: [photo({ href: bad })] })]))).toBe(false)
    expect(isSite(site([memo({ media: [photo({ src: bad })] })]))).toBe(false)
    expect(
      isSite(site([memo({ media: [photo({ srcset: `${bad} 640w` })] })])),
    ).toBe(false)
    expect(
      isSite(site([memo({ emojis: [{ shortcode: "blob", url: bad }] })])),
    ).toBe(false)
  })

  it("rejects an unknown kind, a bad date or a missing field", () => {
    const kind = { ...photo(), kind: "gifv" }
    expect(isSite(site([memo({ media: [kind as SiteMedia] })]))).toBe(false)
    expect(isSite(site([memo({ at: "yesterday" })]))).toBe(false)
    const { spoiler: _, ...partial } = memo()
    expect(isSite(site([partial]))).toBe(false)
  })

  it("takes nulls where the Worker has nothing to say", () => {
    const bare = photo({ src: null, srcset: null, width: null, height: null })
    const audio = photo({ kind: "audio", src: null, srcset: null })
    expect(isSite(site([memo({ language: null, media: [bare, audio] })]))).toBe(
      true,
    )
  })
})

/* toMemo --------------------------------------------------------------- */

describe("toMemo", () => {
  it("reads the plain text out of the HTML", () => {
    const result = toMemo(memo({ html: "<p>Hello</p><p>world</p>" }))
    expect(result.text).toBe("Helloworld")
    expect(result.createdAt).toBe("2026-06-30T15:23:21.058Z")
  })

  it("keeps the Worker's copies as the image and its srcset", () => {
    const [shot] = toMemo(memo({ media: [photo()] })).media
    expect(shot?.src).toBe("https://img.example/1-640.webp")
    expect(shot?.srcset).toContain("1600w")
    expect(shot?.href).toBe("https://files.example/original.png")
    expect(shot?.width).toBe(1988)
  })

  it("falls back to the original for an image with no copy yet", () => {
    const [shot] = toMemo(
      memo({ media: [photo({ src: null, srcset: null })] }),
    ).media
    expect(shot?.src).toBe("https://files.example/original.png")
    expect(shot?.srcset).toBeUndefined()
  })

  it("describes an attachment by its own words, then the memo's", () => {
    const [own] = toMemo(memo({ media: [photo({ alt: "A cat" })] })).media
    expect(own?.alt).toBe("A cat")
    const [borrowed] = toMemo(memo({ media: [photo()] })).media
    expect(borrowed?.alt).toBe("Hello world")
    const [named] = toMemo(
      memo({ html: "", media: [photo({ kind: "video" })] }),
    ).media
    expect(named?.alt).toBe("Attached video")
  })

  it("describes warned attachments by the warning, never the hidden text", () => {
    const [shot] = toMemo(
      memo({
        spoiler: "Spoilers",
        html: "<p>The butler did it</p>",
        media: [photo()],
      }),
    ).media
    expect(shot?.alt).toBe("Spoilers")
  })

  it("keeps a gifv's loop and nothing else's", () => {
    const [gif, clip] = toMemo(
      memo({
        media: [photo({ kind: "video", loop: true }), photo({ kind: "video" })],
      }),
    ).media
    expect(gif?.loop).toBe(true)
    expect(clip?.loop).toBeUndefined()
  })

  it("keys emoji by shortcode without reaching Object.prototype", () => {
    const { emojis } = toMemo(
      memo({ emojis: [{ shortcode: "blob", url: "https://e.example/b.png" }] }),
    )
    expect(emojis.get("blob")).toBe("https://e.example/b.png")
    expect(emojis.get("constructor")).toBeUndefined()
  })
})

/* splitMedia / sizesFor ------------------------------------------------ */

describe("splitMedia", () => {
  it("keeps audio out of the grid", () => {
    const { media } = toMemo(
      memo({ media: [photo(), photo({ kind: "audio", src: null })] }),
    )
    const { grid, audio } = splitMedia(media)
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

/* Emoji ---------------------------------------------------------------- */

describe("splitEmojiText", () => {
  const url = "https://files.example/wave.png"
  const map = new Map([["wave", url]])

  it("splits resolvable shortcodes into emoji tokens", () => {
    expect(splitEmojiText("hi :wave: bye", map)).toEqual([
      { type: "text", value: "hi " },
      { type: "emoji", shortcode: ":wave:", url },
      { type: "text", value: " bye" },
    ])
  })

  it("leaves unknown shortcodes as plain text", () => {
    expect(splitEmojiText("hi :nope: :toString:", map)).toEqual([
      { type: "text", value: "hi :nope: :toString:" },
    ])
  })
})
