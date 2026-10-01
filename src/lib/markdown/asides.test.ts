import { describe, expect, it } from "bun:test"
import type { ElementContent } from "hast"
import { toHtml } from "hast-util-to-html"
import { h } from "hastscript"
import { wrapAsides } from "./asides"

const wrap = (...children: (ElementContent | string)[]) =>
  toHtml(
    wrapAsides(
      children.map((child) =>
        typeof child === "string" ? { type: "text", value: child } : child,
      ),
    ),
  )

describe("wrapAsides", () => {
  it("wraps a run with its parentheses", () => {
    expect(wrap("a (b) c")).toBe("a <span data-aside>(b)</span> c")
  })

  it("wraps full-width parentheses", () => {
    expect(wrap("工具（Flux、Argo CD）很好")).toBe(
      "工具<span data-aside>（Flux、Argo CD）</span>很好",
    )
  })

  it("runs across inline elements", () => {
    expect(
      wrap(
        "see (the ",
        h("a", { href: "/x" }, "docs"),
        " ",
        h("strong", "now"),
        ") ok",
      ),
    ).toBe(
      'see <span data-aside>(the <a href="/x">docs</a> <strong>now</strong>)</span> ok',
    )
  })

  it("wraps only the outermost pair", () => {
    expect(wrap("(a (b) c) d (e)")).toBe(
      "<span data-aside>(a (b) c)</span> d <span data-aside>(e)</span>",
    )
  })

  it("leaves unbalanced parentheses alone", () => {
    expect(wrap("a ( b")).toBe("a ( b")
    expect(wrap("1) first")).toBe("1) first")
    expect(wrap("a ( b (c) d")).toBe("a ( b <span data-aside>(c)</span> d")
    expect(wrap("(a）")).toBe("(a）")
  })

  it("skips calls and formulas", () => {
    expect(wrap("O(n) time, f (x)")).toBe(
      "O(n) time, f <span data-aside>(x)</span>",
    )
  })

  it("never counts parentheses in code", () => {
    expect(wrap("call ", h("code", "f("), " then")).toBe(
      "call <code>f(</code> then",
    )
    expect(wrap("(", h("code", "a)b"), ")")).toBe(
      "<span data-aside>(<code>a)b</code>)</span>",
    )
  })

  it("does not pair across an element boundary", () => {
    expect(wrap(h("strong", "(a"), " b)")).toBe("<strong>(a</strong> b)")
  })

  it("reaches into inline elements outside any aside", () => {
    expect(wrap(h("strong", "x (y)"))).toBe(
      "<strong>x <span data-aside>(y)</span></strong>",
    )
  })

  it("recurses into blocks and skips headings", () => {
    expect(
      toHtml(
        wrapAsides([
          h("li", ["a (b)", h("ul", [h("li", "c (d)")])]),
          h("h3", "e (f)"),
        ]),
      ),
    ).toBe(
      "<li>a <span data-aside>(b)</span><ul><li>c <span data-aside>(d)</span></li></ul></li><h3>e (f)</h3>",
    )
  })

  it("returns the same nodes when nothing changes", () => {
    const p = h("p", "no asides here")
    expect(wrapAsides([p])[0]).toBe(p)
  })
})
