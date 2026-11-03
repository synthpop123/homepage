import type {} from "mdast-util-to-hast"
import { defineMdastPlugin } from "satteri"

/**
 * `:::steps` around an ordered list: a walkthrough, each item a step
 * numbered in the margin and joined to the next by a hairline
 * (`typography-lists.css`). The items stay Markdown, so a step's code
 * block is still Expressive Code's. In the feed it is the list alone.
 */
export const stepsDirective = defineMdastPlugin({
  name: "steps-directive",
  containerDirective(node, ctx) {
    if (node.name !== "steps") return
    const lists = node.children.filter((child) => child.type === "list")
    if (lists.length !== 1 || !lists[0].ordered) {
      ctx.report({
        message: ":::steps holds one ordered list",
        node,
        severity: "warning",
      })
    }
    ctx.setProperty(node, "data", { hName: "step-list" })
  },
})
