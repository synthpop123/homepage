import { describe, expect, it } from "bun:test"
import { markdownToHtml } from "satteri"
import { feedLists } from "./feed-html"
import { fileKind, fileTreeDirective } from "./file-tree"
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

  it("keeps the list's start for the counter", async () => {
    expect(await render(":::steps\n3. three\n4. four\n:::")).toContain(
      '<ol start="3">',
    )
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

  it("splits each entry into an icon, a name and its comment", async () => {
    const html = await render(markdown)
    expect(html).toContain(
      '<li data-dir><span data-row data-kind="folder-open"><span data-name>komodo/</span></span><ul><li><span data-row data-kind="file-config"><span data-name>sync.toml</span><span data-note>集中声明，见 <code>sync</code></span></span></li></ul></li>',
    )
    expect(html).toContain(
      "<span data-name data-mark>renovate.json</span><span data-note>升级规则</span>",
    )
  })

  it("marks a directory by its children and gives it the slash", async () => {
    expect(await render(markdown)).toContain(
      '<span data-row data-kind="folder-open"><span data-name>docs/</span>',
    )
  })

  it("hangs a list of many off ./, with tree's count", async () => {
    expect(await render(markdown)).toContain(
      '<file-tree><div data-head><span data-row data-kind="folder-open"><span data-name>./</span></span><span data-count lang="en">2 directories, 3 files</span></div><ul>',
    )
  })

  it("lets a lone directory with children head the frame", async () => {
    const html = await render(
      ":::file-tree\n- repo/ the project\n  - a.sh\n:::",
    )
    expect(html).toContain(
      '<file-tree><div data-head><span data-row data-kind="folder-open"><span data-name>repo/</span><span data-note>the project</span></span><span data-count lang="en">0 directories, 1 file</span></div><ul><li><span data-row data-kind="file-terminal">',
    )
  })

  it("escapes what the names and comments hold", async () => {
    expect(await render(":::file-tree\n- `a<b>` c&d\n:::")).toContain(
      "<span data-name>a&lt;b&gt;</span><span data-note>c&amp;d</span>",
    )
  })
})

describe("fileKind", () => {
  it("reads a directory's state and a file's kind", () => {
    expect(fileKind("stacks/", true)).toBe("folder-open")
    expect(fileKind("empty/")).toBe("folder")
    expect(fileKind("README")).toBe("file-text")
    expect(fileKind("compose.yaml")).toBe("file-config")
    expect(fileKind(".env")).toBe("file-config")
    expect(fileKind("Dockerfile")).toBe("file-config")
    expect(fileKind("Makefile")).toBe("file-terminal")
    expect(fileKind("index.astro")).toBe("file-code")
    expect(fileKind("cat.JPG")).toBe("file-image")
    expect(fileKind("data.bin")).toBe("file")
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
