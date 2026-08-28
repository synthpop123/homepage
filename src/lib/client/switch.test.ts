import { describe, expect, it } from "bun:test"
import { isSite, SITE_SCHEMA_VERSION } from "./switch"
import fixture from "./switch.site-fixture.json"

describe("isSite", () => {
  it("accepts the committed fixture", () => {
    expect(isSite(fixture)).toBe(true)
  })

  it("rejects the wrong schema version", () => {
    expect(isSite({ ...fixture, schemaVersion: SITE_SCHEMA_VERSION + 1 })).toBe(
      false,
    )
  })

  it("rejects malformed activity rows", () => {
    expect(
      isSite({
        ...fixture,
        activity: [{ date: "not-a-day", minutes: 1 }],
      }),
    ).toBe(false)
  })
})
