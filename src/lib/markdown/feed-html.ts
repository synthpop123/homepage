import { defineMdastPlugin } from "satteri"

const CALLOUTS = new Set(["note", "tip", "warning", "caution", "important"])

/**
 * Callouts as a feed reader can show them: a blockquote opened by its
 * kind in bold, where the page has a collapsible <details> with icons.
 */
export const feedCallouts = defineMdastPlugin({
  name: "feed-callouts",
  containerDirective(node, ctx) {
    if (!CALLOUTS.has(node.name)) return
    const kind = node.name.charAt(0).toUpperCase() + node.name.slice(1)
    const first = node.children?.[0]
    const label =
      first?.type === "paragraph" &&
      (first.data as { directiveLabel?: boolean })?.directiveLabel === true
    if (label) {
      ctx.prependChild(first, {
        type: "strong",
        children: [{ type: "text", value: `${kind}: ` }],
      })
    } else {
      ctx.prependChild(node, {
        type: "paragraph",
        children: [
          { type: "strong", children: [{ type: "text", value: kind }] },
        ],
      })
    }
    ctx.setProperty(node, "data", { hName: "blockquote" })
  },
})

/**
 * A rendered post's HTML made fit for a feed reader, which runs none of
 * the page's scripts, loads none of its styles and resolves root-relative
 * URLs against nothing: inline <script>/<style> go, and every `/…` in
 * src, href and srcset gains the site's origin.
 */
export function feedHtml(html: string, site: URL | string): string {
  const origin = new URL(site).origin
  const absolute = (url: string) =>
    url.startsWith("/") && !url.startsWith("//") ? `${origin}${url}` : url
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(
      /(\s(?:src|href)=")([^"]*)"/g,
      (_, attr: string, url: string) => `${attr}${absolute(url)}"`,
    )
    .replace(
      /(\ssrcset=")([^"]*)"/g,
      (_, attr: string, set: string) =>
        `${attr}${set
          .split(",")
          .map((candidate) => candidate.trim().replace(/^\S+/, absolute))
          .join(", ")}"`,
    )
}
