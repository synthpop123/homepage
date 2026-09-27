import type { Element, ElementContent, Text } from "hast"

/**
 * The mark an external link in a post wears after its text: a site's own
 * logo where there is one (Simple Icons, CC0, vendored under
 * `src/assets/icons/sites/`), the `external` arrow otherwise. Each slug is
 * a file there and a `[data-site-icon]` rule in `src/styles/site-icons.css`.
 */

/** Hosts this site answers on: links to them are not external. */
const OWN_HOSTS = new Set(["lkwplus.com", "www.lkwplus.com"])

/** A host, or any subdomain of it, and the mark it wears. */
export const SITE_ICONS: readonly (readonly [string, string])[] = [
  ["github.com", "github"],
  ["x.com", "x"],
  ["twitter.com", "x"],
  ["docker.com", "docker"],
  ["grafana.com", "grafana"],
  ["ubuntu.com", "ubuntu"],
  ["launchpad.net", "launchpad"],
  ["debian.org", "debian"],
  ["wikipedia.org", "wikipedia"],
  ["reddit.com", "reddit"],
  ["renovatebot.com", "renovate"],
  ["wakatime.com", "wakatime"],
  ["zed.dev", "zedindustries"],
  ["starship.rs", "starship"],
  ["readthedocs.io", "readthedocs"],
  ["letterboxd.com", "letterboxd"],
  ["last.fm", "lastdotfm"],
  ["apple.com", "apple"],
  ["stackexchange.com", "stackexchange"],
  ["caddyserver.com", "caddy"],
  ["n8n.io", "n8n"],
]

export const GENERIC_ICON = "external"

/** Every slug a link can wear, the generic one included. */
export const iconSlugs = () => [
  ...new Set([...SITE_ICONS.map(([, slug]) => slug), GENERIC_ICON]),
]

/**
 * The mark for an http(s) href, or `null` when it is not an external link:
 * not http(s), unparseable, or on this site's own host.
 */
export function siteIcon(href: string): string | null {
  if (!/^https?:\/\//i.test(href)) return null
  let host: string
  try {
    host = new URL(href).hostname.toLowerCase()
  } catch {
    return null
  }
  if (OWN_HOSTS.has(host)) return null
  const match = SITE_ICONS.find(
    ([suffix]) => host === suffix || host.endsWith(`.${suffix}`),
  )
  return match ? match[1] : GENERIC_ICON
}

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u

/** Longest last word that is glued whole; past it only its last character is. */
const MAX_GLUED = 20

const text = (value: string): Text => ({ type: "text", value })

const glued = (children: ElementContent[]): Element => ({
  type: "element",
  tagName: "span",
  properties: { dataGlue: true },
  children,
})

/**
 * A link's children with `icon` appended, glued to the last word inside a
 * `span[data-glue]` (`white-space: nowrap`) so the mark never starts a line
 * alone. A long word, or CJK text with no spaces to find a word by, gives
 * up only its last character, so the glue never makes a line overflow.
 */
export function glueIcon(
  children: readonly ElementContent[],
  icon: Element,
): ElementContent[] {
  const last = children.at(-1)
  if (!last) return [icon]
  const rest = children.slice(0, -1)
  if (last.type === "text") {
    const value = last.value.trimEnd()
    const word = /\S+$/.exec(value)?.[0] ?? ""
    if (!word) return [...children, icon]
    const chars = [...word]
    const tail =
      chars.length > MAX_GLUED || CJK.test(word) ? (chars.at(-1) ?? "") : word
    const head = value.slice(0, value.length - tail.length)
    return [...rest, ...(head ? [text(head)] : []), glued([text(tail), icon])]
  }
  if (last.type === "element" && textLength(last) <= MAX_GLUED)
    return [...rest, glued([last, icon])]
  return [...children, icon]
}

function textLength(node: ElementContent): number {
  if (node.type === "text") return [...node.value].length
  if (node.type === "element")
    return node.children.reduce((sum, child) => sum + textLength(child), 0)
  return 0
}

/** Whether a link wraps an image, which gets no mark. */
export function wrapsImage(node: Element): boolean {
  return node.children.some((child) =>
    child.type === "element"
      ? ["img", "picture", "svg", "video"].includes(child.tagName) ||
        wrapsImage(child)
      : child.type === "raw" && /<(img|picture|svg|video)\b/i.test(child.value),
  )
}

export const iconElement = (slug: string): Element => ({
  type: "element",
  tagName: "span",
  properties: { dataSiteIcon: slug, ariaHidden: "true" },
  children: [],
})
