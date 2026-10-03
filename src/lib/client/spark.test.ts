import { describe, expect, it } from "bun:test"
import { sparkShares } from "./spark"

describe("sparkShares", () => {
  it("scales each day against the busiest", () => {
    expect(sparkShares([0, 5, 10])).toEqual([0, 0.5, 1])
  })

  it("keeps a quiet month flat", () => {
    expect(sparkShares([0, 0, 0])).toEqual([0, 0, 0])
    expect(sparkShares([])).toEqual([])
  })
})
