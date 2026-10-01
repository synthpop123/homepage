import { h } from "hastscript"
import { defineHastPlugin } from "satteri"

/**
 * Wraps every table in a `<table-scroll>` that does the horizontal
 * scrolling, so the table itself keeps `display: table` — a table set to
 * `display: block` loses its table semantics in WebKit's accessibility
 * tree, and VoiceOver reads it as loose cells.
 */
export const tableScroll = defineHastPlugin({
  name: "table-scroll",
  element: {
    filter: ["table"],
    visit(node, ctx) {
      ctx.wrapNode(node, h("table-scroll"))
    },
  },
})
