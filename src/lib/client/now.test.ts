import { describe, expect, it } from "bun:test"
import {
  ago,
  isSite,
  memoText,
  SITE_SCHEMA_VERSION,
  tokensFoot,
  watchedLabel,
} from "./now"
import fixture from "./now.site-fixture.json"

describe("isSite", () => {
  it("accepts the pinned production fixture", () => {
    expect(isSite(fixture)).toBe(true)
    expect(fixture.schemaVersion).toBe(SITE_SCHEMA_VERSION)
  })

  it("accepts a source with nothing to show", () => {
    expect(
      isSite({
        ...fixture,
        listen: null,
        film: null,
        tokens: null,
        memo: null,
      }),
    ).toBe(true)
  })

  it("rejects another schema version and a non-http memo link", () => {
    expect(isSite({ ...fixture, schemaVersion: SITE_SCHEMA_VERSION + 1 })).toBe(
      false,
    )
    const memo = { ...fixture.memo, url: "javascript:alert(1)" }
    expect(isSite({ ...fixture, memo })).toBe(false)
  })
})

describe("ago", () => {
  const now = Date.parse("2026-09-27T12:00:00Z")
  it("counts up through minutes, hours and days, then names the date", () => {
    expect(ago("2026-09-27T11:59:30Z", now)).toBe("just now")
    expect(ago("2026-09-27T11:48:00Z", now)).toBe("12m ago")
    expect(ago("2026-09-27T09:00:00Z", now)).toBe("3h ago")
    expect(ago("2026-09-26T05:00:00Z", now)).toBe("yesterday")
    expect(ago("2026-09-23T12:00:00Z", now)).toBe("4d ago")
    expect(ago("2026-09-12T12:00:00Z", now)).toBe("Sep 12")
  })
})

describe("watchedLabel", () => {
  it("speaks in calendar days", () => {
    expect(watchedLabel("2026-09-27", "2026-09-27")).toBe("today")
    expect(watchedLabel("2026-09-26", "2026-09-27")).toBe("yesterday")
    expect(watchedLabel("2026-09-22", "2026-09-27")).toBe("5d ago")
    expect(watchedLabel("2026-09-02", "2026-09-27")).toBe("Sep 2")
  })
})

describe("tile text", () => {
  it("sums up today's tokens under the figure", () => {
    expect(tokensFoot({ tokens: 1, cost: 14.482494, messages: 155 })).toEqual([
      "$14.48",
      "155 messages",
    ])
    expect(tokensFoot({ tokens: 0, cost: 0, messages: 1 })).toEqual([
      "$0.00",
      "1 message",
    ])
  })

  it("never prints a memo body behind a content warning", () => {
    const memo = { at: "", url: "", text: "spoilers", cw: true, media: 0 }
    expect(memoText(memo)).toBe("CW: spoilers")
    expect(memoText({ ...memo, cw: false, text: "", media: 4 })).toBe(
      "4 attachments",
    )
    expect(memoText({ ...memo, cw: false, text: "hi" })).toBe("hi")
  })
})
