/**
 * The site's own address, and how a link is recognised as pointing back
 * into it. Shared by `astro.config.ts` (the `site`), the external-links
 * plugin (which keeps such links in the same tab, without an arrow) and
 * the post page (which previews the posts a body links to). Free of
 * Astro imports, since the config loads it.
 */

export const SITE_ORIGIN = "https://lkwplus.com"

/** The path a link opens on this site — `/blog/x` for `/blog/x#y` or
 *  `https://lkwplus.com/blog/x` — or null for a link elsewhere (and for
 *  a relative one, which only the page it sits on can resolve). */
export function sitePath(href: string): string | null {
  if (href.startsWith("//")) return null
  if (!href.startsWith("/") && !href.startsWith(`${SITE_ORIGIN}/`)) {
    return null
  }
  const url = new URL(href, SITE_ORIGIN)
  return url.origin === SITE_ORIGIN ? url.pathname.replace(/\/+$/, "") : null
}

/** The post a link opens, by id (`komodo-gitops`, `parent/sub`), or null. */
export function linkedPostId(href: string): string | null {
  const path = sitePath(href)
  const match = path?.match(/^\/blog\/([^.]+)$/)
  return match ? decodeURIComponent(match[1]) : null
}

/** Every post a Markdown body links to, by id, in order of first link. */
export function postLinks(markdown: string): string[] {
  const ids = new Set<string>()
  for (const [, target] of markdown.matchAll(/\]\(\s*<?([^)\s>]+)/g)) {
    const id = linkedPostId(target)
    if (id) ids.add(id)
  }
  return [...ids]
}

/** The view-transition-name a post's title carries in a list and as its
 *  page's h1, so following the link morphs one into the other. A name is
 *  a CSS ident: anything past letters, digits, `-` and `_` becomes `_`,
 *  and the `post-` prefix keeps it from starting with a digit. */
export function titleTransition(id: string): string {
  return `post-${id.replace(/[^\w-]/g, "_")}`
}
