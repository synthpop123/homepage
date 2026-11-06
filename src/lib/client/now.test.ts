import { describe, expect, it } from "bun:test"
import {
  isSite,
  portfolioView,
  SITE_SCHEMA_VERSION,
  tokenBars,
  tokensFoot,
  tokensLabel,
  topModelText,
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
        portfolio: null,
      }),
    ).toBe(true)
  })

  it("rejects another schema version, a non-http link and a bad series", () => {
    expect(isSite({ ...fixture, schemaVersion: SITE_SCHEMA_VERSION + 1 })).toBe(
      false,
    )
    const listen = { ...fixture.listen, url: "javascript:alert(1)" }
    expect(isSite({ ...fixture, listen })).toBe(false)
    const { portfolio, tokens } = fixture
    const short = { ...portfolio, value: portfolio.value.slice(1) }
    expect(isSite({ ...fixture, portfolio: short })).toBe(false)
    const gap = {
      ...portfolio,
      benchmark: [null, ...portfolio.benchmark.slice(1)],
    }
    expect(isSite({ ...fixture, portfolio: gap })).toBe(false)
    const one = { days: ["2026-10-23"], index: [1], benchmark: [600] }
    expect(isSite({ ...fixture, portfolio: one })).toBe(false)
    expect(isSite({ ...fixture, tokens: { ...tokens, recent: [] } })).toBe(
      false,
    )
    const top = { model: "claude-opus-5-5", share: 1.2 }
    expect(isSite({ ...fixture, tokens: { ...tokens, top } })).toBe(false)
    expect(isSite({ ...fixture, tokens: { ...tokens, top: null } })).toBe(true)
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

describe("tokensLabel", () => {
  it("claims today only for today's payload", () => {
    expect(tokensLabel("2026-09-27", "2026-09-27")).toBe("Tokens today")
    expect(tokensLabel("2026-09-26", "2026-09-27")).toBe("Tokens yesterday")
    expect(tokensLabel("2026-09-20", "2026-09-27")).toBe("Tokens on Sep 20")
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

  it("puts the week's busiest model after its share", () => {
    expect(topModelText({ model: "claude-opus-5-5", share: 0.981 })).toBe(
      "98% Claude Opus 5.5",
    )
    expect(topModelText({ model: "deepseek-v4-flash", share: 0.5 })).toBe(
      "50% DeepSeek V4 Flash",
    )
  })

  it("draws two weeks of bars, the busiest full height, on a root scale", () => {
    const bars = tokenBars([0, 25, 100], "2026-09-27")
    expect(bars.map(({ height }) => height)).toEqual([0, 0.5, 1])
    expect(bars.map(({ title }) => title)).toEqual([
      "Sep 25: 0",
      "Sep 26: 25",
      "Sep 27: 100",
    ])
    expect(tokenBars([0, 0], "2026-09-27").map(({ height }) => height)).toEqual(
      [0, 0],
    )
  })
})

describe("portfolioView", () => {
  const portfolio = {
    days: ["2026-07-23", "2026-07-24", "2026-10-23"],
    value: [1, 0.9, 1.1],
    invested: [1, 1, 1],
    benchmark: [600, 630, 600],
  }

  it("measures what the money did, against the same money in the S&P 500", () => {
    const view = portfolioView(portfolio)
    expect(view.change).toBeCloseTo(0.1)
    expect(view.dir).toBe("up")
    expect(view.figure).toBe("+10.00%")
    expect(view.foot).toEqual(["S&P 500 0.00%"])
    expect(view.title).toBe(
      "Portfolio, Jul 23 – Oct 23: +10.00%\nS&P 500 0.00%",
    )
    expect([view.from, view.to]).toEqual(["Jul 23", "Oct 23"])
  })

  it("puts both lines on one scale, from zero", () => {
    const view = portfolioView(portfolio)
    const ys = (points: string) =>
      points.split(" ").map((point) => Number(point.split(",")[1]))
    const line = ys(view.line)
    const ghost = ys(view.ghost)
    expect(view.line.split(" ")[0].startsWith("0,")).toBe(true)
    expect(view.line.split(" ")[2].startsWith("100,")).toBe(true)
    expect(ghost[0]).toBe(line[0])
    expect(view.base).toBe(line[0])
    expect(view.end).toBe(line[2])
    // The highest value is nearest the top; padding keeps it off the edge.
    expect(Math.min(...line, ...ghost)).toBeGreaterThan(0)
    expect(Math.max(...line, ...ghost)).toBeLessThan(100)
    expect(view.area).toBe(`0,100 ${view.line} 100,100`)
  })

  it("cuts the line into day cells with their direction", () => {
    const { cells } = portfolioView(portfolio)
    expect(cells).toHaveLength(2)
    expect(cells.map(({ dir }) => dir)).toEqual(["down", "up"])
    expect(cells[1].title).toBe("Oct 23 +22.22%")
  })

  it("reads the pinned fixture", () => {
    const view = portfolioView(fixture.portfolio)
    expect(view.cells).toHaveLength(fixture.portfolio.days.length - 1)
    expect(view.figure).toMatch(/^[+−]?\d+\.\d{2}%$/)
  })
})
