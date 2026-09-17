/** The one network call the dashboard makes. */
import { fetchJson, swr } from "../feed"
import { isSite, SITE_SCHEMA_VERSION, type Site } from "./schema"

/**
 * One request for the whole page. Unlike the leisurely feeds this one
 * is freshness-critical, so it takes the stale-while-revalidate path:
 * the copy localStorage kept from any earlier visit (any age, any tab)
 * is delivered synchronously for an instant first paint, then the
 * network answer follows — cheap, since the collector revalidates by
 * ETag and an unchanged payload is a ~0-byte 304 out of the browser's
 * HTTP cache. The build's own schema version is part of the cache key,
 * so a deploy that bumps the contract never even reads the previous
 * build's entries — `swr` sweeps them once the new one is written (an
 * entry it can no longer decode is dropped by isSite anyway — belt and
 * braces).
 */
export const loadSite = (
  endpoint: string,
  onSite: (site: Site) => void,
): Promise<void> =>
  swr(
    `tokens:site:v${SITE_SCHEMA_VERSION}:${endpoint}`,
    () => fetchJson<Site>(`${endpoint}/api/site`),
    isSite,
    onSite,
  )
