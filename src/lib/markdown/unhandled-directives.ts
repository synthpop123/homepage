import type { Data } from "mdast"
import type {} from "mdast-util-to-hast"
import { defineMdastPlugin } from "satteri"

const handled = (node: { data?: Data }) => !!node.data?.hName

const empty = (record: Record<string, unknown> | null | undefined) =>
  !record || Object.keys(record).length === 0

/**
 * Runs after every plugin that claims a directive. A directive nothing
 * claimed would otherwise vanish from the page without a word, so a
 * block one (`:::x`, `::x`) is reported, and a bare text one — prose
 * like `注意:abc` or `a:b`, which the directive syntax reads as `:abc` —
 * goes back to the text it was written as.
 */
export const unhandledDirectives = defineMdastPlugin({
  name: "unhandled-directives",
  containerDirective(node, ctx) {
    if (handled(node)) return
    ctx.report({
      message: `unhandled directive :::${node.name} dropped`,
      node,
      severity: "warning",
    })
  },
  leafDirective(node, ctx) {
    if (handled(node)) return
    ctx.report({
      message: `unhandled directive ::${node.name} dropped`,
      node,
      severity: "warning",
    })
  },
  textDirective(node, ctx) {
    if (handled(node)) return
    if (node.children.length === 0 && empty(node.attributes))
      return { type: "text", value: `:${node.name}` }
    ctx.report({
      message: `unhandled directive :${node.name} dropped`,
      node,
      severity: "warning",
    })
  },
})
