import { describe, expect, it } from "bun:test"
import { markdownToHtml } from "satteri"
import { feedLists } from "./feed-html"
import { fileTreeDirective } from "./file-tree"
import { stepsDirective } from "./steps"
import { unhandledDirectives } from "./unhandled-directives"

const render = async (markdown: string, feed = false) =>
  markdownToHtml(markdown, {
    features: { directive: true },
    mdastPlugins: feed
      ? [feedLists, unhandledDirectives]
      : [stepsDirective, fileTreeDirective, unhandledDirectives],
  }).html

describe("stepsDirective", () => {
  it("wraps the ordered list in its rail", async () => {
    const html = await render(":::steps\n1. one\n2. two\n:::")
    expect(html).toContain("<step-list><ol>")
    expect(html).toContain("<li>two</li>")
  })
})

describe("fileTreeDirective", () => {
  const markdown = [
    ":::file-tree",
    "- komodo/",
    "  - sync.toml 集中声明，见 `sync`",
    "- **renovate.json** 升级规则",
    "- docs",
    "  - ports.md",
    ":::",
  ].join("\n")

  it("splits each entry into a name and its comment", async () => {
    const html = await render(markdown)
    expect(html).toContain(
      "<file-tree><ul><li data-dir><span data-name>komodo/</span><ul><li><span data-name>sync.toml</span><span data-note>集中声明，见 <code>sync</code></span></li></ul></li>",
    )
    expect(html).toContain(
      "<li><span data-name data-mark>renovate.json</span><span data-note>升级规则</span></li>",
    )
  })

  it("marks a directory by its children and gives it the slash", async () => {
    expect(await render(markdown)).toContain(
      "<li data-dir><span data-name>docs/</span><ul>",
    )
  })

  it("escapes what the names and comments hold", async () => {
    expect(await render(":::file-tree\n- `a<b>` c&d\n:::")).toContain(
      "<span data-name>a&lt;b&gt;</span><span data-note>c&amp;d</span>",
    )
  })
})

describe("feedLists", () => {
  it("leaves both as plain lists", async () => {
    expect((await render(":::steps\n1. one\n:::", true)).trim()).toBe(
      "<div><ol>\n<li>one</li>\n</ol></div>",
    )
    expect(await render(":::file-tree\n- a/\n:::", true)).toContain("<div><ul>")
  })
})
