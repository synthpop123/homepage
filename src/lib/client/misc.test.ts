import { afterEach, describe, expect, it, setSystemTime } from "bun:test"
import { miscSection } from "./misc"

const realFetch = globalThis.fetch

const serve = () => {
  let calls = 0
  globalThis.fetch = (async () => {
    calls++
    return Response.json({ music: { n: calls }, movies: null })
  }) as unknown as typeof fetch
  return () => calls
}

afterEach(() => {
  globalThis.fetch = realFetch
  setSystemTime()
})

describe("miscSection", () => {
  it("shares one request between sections asking together", async () => {
    const calls = serve()
    setSystemTime(new Date("2026-10-01T00:00:00Z"))
    const [a, b] = await Promise.all([
      miscSection("https://api.test/a", "music"),
      miscSection("https://api.test/a", "music"),
    ])
    expect(a).toEqual({ n: 1 })
    expect(b).toEqual({ n: 1 })
    expect(calls()).toBe(1)
  })

  it("asks afresh once the bundle is past its sharing window", async () => {
    const calls = serve()
    setSystemTime(new Date("2026-10-01T00:00:00Z"))
    await miscSection("https://api.test/b", "music")
    setSystemTime(new Date("2026-10-01T00:05:00Z"))
    expect(await miscSection("https://api.test/b", "music")).toEqual({ n: 2 })
    expect(calls()).toBe(2)
  })

  it("rejects a section the Worker had nothing for", async () => {
    serve()
    await expect(miscSection("https://api.test/c", "movies")).rejects.toThrow(
      "No movies snapshot",
    )
  })
})
