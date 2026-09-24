import { describe, expect, it } from "bun:test"
import { formatRun, type Run, splitFigure, startValues } from "./readout"

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

  it("reads the value, the decimals and the grouping", () => {
    expect(splitFigure("1,234.50")[0]).toEqual({
      kind: "num",
      text: "1,234.50",
      value: 1234.5,
      decimals: 2,
      grouped: true,
    })
  })
})

describe("formatRun", () => {
  it("spells an intermediate value the way the final one is spelled", () => {
    const [run] = splitFigure("1,234.5")
    if (run.kind !== "num") throw new Error("expected a number")
    expect(formatRun(run, 999.04)).toBe("999.0")
    expect(formatRun(run, 1234.5)).toBe("1,234.5")
  })
})

describe("startValues", () => {
  it("counts from the old figure when it had the same shape", () => {
    expect(startValues("10h 5m", splitFigure("12h 30m"))).toEqual([10, 5])
  })

  it("counts from zero on a first fill or a change of kind", () => {
    expect(startValues(undefined, splitFigure("78 days"))).toEqual([0])
    expect(startValues("—", splitFigure("78 days"))).toEqual([0])
    expect(startValues("45m", splitFigure("1h 5m"))).toEqual([0, 0])
    expect(startValues("145.1M", splitFigure("1.2B"))).toEqual([0])
  })
})
