import type { Element, ElementContent, Text } from "hast"
import { defineHastPlugin } from "satteri"

/**
 * Dims parenthetical asides in post prose: each outermost balanced run of
 * `( … )` or full-width `（ … ）`, parentheses included, is wrapped in
 * `span[data-aside]`. A run may take in whole inline elements (a link, a
 * `strong`, inline code) as long as both of its parentheses sit in the same
 * block at the same depth; one that opens inside a `strong` and closes
 * outside it is not a run. Parentheses inside code, maths, `kbd`, SVG and
 * headings are never counted, and a half-width `(` straight after a Latin
 * letter or digit opens a call or a formula (`f(x)`, `O(n)`), not an aside.
 */

const CLOSE: Record<string, string> = { "(": ")", "（": "）" }
const OPEN = new Set(Object.keys(CLOSE))
const SHUT = new Set(Object.values(CLOSE))

/** Never looked into, and never broken apart. */
const OPAQUE = new Set([
  "code",
  "pre",
  "kbd",
  "samp",
  "math",
  "svg",
  "script",
  "style",
  "textarea",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
])

/** Inline elements an aside can run across. */
const PHRASING = new Set([
  "a",
  "abbr",
  "b",
  "bdi",
  "bdo",
  "br",
  "cite",
  "code",
  "data",
  "del",
  "dfn",
  "em",
  "i",
  "img",
  "ins",
  "kbd",
  "mark",
  "math",
  "q",
  "s",
  "samp",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "svg",
  "time",
  "u",
  "var",
  "wbr",
])

const isPhrasing = (node: ElementContent) =>
  node.type === "text" ||
  node.type === "comment" ||
  (node.type === "element" && PHRASING.has(node.tagName))

/** A point in a run: the text node's index in the run and an offset in it. */
type Point = { node: number; at: number }
type Pair = { from: Point; to: Point }

const before = (a: Point, b: Point) =>
  a.node < b.node || (a.node === b.node && a.at < b.at)

const WORD = /[A-Za-z0-9_]/

/** The balanced pairs in a run of inline nodes, outermost only. */
function outermostPairs(run: readonly ElementContent[]): Pair[] {
  const stack: { char: string; from: Point }[] = []
  const pairs: Pair[] = []
  let previous = ""
  run.forEach((node, index) => {
    if (node.type !== "text") {
      // An element's own text decides whether `(` right after it is a call.
      if (node.type === "element") previous = "\u0000"
      return
    }
    for (let at = 0; at < node.value.length; at++) {
      const char = node.value[at]
      if (OPEN.has(char) && !(char === "(" && WORD.test(previous))) {
        stack.push({ char, from: { node: index, at } })
      } else if (SHUT.has(char)) {
        // A close of the other kind, or with nothing open, is left alone.
        const top = stack.at(-1)
        if (top && CLOSE[top.char] === char) {
          stack.pop()
          pairs.push({ from: top.from, to: { node: index, at: at + 1 } })
        }
      }
      previous = char
    }
  })
  pairs.sort((a, b) => (before(a.from, b.from) ? -1 : 1))
  const outer: Pair[] = []
  for (const pair of pairs) {
    const last = outer.at(-1)
    if (!last || !before(pair.from, last.to)) outer.push(pair)
  }
  return outer
}

const aside = (children: ElementContent[]): Element => ({
  type: "element",
  tagName: "span",
  properties: { dataAside: true },
  children,
})

function wrapRun(run: readonly ElementContent[]): ElementContent[] {
  const pairs = outermostPairs(run)
  if (!pairs.length)
    return run.map((node) => (node.type === "element" ? descend(node) : node))
  const out: ElementContent[] = []
  let open: ElementContent[] | null = null
  const emit = (node: ElementContent) => (open ?? out).push(node)

  run.forEach((node, index) => {
    if (node.type !== "text") {
      emit(open || node.type !== "element" ? node : descend(node))
      return
    }
    const cuts = pairs
      .flatMap((pair) => [
        { point: pair.from, opens: true },
        { point: pair.to, opens: false },
      ])
      .filter((cut) => cut.point.node === index)
      .sort((a, b) => a.point.at - b.point.at)
    let start = 0
    for (const cut of cuts) {
      if (cut.point.at > start)
        emit(text(node.value.slice(start, cut.point.at)))
      start = cut.point.at
      if (cut.opens) open = []
      else if (open) {
        out.push(aside(open))
        open = null
      }
    }
    if (start < node.value.length) emit(text(node.value.slice(start)))
  })
  return out
}

const text = (value: string): Text => ({ type: "text", value })

/** Wraps the asides in a list of children, reaching into block children. */
export function wrapAsides(
  children: readonly ElementContent[],
): ElementContent[] {
  const out: ElementContent[] = []
  let run: ElementContent[] = []
  const flush = () => {
    if (run.length) out.push(...wrapRun(run))
    run = []
  }
  for (const node of children) {
    if (isPhrasing(node)) {
      run.push(node)
      continue
    }
    // Raw HTML may open a tag it closes in a later node, so a run stops at it.
    flush()
    out.push(node.type === "element" ? descend(node) : node)
  }
  flush()
  return out
}

function descend(node: Element): Element {
  if (OPAQUE.has(node.tagName)) return node
  const children = wrapAsides(node.children)
  return changed(node.children, children) ? { ...node, children } : node
}

function changed(
  before: readonly ElementContent[],
  after: readonly ElementContent[],
): boolean {
  return (
    before.length !== after.length ||
    before.some((node, index) => node !== after[index])
  )
}

/** The blocks a post's root holds that can carry prose. */
const BLOCKS = [
  "p",
  "ul",
  "ol",
  "dl",
  "blockquote",
  "table",
  "figure",
  "div",
  "aside",
  "section",
  "details",
]

export const asides = defineHastPlugin({
  name: "asides",
  element: {
    filter: BLOCKS,
    visit(node, ctx) {
      // Only top-level blocks are rewritten, each as a whole, so no two
      // rewrites touch the same subtree.
      if (ctx.parent(node)?.type !== "root") return
      const next = descend(node as Element)
      if (next !== node) ctx.replaceNode(node, next)
    },
  },
})
