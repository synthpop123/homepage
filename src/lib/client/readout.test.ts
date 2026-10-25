import { describe, expect, it } from "bun:test"
import { type Run, splitFigure } from "./readout"

const texts = (runs: Run[]) => runs.map((run) => `${run.kind}:${run.text}`)

describe("splitFigure", () => {
  it("sets numbers apart from the units around them", () => {
    expect(texts(splitFigure("145.1M"))).toEqual(["num:145.1", "unit:M"])
    expect(texts(splitFigure("12h 30m"))).toEqual([
      "num:12",
      "unit:h ",
      "num:30",
      "unit:m",
    ])
    expect(texts(splitFigure("¥3,450"))).toEqual(["unit:¥", "num:3,450"])
    expect(texts(splitFigure("34,511 km"))).toEqual(["num:34,511", "unit: km"])
  })

  it("keeps a word whole", () => {
    expect(texts(splitFigure("Thursday"))).toEqual(["unit:Thursday"])
    expect(splitFigure("")).toEqual([])
  })
})
