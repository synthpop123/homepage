import { describe, expect, it } from "bun:test"
import { windowDurationMs, windowFoot, windowIsOpen } from "./quota"

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

describe("windowFoot", () => {
  it("hides the placeholder reset at 0%", () => {
    expect(
      windowFoot(
        {
          label: "Session",
          usedPercent: 0,
          resetsAt: "2026-08-27T11:00:00Z",
        },
        now,
        capturedAt,
      ),
    ).toBe("")
  })

  it("shows the countdown for a 0% window that has already been anchored", () => {
    expect(
      windowFoot(
        {
          label: "Session",
          usedPercent: 0,
          resetsAt: "2026-08-27T10:50:00Z",
        },
        now,
        capturedAt,
      ),
    ).toContain("in 4h")
  })

  it("shows the countdown once spend has anchored the window", () => {
    expect(
      windowFoot(
        {
          label: "Session",
          usedPercent: 5,
          resetsAt: "2026-08-27T11:00:00Z",
        },
        now,
        capturedAt,
      ),
    ).toContain("in 5h")
  })

  it("says the window reset once the vendor timestamp has passed", () => {
    expect(
      windowFoot(
        {
          label: "Session",
          usedPercent: 12,
          resetsAt: "2026-08-27T05:00:00Z",
        },
        now,
        capturedAt,
      ),
    ).toBe("window reset — awaiting next report")
  })
})
