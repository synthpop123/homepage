import { describe, expect, it } from "bun:test"
import { isSite, SITE_SCHEMA_VERSION, splitTitle } from "./movies"
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

describe("splitTitle", () => {
  it("cuts a long title at its first colon", () => {
    expect(splitTitle("The Hunger Games: Sunrise on the Reaping")).toEqual({
      head: "The Hunger Games",
      sub: "Sunrise on the Reaping",
    })
    expect(splitTitle("Star Wars: Episode IV: A New Hope")).toEqual({
      head: "Star Wars",
      sub: "Episode IV: A New Hope",
    })
  })

  it("takes a full-width colon", () => {
    expect(splitTitle("流浪地球：第二部，一个很长很长的副标题名称")).toEqual({
      head: "流浪地球",
      sub: "第二部，一个很长很长的副标题名称",
    })
  })

  it("leaves a short title whole", () => {
    expect(splitTitle("Mission: Impossible")).toEqual({
      head: "Mission: Impossible",
      sub: null,
    })
  })

  it("leaves a title with no colon, or an empty side, whole", () => {
    const long = "You Shoot, I Shoot and Then Some More"
    expect(splitTitle(long)).toEqual({ head: long, sub: null })
    expect(splitTitle(": A Title That Opens on Its Colon")).toEqual({
      head: ": A Title That Opens on Its Colon",
      sub: null,
    })
  })
})
