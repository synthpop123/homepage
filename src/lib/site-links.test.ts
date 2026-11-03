import { describe, expect, it } from "bun:test"
import {
  linkedPostId,
  postLinks,
  sitePath,
  titleTransition,
} from "./site-links"

describe("sitePath", () => {
  it("reads root-relative and absolute links into the site", () => {
    expect(sitePath("/blog/a#x")).toBe("/blog/a")
    expect(sitePath("https://lkwplus.com/blog/a/")).toBe("/blog/a")
    expect(sitePath("https://lkwplus.com/")).toBe("")
  })

  it("leaves links elsewhere alone", () => {
    expect(sitePath("https://alist.lkwplus.com/blog/a")).toBeNull()
    expect(sitePath("https://lkwplus.com.evil.example/blog/a")).toBeNull()
    expect(sitePath("//example.com/blog/a")).toBeNull()
    expect(sitePath("./assets/a.png")).toBeNull()
    expect(sitePath("#section")).toBeNull()
  })
})

describe("linkedPostId", () => {
  it("names the post a link opens, subposts included", () => {
    expect(linkedPostId("/blog/komodo-gitops")).toBe("komodo-gitops")
    expect(linkedPostId("/blog/parent/sub#h")).toBe("parent/sub")
  })

  it("skips the index and a post's Markdown export", () => {
    expect(linkedPostId("/blog")).toBeNull()
    expect(linkedPostId("/blog/a.md")).toBeNull()
    expect(linkedPostId("/tags/a")).toBeNull()
  })
})

describe("postLinks", () => {
  it("collects each linked post once, images and elsewhere left out", () => {
    const markdown = [
      "[a](https://lkwplus.com/blog/a) and [b](/blog/b#x)",
      "![shot](./assets/b.png) [ext](https://example.com/blog/c)",
      "[again](/blog/a)",
    ].join("\n")
    expect(postLinks(markdown)).toEqual(["a", "b"])
  })
})

describe("titleTransition", () => {
  it("makes a CSS ident of any post id", () => {
    expect(titleTransition("komodo-gitops")).toBe("post-komodo-gitops")
    expect(titleTransition("2024-review")).toBe("post-2024-review")
    expect(titleTransition("parent/sub.v2")).toBe("post-parent_sub_v2")
    expect(titleTransition("摊还")).toBe("post-__")
  })
})
