import { describe, expect, it } from "bun:test"
import { isSite, SITE_SCHEMA_VERSION } from "./switch"
import fixture from "./switch.site-fixture.json"

describe("isSite", () => {
  it("accepts the pinned production fixture", () => {
    expect(isSite(fixture)).toBe(true)
    expect(fixture.schemaVersion).toBe(SITE_SCHEMA_VERSION)
  })
})
