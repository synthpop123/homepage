/**
 * Tests for the URL trust boundary that keeps remote feed payloads
 * (Letterboxd, Mastodon) from writing non-http(s) URLs into the DOM,
 * and for the stale-while-revalidate delivery discipline — in
 * particular that a cached copy the renderer chokes on never blocks
 * the revalidation that would recover from it. The fetch helper is
 * browser-only and exercised by the feeds themselves.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { safeHttpUrl, swr } from "./feed"

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
  // bun:test has no DOM; stand in for the browser's sessionStorage.
  const store = new Map<string, string>()

  beforeEach(() => {
    store.clear()
    globalThis.sessionStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
      key: () => null,
      get length() {
        return store.size
      },
    } as Storage
  })

  afterEach(() => {
    Reflect.deleteProperty(globalThis, "sessionStorage")
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
