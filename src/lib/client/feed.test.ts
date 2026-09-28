/**
 * Tests for the URL trust boundary that keeps remote feed payloads
 * (Letterboxd, Mastodon) from writing non-http(s) URLs into the DOM,
 * and for the stale-while-revalidate delivery discipline — in
 * particular that a cached copy the renderer chokes on never blocks
 * the revalidation that would recover from it. The fetch helper is
 * browser-only and exercised by the feeds themselves.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import {
  calendarDay,
  dateFormatter,
  dayInstant,
  daysBetween,
  safeHttpUrl,
  relativeTime,
  shiftDays,
  swr,
} from "./feed"

describe("dayInstant", () => {
  it("reads back as the same day in UTC and in the site's zone", () => {
    const at = dayInstant("2026-09-22")
    expect(at.toISOString().slice(0, 10)).toBe("2026-09-22")
    expect(dateFormatter.format(at)).toBe("Sep 22, 2026")
  })

  it("takes a timestamp's date part", () => {
    expect(dayInstant("2026-09-22T23:30:00+08:00").getUTCDate()).toBe(22)
  })
})

describe("shiftDays and daysBetween", () => {
  it("step across months, years and leap days", () => {
    expect(shiftDays("2026-02-28", 1)).toBe("2026-03-01")
    expect(shiftDays("2024-02-28", 1)).toBe("2024-02-29")
    expect(shiftDays("2026-01-01", -1)).toBe("2025-12-31")
    expect(daysBetween("2025-12-31", "2026-01-02")).toBe(2)
    expect(daysBetween("2026-09-27", "2026-09-20")).toBe(-7)
  })
})

describe("relativeTime", () => {
  const now = Date.parse("2026-09-27T12:00:00Z")
  it("counts up through minutes, hours and days, then names the date", () => {
    expect(relativeTime("2026-09-27T11:59:30Z", now)).toBe("just now")
    expect(relativeTime("2026-09-27T11:48:00Z", now)).toBe("12m ago")
    expect(relativeTime("2026-09-27T09:00:00Z", now)).toBe("3h ago")
    expect(relativeTime("2026-09-26T05:00:00Z", now)).toBe("yesterday")
    expect(relativeTime("2026-09-23T12:00:00Z", now)).toBe("4d ago")
    expect(relativeTime("2026-09-12T12:00:00Z", now)).toBe("Sep 12")
  })

  it("rounds down, so one listen reads the same everywhere", () => {
    expect(relativeTime("2026-09-27T10:30:00Z", now)).toBe("1h ago")
    expect(relativeTime(now - 90_000, now)).toBe("1m ago")
    expect(relativeTime(new Date(now - 47 * 3_600_000), now)).toBe("yesterday")
  })
})

describe("calendarDay", () => {
  it("names the day in the site's zone, not the visitor's", () => {
    expect(calendarDay(Date.parse("2026-09-27T15:59:00Z"))).toBe("2026-09-27")
    expect(calendarDay(Date.parse("2026-09-27T16:00:00Z"))).toBe("2026-09-28")
    expect(calendarDay(Date.parse("2026-01-01T00:00:00Z"))).toBe("2026-01-01")
  })
})

describe("safeHttpUrl", () => {
  it("passes plain http(s) URLs through", () => {
    expect(safeHttpUrl("https://boxd.it/abc123")).toBe("https://boxd.it/abc123")
    expect(safeHttpUrl("http://example.com/a?b=c#d")).toBe(
      "http://example.com/a?b=c#d",
    )
  })

  it("rejects every other protocol", () => {
    // biome-ignore format: keep the attack strings on one line each
    for (const url of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "blob:https://example.com/uuid",
      "vbscript:msgbox",
      "file:///etc/passwd",
    ]) {
      expect(safeHttpUrl(url)).toBeNull()
    }
  })

  it("rejects non-strings and malformed URLs", () => {
    expect(safeHttpUrl(undefined)).toBeNull()
    expect(safeHttpUrl(null)).toBeNull()
    expect(safeHttpUrl(42)).toBeNull()
    expect(safeHttpUrl("not a url")).toBeNull()
    expect(safeHttpUrl("//protocol-relative.example")).toBeNull()
    expect(safeHttpUrl("/relative/path")).toBeNull()
  })
})

/* Stale-while-revalidate ------------------------------------------------ */

describe("swr", () => {
  // bun:test has no DOM; stand in for the browser's localStorage — the
  // area the stale-while-revalidate path persists to.
  const store = new Map<string, string>()

  beforeEach(() => {
    store.clear()
    globalThis.localStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
      key: (index: number) => [...store.keys()][index] ?? null,
      get length() {
        return store.size
      },
    } as Storage
  })

  afterEach(() => {
    Reflect.deleteProperty(globalThis, "localStorage")
  })

  type Payload = { id: string }
  const valid = (data: unknown): boolean =>
    typeof data === "object" && data !== null && "id" in data
  const seed = (data: unknown) =>
    store.set("k", JSON.stringify({ t: Date.now(), data }))

  it("paints the cached copy, then delivers the network answer", async () => {
    seed({ id: "stale" })
    const delivered: Payload[] = []
    await swr<Payload>(
      "k",
      () => Promise.resolve({ id: "fresh" }),
      valid,
      (data) => delivered.push(data),
    )
    expect(delivered).toEqual([{ id: "stale" }, { id: "fresh" }])
    expect(JSON.parse(store.get("k") ?? "{}").data).toEqual({ id: "fresh" })
  })

  it("still delivers the network answer when rendering the cache throws", async () => {
    // The recovery path: a cached payload that passes validation but
    // crashes a renderer must not abort the revalidation — the fresh
    // payload is exactly what recovers the page.
    seed({ id: "stale" })
    const delivered: Payload[] = []
    let first = true
    await swr<Payload>(
      "k",
      () => Promise.resolve({ id: "fresh" }),
      valid,
      (data) => {
        if (first) {
          first = false
          throw new Error("renderer crashed on the stale copy")
        }
        delivered.push(data)
      },
    )
    expect(delivered).toEqual([{ id: "fresh" }])
  })

  it("keeps the stale paint when the refresh fails", async () => {
    seed({ id: "stale" })
    const delivered: Payload[] = []
    await swr<Payload>(
      "k",
      () => Promise.reject(new Error("offline")),
      valid,
      (data) => delivered.push(data),
    )
    expect(delivered).toEqual([{ id: "stale" }])
  })

  it("rejects when the cached paint crashed and the refresh failed too", async () => {
    seed({ id: "stale" })
    let calls = 0
    await expect(
      swr<Payload>(
        "k",
        () => Promise.reject(new Error("offline")),
        valid,
        () => {
          calls += 1
          throw new Error("renderer crashed")
        },
      ),
    ).rejects.toThrow("offline")
    expect(calls).toBe(1)
  })

  it("rejects when there is nothing to show at all", async () => {
    await expect(
      swr<Payload>(
        "k",
        () => Promise.reject(new Error("offline")),
        valid,
        () => {},
      ),
    ).rejects.toThrow("offline")
  })

  it("sweeps the same feed's entries under other schema versions", async () => {
    // localStorage outlives deploys, so a version bump would otherwise
    // leave every previous build's payload behind for good. Other feeds
    // and unrelated keys are not the writer's to touch.
    const stale = JSON.stringify({ t: Date.now(), data: { id: "old" } })
    store.set("tokens:site:v13:https://t.example", stale)
    store.set("tokens:site:v12:https://t.example", stale)
    store.set("switch:site:v3:https://s.example", stale)
    store.set("tokens:controls", "{}")
    await swr<Payload>(
      "tokens:site:v14:https://t.example",
      () => Promise.resolve({ id: "fresh" }),
      valid,
      () => {},
    )
    expect([...store.keys()].sort()).toEqual([
      "switch:site:v3:https://s.example",
      "tokens:controls",
      "tokens:site:v14:https://t.example",
    ])
  })

  it("never hands out payloads that fail validation", async () => {
    seed({ nope: true })
    const delivered: Payload[] = []
    await expect(
      swr<Payload>(
        "k",
        () => Promise.resolve({ nope: true } as unknown as Payload),
        valid,
        (data) => delivered.push(data),
      ),
    ).rejects.toThrow("Unexpected payload shape")
    expect(delivered).toEqual([])
  })
})
