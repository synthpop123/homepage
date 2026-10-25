/**
 * The readout: how every stat panel (`dl.readout`, styled in feed.css)
 * writes a value. A figure like `145.1M`, `12h 30m` or `¥3,450` is split
 * into runs — the numbers set large, the units between them small — and
 * written as it is: no counting up, so a figure reads the moment it lands.
 *
 * `splitFigure` is the pure half and is unit-tested; the rest touches the
 * DOM and only runs in the browser.
 */

export type Run = { kind: "unit" | "num"; text: string }

const NUMBER_RE = /\d[\d,]*(?:\.\d+)?/g

/**
 * Split a figure into number and unit runs. A figure with no digits at
 * all (`Thursday`, `—`) is one unit run, which `setReadout` prints at full
 * size since there is no number for it to sit beside.
 */
export function splitFigure(text: string): Run[] {
  const runs: Run[] = []
  let last = 0
  for (const match of text.matchAll(NUMBER_RE)) {
    const index = match.index ?? 0
    if (index > last) runs.push({ kind: "unit", text: text.slice(last, index) })
    runs.push({ kind: "num", text: match[0] })
    last = index + match[0].length
  }
  if (last < text.length) runs.push({ kind: "unit", text: text.slice(last) })
  return runs
}

/**
 * Write `text` into a readout value. Writing the figure already shown is a
 * no-op, which is what lets a stale-while-revalidate feed paint its cached
 * payload and then the identical network one without rebuilding it.
 */
export function setReadout(target: HTMLElement, text: string) {
  if (target.dataset.figure === text) return
  target.dataset.figure = text

  const runs = splitFigure(text)
  target.toggleAttribute("data-word", !runs.some((run) => run.kind === "num"))
  target.replaceChildren(
    ...runs.map((run) => {
      const span = document.createElement("span")
      span.className = run.kind
      span.textContent = run.text
      return span
    }),
  )
}
