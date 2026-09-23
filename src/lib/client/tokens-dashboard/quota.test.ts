import { describe, expect, it } from "bun:test"
import {
  windowDurationMs,
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

  it("parses a trailing duration on additional-limit labels", () => {
    expect(windowDurationMs("Spark 5h")).toBe(5 * 60 * 60 * 1000)
    expect(windowDurationMs("2d")).toBe(2 * 24 * 60 * 60 * 1000)
  })

  it("returns null when the length cannot be known", () => {
    expect(windowDurationMs("Mystery")).toBeNull()
  })
})

describe("windowIsOpen", () => {
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
    ).toEqual({ state: "idle", used: 0, foot: "starts on first use" })
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
    expect(view.foot).toBe("reset 1h ago · awaiting report")
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
