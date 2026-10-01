/**
 * The /misc bundle: the Flights, Movies, Music and Switch snapshots in
 * one response from cf-workers-api (`GET /misc`), so the page makes one
 * request instead of four racing for the first paint — the one misc.astro
 * preloads.
 *
 * Each section is fetched by its own component, through its own decoder
 * and its own `swr` cache key; the first to ask starts the request and the
 * rest share it. The four ask together — on load, and again on each
 * `keepFresh` reload, whose clocks start in the same moment — so a bundle
 * is shared for `SHARE_MS` and the next round asks the Worker afresh. A
 * section the Worker had nothing for arrives as `null`, which rejects that
 * section alone into its fallback.
 */

import { fetchJson, isRecord } from "./feed"

type MiscSection = "flights" | "movies" | "music" | "switch"

const SHARE_MS = 30_000

const bundles = new Map<
  string,
  { at: number; data: Promise<Record<string, unknown>> }
>()

export function miscSection(
  endpoint: string,
  name: MiscSection,
): Promise<unknown> {
  const now = Date.now()
  let bundle = bundles.get(endpoint)
  if (!bundle || now - bundle.at >= SHARE_MS) {
    const data = fetchJson<unknown>(endpoint).then((body) => {
      if (!isRecord(body)) throw new Error("Unexpected bundle shape")
      return body
    })
    const entry = { at: now, data }
    // A failed request is not shared, so a retry asks again.
    data.catch(() => {
      if (bundles.get(endpoint) === entry) bundles.delete(endpoint)
    })
    bundle = entry
    bundles.set(endpoint, bundle)
  }
  return bundle.data.then((data) => {
    const section = data[name]
    if (section === null || section === undefined) {
      throw new Error(`No ${name} snapshot`)
    }
    return section
  })
}
