import { describe, expect, it } from "bun:test"
import { feedHtml } from "./feed-html"

const site = "https://lkwplus.com"

describe("feedHtml", () => {
  it("makes root-relative src, href and srcset absolute", () => {
    expect(
      feedHtml(
        '<a href="/blog/x">x</a><img src="/_astro/a.webp" srcset="/_astro/a-640.webp 640w, /_astro/a.webp 1600w">',
        site,
      ),
    ).toBe(
      '<a href="https://lkwplus.com/blog/x">x</a><img src="https://lkwplus.com/_astro/a.webp" srcset="https://lkwplus.com/_astro/a-640.webp 640w, https://lkwplus.com/_astro/a.webp 1600w">',
    )
  })

  it("leaves absolute, protocol-relative and fragment URLs alone", () => {
    const html =
      '<a href="https://example.com/">e</a><img src="//cdn.example.com/i.png"><a href="#top">t</a>'
    expect(feedHtml(html, site)).toBe(html)
  })

  it("drops inline scripts and styles", () => {
    expect(
      feedHtml(
        '<p>a</p><style>.x{}</style><script type="module">go()</script><p>b</p>',
        site,
      ),
    ).toBe("<p>a</p><p>b</p>")
  })
})
