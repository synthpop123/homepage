/**
 * The /misc bundle: the Flights, Movies, Music and Switch snapshots in
 * one response from cf-workers-api (`GET /misc`), so the page makes one
 * request instead of four racing for the first paint — the one misc.astro
 * preloads.
 *
 * Each section is fetched by its own component, through its own decoder
 * and its own `swr` cache key; the first to ask starts the request and the
 * rest share it. A section the Worker had nothing for arrives as `null`,
 * which rejects that section alone into its fallback.
 */

import { fetchJson, isRecord } from "./feed"

export type MiscSection = "flights" | "movies" | "music" | "switch"

const bundles = new Map<string, Promise<Record<string, unknown>>>()

export function miscSection(
  endpoint: string,
  name: MiscSection,
): Promise<unknown> {
  let bundle = bundles.get(endpoint)
  if (!bundle) {
    bundle = fetchJson<unknown>(endpoint).then((data) => {
      if (!isRecord(data)) throw new Error("Unexpected bundle shape")
      return data
    })
    // A failed request is not memoized, so a retry asks again.
    bundle.catch(() => bundles.delete(endpoint))
    bundles.set(endpoint, bundle)
  }
  return bundle.then((data) => {
    const section = data[name]
    if (section === null || section === undefined) {
      throw new Error(`No ${name} snapshot`)
    }
    return section
  })
}
