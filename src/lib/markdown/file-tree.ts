import type { List, ListItem, PhrasingContent } from "mdast"
import { defineMdastPlugin } from "satteri"

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")

const textOf = (node: PhrasingContent): string =>
  "value" in node
    ? node.value
    : "children" in node
      ? node.children.map(textOf).join("")
      : ""

/** A comment's inline Markdown: code stays code, the rest is its text. */
const inline = (nodes: PhrasingContent[]) =>
  nodes
    .map((node) =>
      node.type === "inlineCode"
        ? `<code>${escapeHtml(node.value)}</code>`
        : escapeHtml(textOf(node)),
    )
    .join("")

/**
 * One entry: the name is the item's first word, or its first `code` or
 * **bold** run (bold marks it), and whatever follows is its comment. An
 * entry with children, or a name ending in `/`, is a directory.
 */
function entry(item: ListItem): string {
  const [head, ...rest] = item.children
  const phrasing = head?.type === "paragraph" ? [...head.children] : []
  let name = ""
  let mark = false
  const first = phrasing.shift()
  if (first?.type === "strong" || first?.type === "inlineCode") {
    name = textOf(first)
    mark = first.type === "strong"
  } else if (first?.type === "text") {
    const [, word, after] = /^\s*(\S+)([\s\S]*)$/.exec(first.value) ?? []
    name = word ?? ""
    if (after) phrasing.unshift({ type: "text", value: after })
  }
  const children = rest.filter((child): child is List => child.type === "list")
  const dir = children.length > 0 || name.endsWith("/")
  if (dir && !name.endsWith("/")) name += "/"
  const note = inline(phrasing).trim()
  return [
    `<li${dir ? " data-dir" : ""}>`,
    `<span data-name${mark ? " data-mark" : ""}>${escapeHtml(name)}</span>`,
    note ? `<span data-note>${note}</span>` : "",
    ...children.map(tree),
    "</li>",
  ].join("")
}

const tree = (list: List): string =>
  `<ul>${list.children.map(entry).join("")}</ul>`

/**
 * `:::file-tree` around a nested list: a directory listing in Geist Mono
 * with hairline guides and muted comments, in place of an ASCII tree in
 * a code block. In the feed it stays the list it was written as.
 */
export const fileTreeDirective = defineMdastPlugin({
  name: "file-tree-directive",
  containerDirective(node, ctx) {
    if (node.name !== "file-tree") return
    const list = node.children.find((child) => child.type === "list")
    if (!list) {
      ctx.report({
        message: ":::file-tree holds a list",
        node,
        severity: "warning",
      })
      return
    }
    return {
      type: "html",
      value: `<file-tree>${tree(list)}</file-tree>`,
    }
  },
})
