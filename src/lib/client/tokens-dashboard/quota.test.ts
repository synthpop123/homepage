import { describe, expect, it } from "bun:test"
import {
  allowanceView,
  followUpDue,
  formatMoney,
  paceTitle,
  windowDurationMs,
  windowElapsed,
  windowHasReset,
  windowIsOpen,
  windowView,
} from "./quota"

const capturedAt = Date.parse("2026-08-27T06:00:00Z")
const now = capturedAt

describe("windowDurationMs", () => {
  it("maps the published Session and Weekly names", () => {
    expect(windowDurationMs("Session")).toBe(5 * 60 * 60 * 1000)
    expect(windowDurationMs("Weekly")).toBe(7 * 24 * 60 * 60 * 1000)
  })

  it("reads a scoped ceiling by the window it extends", () => {
    expect(windowDurationMs("Weekly · Opus")).toBe(7 * 24 * 60 * 60 * 1000)
  })

  it("parses a trailing duration on additional-limit labels", () => {
    expect(windowDurationMs("Spark 5h")).toBe(5 * 60 * 60 * 1000)
    expect(windowDurationMs("2d")).toBe(2 * 24 * 60 * 60 * 1000)
  })

  it("measures Monthly back one calendar month from its reset", () => {
    // OpenCode Go's live anchor: Oct 23 → Nov 23 is 31 days.
    expect(windowDurationMs("Monthly", "2026-11-23T10:05:46.000Z")).toBe(
      31 * 24 * 60 * 60 * 1000,
    )
    // A day the previous month lacks is held to its last: Feb 28 → Mar 31.
    expect(windowDurationMs("Monthly", "2026-03-31T00:00:00Z")).toBe(
      31 * 24 * 60 * 60 * 1000,
    )
  })

  it("returns null when the length cannot be known", () => {
    expect(windowDurationMs("Mystery")).toBeNull()
    expect(windowDurationMs("Monthly")).toBeNull()
  })
})

describe("windowIsOpen", () => {
  it("opens an untouched Monthly window anchored to its subscription day", () => {
    // OpenCode Go names a real reset even at 0%: the billing anchor,
    // not a placeholder drifting with the clock.
    expect(
      windowIsOpen(
        {
          label: "Monthly",
          usedPercent: 0,
          resetsAt: "2026-09-20T10:05:46.000Z",
        },
        capturedAt,
      ),
    ).toBe(true)
  })

  it("treats OpenAI's unused placeholder as closed", () => {
    // resetsAt ≈ capturedAt + 5h, the shape that drifts on every poll.
    expect(
      windowIsOpen(
        {
          label: "Session",
          usedPercent: 0,
          resetsAt: "2026-08-27T10:59:58.000Z",
        },
        capturedAt,
      ),
    ).toBe(false)
  })

  it("opens a 0% window once remaining is clearly shorter than full", () => {
    // Live shape after a tiny Codex spend: used_percent stays int 0,
    // but reset_after_seconds is already ~10 minutes into the window.
    expect(
      windowIsOpen(
        {
          label: "Session",
          usedPercent: 0,
          resetsAt: "2026-08-27T10:50:00Z",
        },
        capturedAt,
      ),
    ).toBe(true)
  })

  it("stays closed when Anthropic omits the reset", () => {
    expect(
      windowIsOpen(
        { label: "Weekly", usedPercent: 0, resetsAt: null },
        capturedAt,
      ),
    ).toBe(false)
  })

  it("opens on recorded spend regardless of remaining", () => {
    expect(
      windowIsOpen(
        {
          label: "Session",
          usedPercent: 5,
          resetsAt: "2026-08-27T11:00:00Z",
        },
        capturedAt,
      ),
    ).toBe(true)
  })

  it("does not invent an open window for an unknown label at 0%", () => {
    expect(
      windowIsOpen(
        {
          label: "Mystery",
          usedPercent: 0,
          resetsAt: "2026-08-27T08:00:00Z",
        },
        capturedAt,
      ),
    ).toBe(false)
  })
})

describe("windowHasReset", () => {
  it("is true once the vendor's reset time is behind us", () => {
    // The live shape: a 5h window that rolled over between two reports.
    expect(
      windowHasReset(
        {
          label: "Session",
          usedPercent: 11,
          resetsAt: "2026-08-27T05:59:00Z",
        },
        now,
        capturedAt,
      ),
    ).toBe(true)
  })

  it("is false while the window is still running", () => {
    expect(
      windowHasReset(
        {
          label: "Session",
          usedPercent: 11,
          resetsAt: "2026-08-27T09:00:00Z",
        },
        now,
        capturedAt,
      ),
    ).toBe(false)
  })

  it("is false for a window the vendor never anchored", () => {
    expect(
      windowHasReset(
        { label: "Weekly", usedPercent: 0, resetsAt: null },
        now,
        capturedAt,
      ),
    ).toBe(false)
  })
})

describe("followUpDue", () => {
  const site = (resetsAt: string) => ({
    quota: [
      {
        capturedAt: "2026-08-27T06:00:00Z",
        windows: [{ label: "Session", usedPercent: 30, resetsAt }],
      },
    ],
  })
  const reset = Date.parse("2026-08-27T07:00:00Z")
  const min = 60_000

  it("fires once, in the minute the collector's report should land", () => {
    const due = (at: number) =>
      followUpDue(site("2026-08-27T07:00:00Z") as never, at)
    expect(due(reset + 1 * min)).toBe(false)
    expect(due(reset + 2 * min)).toBe(true)
    expect(due(reset + 2.9 * min)).toBe(true)
    expect(due(reset + 3 * min)).toBe(false)
  })

  it("ignores a window still counting down", () => {
    expect(
      followUpDue(site("2026-08-27T07:00:00Z") as never, reset - 2 * min),
    ).toBe(false)
  })
})

describe("windowView", () => {
  it("names what starts an unanchored window rather than going blank", () => {
    expect(
      windowView(
        {
          label: "Session",
          usedPercent: 0,
          resetsAt: "2026-08-27T11:00:00Z",
        },
        now,
        capturedAt,
      ),
    ).toEqual({
      state: "idle",
      used: 0,
      foot: "on standby",
      title: "The clock starts at first use",
    })
  })

  it("counts down a 0% window that has already been anchored", () => {
    const view = windowView(
      { label: "Session", usedPercent: 0, resetsAt: "2026-08-27T10:50:00Z" },
      now,
      capturedAt,
    )
    expect(view.state).toBe("open")
    expect(view.foot).toBe("resets in 4h 50m")
  })

  it("counts down once spend has anchored the window", () => {
    const view = windowView(
      { label: "Session", usedPercent: 5, resetsAt: "2026-08-27T11:00:00Z" },
      now,
      capturedAt,
    )
    expect(view).toMatchObject({ state: "open", used: 5 })
    expect(view.foot).toBe("resets in 5h")
    expect(view.title).toBe("Resets Aug 27, 19:00")
  })

  it("starts a rolled-over window from zero and says it is unreported", () => {
    const view = windowView(
      { label: "Session", usedPercent: 12, resetsAt: "2026-08-27T05:00:00Z" },
      now,
      capturedAt,
    )
    expect(view).toMatchObject({ state: "reset", used: 0 })
    expect(view.foot).toBe("reset 1h ago")
  })

  it("rolls over while the page is open, not only on load", () => {
    const window = {
      label: "Session",
      usedPercent: 40,
      resetsAt: "2026-08-27T07:00:00Z",
    }
    expect(windowView(window, now, capturedAt).state).toBe("open")
    expect(windowView(window, now + 2 * 3_600_000, capturedAt).state).toBe(
      "reset",
    )
  })

  it("clamps the reported figure to the gauge", () => {
    expect(
      windowView(
        { label: "Weekly", usedPercent: 104, resetsAt: "2026-08-28T06:00:00Z" },
        now,
        capturedAt,
      ).used,
    ).toBe(100)
  })
})

describe("windowElapsed", () => {
  it("places a Monthly window on its own month", () => {
    // Nov 23 reset, 30 days of a 31-day month still to go.
    const resetsAt = "2026-11-23T10:05:46.000Z"
    const at = Date.parse(resetsAt) - 30 * 24 * 60 * 60 * 1000
    expect(
      windowElapsed({ label: "Monthly", usedPercent: 0, resetsAt }, at),
    ).toBeCloseTo(1 / 31)
  })

  it("measures the window back from its reset", () => {
    // A weekly window resetting in 5.6 days is a fifth gone.
    const resetsAt = new Date(now + 5.6 * 24 * 60 * 60 * 1000).toISOString()
    expect(
      windowElapsed({ label: "Weekly", usedPercent: 11, resetsAt }, now),
    ).toBeCloseTo(0.2)
  })

  it("has nothing to say without a length or a reset", () => {
    const resetsAt = "2026-08-28T00:00:00Z"
    expect(
      windowElapsed({ label: "Mystery", usedPercent: 1, resetsAt }, now),
    ).toBeNull()
    expect(
      windowElapsed({ label: "Weekly", usedPercent: 1, resetsAt: null }, now),
    ).toBeNull()
  })
})

describe("paceTitle", () => {
  it("compares spend to the share of the window gone", () => {
    expect(paceTitle(40, 0.2)).toBe("40% used with 20% of the window gone")
  })
})

describe("allowanceView", () => {
  const allowance = {
    label: "Cloud session credits",
    usedDollars: 25.5,
    limitDollars: 100,
    expiresAt: "2026-09-01T06:00:00Z",
  }

  it("measures dollars against the ceiling", () => {
    expect(allowanceView(allowance, now)).toMatchObject({
      state: "open",
      used: 25.5,
      figure: "$25.50",
      foot: "expires in 5d",
      total: "$100 total",
    })
  })

  it("reads a passed expiry as lapsed, not refilled", () => {
    const view = allowanceView(
      { ...allowance, expiresAt: "2026-08-27T05:00:00Z" },
      now,
    )
    expect(view).toMatchObject({
      state: "expired",
      used: 25.5,
      figure: "$25.50",
      total: "$100 total",
    })
    expect(view.foot).toBe("expired 1h ago")
  })

  it("says so when the vendor dates nothing", () => {
    expect(allowanceView({ ...allowance, expiresAt: null }, now).foot).toBe(
      "no expiry reported",
    )
  })
})

describe("formatMoney", () => {
  it("keeps whole amounts whole", () => {
    expect(formatMoney(100)).toBe("$100")
    expect(formatMoney(0)).toBe("$0")
    expect(formatMoney(1250)).toBe("$1,250")
  })

  it("survives a currency code Intl does not know", () => {
    expect(formatMoney(5, "ZZZZ")).toBe("5 ZZZZ")
  })
})
