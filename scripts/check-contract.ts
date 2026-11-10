/**
 * Holds the page's decoders to the Worker they read (cf-workers-api).
 *
 * Two checks, both against the Worker as it is, not a copy of it:
 *
 *   1. Versions: each decoder's SITE_SCHEMA_VERSION equals the Worker's
 *      `contract/versions.json` (its own tests hold that file to its
 *      code), read from the sibling checkout when there is one and from
 *      the repository's main branch otherwise. A decoder cannot move
 *      ahead of the Worker: the Worker ships first.
 *   2. Shapes: the body each view serves in production passes its
 *      decoder. A captured fixture pins the shape a decoder was written
 *      against; this is the shape it will actually be handed. A view
 *      that cannot be asked is a warning, not a failure: Cloudflare
 *      answers GitHub's runners 403, so in CI this half only runs where
 *      the API lets the runner in, and by hand it always does.
 *
 * Run by CI's `contract` job, and by hand after a shape change:
 *   bun run check:contract
 */

import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { API } from "../src/consts"
import * as flights from "../src/lib/client/flights"
import * as memos from "../src/lib/client/memos"
import * as movies from "../src/lib/client/movies"
import * as music from "../src/lib/client/music"
import * as now from "../src/lib/client/now"
import * as portfolio from "../src/lib/client/portfolio"
import * as switchPlay from "../src/lib/client/switch"
import * as tokens from "../src/lib/client/tokens/schema"

const DECODERS: Record<
  string,
  { SITE_SCHEMA_VERSION: number; isSite(data: unknown): boolean }
> = {
  tokens,
  switch: switchPlay,
  flights,
  music,
  movies,
  memos,
  portfolio,
  now,
}

const SIBLING = path.resolve(
  import.meta.dir,
  "../../cf-workers-api/contract/versions.json",
)
const PUBLISHED =
  "https://raw.githubusercontent.com/synthpop123/cf-workers-api/main/contract/versions.json"

const get = async (url: string) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) })
  if (!response.ok) throw new Error(`${url} answered ${response.status}`)
  return response.json() as Promise<unknown>
}

const versions = (
  existsSync(SIBLING)
    ? JSON.parse(readFileSync(SIBLING, "utf8"))
    : await get(PUBLISHED)
) as Record<string, number>

const problems: string[] = []
const unasked: string[] = []
for (const name of new Set([
  ...Object.keys(DECODERS),
  ...Object.keys(versions),
])) {
  const decoder = DECODERS[name]
  if (!decoder) {
    problems.push(`${name}: the Worker serves it, no decoder reads it`)
    continue
  }
  if (versions[name] !== decoder.SITE_SCHEMA_VERSION) {
    problems.push(
      `${name}: decoder is v${decoder.SITE_SCHEMA_VERSION}, the Worker's contract says v${versions[name]}`,
    )
  }
  try {
    const body = await get(`${API}/${name}/site`)
    if (!decoder.isSite(body)) {
      problems.push(`${name}: the live body does not pass its decoder`)
    }
  } catch (error) {
    unasked.push(`${name}: ${error instanceof Error ? error.message : error}`)
  }
}

if (problems.length > 0) {
  console.error(problems.map((line) => `✗ ${line}`).join("\n"))
  process.exit(1)
}
if (unasked.length > 0) {
  console.warn(unasked.map((line) => `! not asked: ${line}`).join("\n"))
}
const asked = Object.keys(DECODERS).length - unasked.length
console.log(
  `✓ ${Object.keys(DECODERS).length} versions match the Worker; ${asked} live bodies pass their decoders`,
)
