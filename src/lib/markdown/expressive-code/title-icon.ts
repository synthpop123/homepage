import type { ExpressiveCodePlugin } from "@expressive-code/core"
import type { Element, ElementContent } from "hast"
import { fileKind } from "../file-tree"

const classes = (node: Element) => {
  const value = node.properties.className
  return Array.isArray(value) ? value.map(String) : []
}

const find = (
  node: Element,
  test: (node: Element) => boolean,
): Element | undefined => {
  if (test(node)) return node
  for (const child of node.children) {
    if (child.type !== "element") continue
    const hit = find(child, test)
    if (hit) return hit
  }
  return undefined
}

const text = (node: ElementContent): string =>
  node.type === "text"
    ? node.value
    : node.type === "element"
      ? node.children.map(text).join("")
      : ""

/**
 * An editor frame's title gets the file tree's icon for its kind
 * (`fileKind()`), drawn by `typography-block.css` as a mask before the
 * name. Terminal frames keep their dots.
 */
export const pluginTitleIcon = (): ExpressiveCodePlugin => ({
  name: "title-icon",
  hooks: {
    postprocessRenderedBlockGroup({ renderedGroupContents }) {
      for (const { renderedBlockAst } of renderedGroupContents) {
        const frame = find(renderedBlockAst, (node) =>
          classes(node).includes("frame"),
        )
        if (!frame || !classes(frame).includes("has-title")) continue
        if (classes(frame).includes("is-terminal")) continue
        const title = find(frame, (node) => classes(node).includes("title"))
        const name = title ? text(title).trim().split("/").pop() : ""
        if (title && name) title.properties.dataKind = fileKind(name)
      }
    },
  },
})
