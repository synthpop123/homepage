/**
 * Static link check over the built site (run after `astro build`; CI
 * wires it in). Walks every HTML file in dist/, extracts internal
 * href/src/srcset targets, and verifies each one resolves to a file
 * the build actually produced — including `#fragment` anchors, which
 * must match an id in the target page. External URLs are out of
 * scope: this guards the site's own routing, not the internet.
 *
 * Exits non-zero listing every broken link with the page it came from.
 */
import { existsSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { Glob } from "bun"

const dist = path.join(process.cwd(), "dist")

if (!existsSync(dist)) {
  console.error("[check-links] dist/ not found — run `bun run build` first")
  process.exit(1)
}

const pages = [...new Glob("**/*.html").scanSync({ cwd: dist })].sort()

const EXTERNAL =
  /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i /* scheme: or protocol-relative */

// Quoted attributes only: code samples inside <code> carry escaped
// (&quot;) or unquoted lookalikes that must not count as links.
const ATTR = /\s(?:href|src)=(?:"([^"]*)"|'([^']*)')/gi
const SRCSET = /\ssrcset=(?:"([^"]*)"|'([^']*)')/gi
const ID = /\sid=(?:"([^"]*)"|'([^']*)')/gi

/** Extracted ids per page, for fragment checks (filled lazily). */
const idCache = new Map<string, Set<string>>()

const pageIds = (file: string) => {
  let ids = idCache.get(file)
  if (!ids) {
    ids = new Set()
    for (const match of readFileSync(file, "utf8").matchAll(ID)) {
      ids.add(match[1] ?? match[2] ?? match[3])
    }
    idCache.set(file, ids)
  }
  return ids
}

/** Map a site-absolute pathname to the dist file that serves it. */
const resolveTarget = (pathname: string): string | null => {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  const base = path.join(dist, decoded)
  const candidates = decoded.endsWith("/")
    ? [path.join(base, "index.html")]
    : [base, path.join(base, "index.html"), `${base}.html`]
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return null
}

type Broken = { page: string; link: string; reason: string }
const broken: Broken[] = []
let checked = 0

for (const page of pages) {
  const html = readFileSync(path.join(dist, page), "utf8")
  // The page's canonical URL directory, for resolving relative links.
  const route = `/${page.endsWith("index.html") ? page.slice(0, -"index.html".length) : page}`

  const links: string[] = []
  for (const match of html.matchAll(ATTR)) {
    links.push(match[1] ?? match[2] ?? match[3])
  }
  for (const match of html.matchAll(SRCSET)) {
    for (const entry of (match[1] ?? match[2]).split(",")) {
      const url = entry.trim().split(/\s+/)[0]
      if (url) links.push(url)
    }
  }

  for (const link of links) {
    if (!link || link.startsWith("#") || EXTERNAL.test(link)) continue
    checked++
    const url = new URL(link, `https://site.invalid${route}`)
    const target = resolveTarget(url.pathname)
    if (!target) {
      broken.push({ page, link, reason: "no such page or asset" })
      continue
    }
    const fragment = decodeURIComponent(url.hash.slice(1))
    if (
      fragment &&
      target.endsWith(".html") &&
      !pageIds(target).has(fragment)
    ) {
      broken.push({ page, link, reason: `no id "${fragment}" in target` })
    }
  }
}

if (broken.length > 0) {
  console.error(`[check-links] ${broken.length} broken internal link(s):`)
  for (const { page, link, reason } of broken) {
    console.error(`  ${page} → ${link} (${reason})`)
  }
  process.exit(1)
}

console.log(
  `[check-links] ok — ${checked} internal links across ${pages.length} pages`,
)
