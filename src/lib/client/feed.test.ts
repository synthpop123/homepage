/**
 * Tests for the URL trust boundary that keeps remote feed payloads
 * (Letterboxd, Mastodon) from writing non-http(s) URLs into the DOM.
 * The storage/fetch helpers in feed.ts are browser-only and are
 * exercised by the feeds themselves.
 */

import { describe, expect, it } from "bun:test"
import { safeHttpUrl } from "./feed"

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
