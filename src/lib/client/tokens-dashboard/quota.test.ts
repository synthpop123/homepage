import { describe, expect, it } from "bun:test"
import { windowFoot } from "./quota"

const now = Date.parse("2026-08-27T06:00:00Z")

describe("windowFoot", () => {
  // OpenAI still sends resetsAt ≈ now+window at 0% spend; that timestamp
  // drifts on every poll and is not a real open window.
  it("hides the reset on an untouched window even when the vendor sent one", () => {
    expect(
      windowFoot(
        {
          label: "Session",
          usedPercent: 0,
          resetsAt: "2026-08-27T11:00:00Z",
        },
        now,
      ),
    ).toBe("")
  })

  it("still hides when the vendor omitted the reset", () => {
    expect(
      windowFoot({ label: "Weekly", usedPercent: 0, resetsAt: null }, now),
    ).toBe("")
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
      ),
    ).toBe("window reset — awaiting next report")
  })
})
