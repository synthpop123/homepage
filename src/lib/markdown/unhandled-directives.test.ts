import { describe, expect, it } from "bun:test"
import { markdownToHtml } from "satteri"
import { calloutDirective } from "./callout"
import { tableScroll } from "./table-scroll"
import { unhandledDirectives } from "./unhandled-directives"

const render = async (markdown: string) =>
  markdownToHtml(markdown, {
    features: { directive: true },
    mdastPlugins: [calloutDirective, unhandledDirectives],
    hastPlugins: [tableScroll],
  }).html

describe("unhandledDirectives", () => {
  it("gives prose the directive syntax misread back its colon", async () => {
    expect((await render("注意:abc 好，a:b 与 ratio 16:9")).trim()).toBe(
      "<p>注意:abc 好，a:b 与 ratio 16:9</p>",
    )
  })

  it("leaves claimed directives to their plugin", async () => {
    expect(await render(":::note\nbody\n:::")).toContain(
      '<details data-callout="note" open>',
    )
  })
})

describe("tableScroll", () => {
  it("wraps a table in its scroller", async () => {
    const html = await render("| a |\n| - |\n| 1 |")
    expect(html.startsWith("<table-scroll><table>")).toBe(true)
    expect(html.trimEnd().endsWith("</table></table-scroll>")).toBe(true)
  })
})
