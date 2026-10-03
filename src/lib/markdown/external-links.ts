import { existsSync } from "node:fs"
import type { Element } from "hast"
import { defineHastPlugin } from "satteri"
import { SITE_ORIGIN, sitePath } from "../site-links"
import {
  glueIcon,
  iconElement,
  iconSlugs,
  siteIcon,
  wrapsImage,
} from "./site-icons"

// A mark mapped in site-icons.ts with no file behind it fails the build
// here rather than rendering an empty square.
const ICONS = new URL("../../assets/icons/sites/", import.meta.url)
const missing = iconSlugs().filter(
  (slug) => !existsSync(new URL(`${slug}.svg`, ICONS)),
)
if (missing.length)
  throw new Error(`external-links: no icon file for ${missing.join(", ")}`)

export const externalLinks = defineHastPlugin({
  name: "external-links",
  element: {
    filter: ["a"],
    visit(node, ctx) {
      const href = node.properties.href
      if (typeof href !== "string" || !/^https?:\/\//.test(href)) return
      // A link back into the site, written out in full, is an internal
      // one: same tab, no arrow, and the post page can preview it.
      if (sitePath(href) !== null) {
        ctx.setProperty(node, "href", href.slice(SITE_ORIGIN.length))
        return
      }
      const slug = siteIcon(href)
      if (!slug || wrapsImage(node as Element)) {
        ctx.setProperty(node, "target", "_blank")
        ctx.setProperty(node, "rel", "nofollow noreferrer noopener")
        return
      }
      ctx.replaceNode(node, {
        ...(node as Element),
        properties: {
          ...node.properties,
          target: "_blank",
          rel: ["nofollow", "noreferrer", "noopener"],
        },
        children: glueIcon(node.children, iconElement(slug)),
      })
    },
  },
})
