import { existsSync } from "node:fs"
import type { Element } from "hast"
import { defineHastPlugin } from "satteri"
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
