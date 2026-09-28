import { describe, expect, it } from "bun:test"
import { isSite, SITE_SCHEMA_VERSION } from "./movies"
import fixture from "./movies.site-fixture.json"

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

  it("rejects a film whose link is not http(s)", () => {
    const [first, ...rest] = fixture.films
    const bad = { ...first, url: "javascript:alert(1)" }
    expect(isSite({ ...fixture, films: [bad, ...rest] })).toBe(false)
  })
})
