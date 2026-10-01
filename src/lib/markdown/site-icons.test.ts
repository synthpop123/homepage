import { describe, expect, it } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import type { ElementContent } from "hast"
import { toHtml } from "hast-util-to-html"
import { h } from "hastscript"
import {
  glueIcon,
  iconElement,
  iconSlugs,
  siteIcon,
  wrapsImage,
} from "./site-icons"

describe("siteIcon", () => {
  it("maps a host and its subdomains to a mark", () => {
    expect(siteIcon("https://github.com/a/b")).toBe("github")
    expect(siteIcon("https://docs.docker.com/x")).toBe("docker")
    expect(siteIcon("https://hub.docker.com/r/x")).toBe("docker")
    expect(siteIcon("https://manpages.ubuntu.com/x")).toBe("ubuntu")
    expect(siteIcon("https://twitter.com/x")).toBe("x")
    expect(siteIcon("http://en.wikipedia.org/wiki/X")).toBe("wikipedia")
  })

  it("does not match a host that only ends in the same letters", () => {
    expect(siteIcon("https://notgithub.com/")).toBe("external")
    expect(siteIcon("https://google.github.io/x")).toBe("external")
  })

  it("gives other hosts the arrow and skips everything else", () => {
    expect(siteIcon("https://komo.do/docs")).toBe("external")
    expect(siteIcon("https://lkwplus.com/blog")).toBeNull()
    expect(siteIcon("/blog/x")).toBeNull()
    expect(siteIcon("mailto:a@b.c")).toBeNull()
  })
})

describe("icon files and rules", () => {
  const css = readFileSync("src/styles/site-icons.css", "utf8")
  it.each(iconSlugs())("%s has a file and a rule", (slug) => {
    expect(existsSync(`src/assets/icons/sites/${slug}.svg`)).toBe(true)
    expect(css).toContain(
      `[data-site-icon="${slug}"] { --site-icon: url("../assets/icons/sites/${slug}.svg"); }`,
    )
  })
})

const glue = (...children: (ElementContent | string)[]) =>
  toHtml(
    glueIcon(
      children.map((child) =>
        typeof child === "string" ? { type: "text", value: child } : child,
      ),
      iconElement("github"),
    ),
  )

const ICON = '<span data-site-icon="github" aria-hidden="true"></span>'

describe("glueIcon", () => {
  it("glues the mark to the last word", () => {
    expect(glue("the repo")).toBe(`the <span data-glue>repo${ICON}</span>`)
  })

  it("glues only the last character of CJK text or a long word", () => {
    expect(glue("这个仓库")).toBe(`这个仓<span data-glue>库${ICON}</span>`)
    expect(glue("https://example.com/a/very/long/path")).toBe(
      `https://example.com/a/very/long/pat<span data-glue>h${ICON}</span>`,
    )
  })

  it("glues a short trailing element whole", () => {
    expect(glue("see ", h("code", "bun"))).toBe(
      `see <span data-glue><code>bun</code>${ICON}</span>`,
    )
  })

  it("appends after a long trailing element", () => {
    expect(glue(h("code", "a-very-long-inline-code-name"))).toBe(
      `<code>a-very-long-inline-code-name</code>${ICON}`,
    )
  })
})

describe("wrapsImage", () => {
  it("finds an image at any depth", () => {
    expect(wrapsImage(h("a", [h("picture", [h("img")])]))).toBe(true)
    expect(wrapsImage(h("a", [h("span", [h("img")])]))).toBe(true)
    expect(wrapsImage(h("a", "text"))).toBe(false)
  })
})
