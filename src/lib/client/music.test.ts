import { describe, expect, it } from "bun:test"
import { isPlaying, isSite, SITE_SCHEMA_VERSION } from "./music"
import fixture from "./music.site-fixture.json"

describe("isSite", () => {
  it("accepts the pinned production fixture", () => {
    expect(isSite(fixture)).toBe(true)
    expect(fixture.schemaVersion).toBe(SITE_SCHEMA_VERSION)
  })

  it("rejects another schema version", () => {
    expect(isSite({ ...fixture, schemaVersion: SITE_SCHEMA_VERSION + 1 })).toBe(
      false,
    )
  })

  it("rejects a missing stat and a non-http cover", () => {
    const { plays: _, ...stats } = fixture.stats
    expect(isSite({ ...fixture, stats })).toBe(false)
    const [lead, ...rest] = fixture.listens
    const bad = {
      ...lead,
      cover: { ...lead.cover, small: "javascript:alert(1)" },
    }
    expect(isSite({ ...fixture, listens: [bad, ...rest] })).toBe(false)
  })

  it("ships the heatmap dense, ending today", () => {
    expect(fixture.activity.at(-1)?.date).toBe(fixture.today)
  })
})

describe("isPlaying", () => {
  const now = Date.parse("2026-09-26T06:00:00Z")
  it("spins the record only for a listen under ten minutes old", () => {
    expect(isPlaying("2026-09-26T05:51:00Z", now)).toBe(true)
    expect(isPlaying("2026-09-26T05:49:00Z", now)).toBe(false)
  })
})
