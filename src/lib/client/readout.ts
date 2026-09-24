/**
 * The readout: how every stat panel (`dl.readout`, styled in feed.css)
 * writes a value. A figure like `145.1M`, `12h 30m` or `¥3,450` is split
 * into runs — the numbers set large, the units between them small — and
 * the numbers count up to their value the first time the panel is on
 * screen, then count from the old value to the new one whenever a render
 * changes it (a range toggle on Tokens, a refreshed payload).
 *
 * `splitFigure`/`formatRun` are the pure half and are unit-tested; the rest
 * touches the DOM and only runs in the browser.
 */

export type Run =
  | { kind: "unit"; text: string }
  | {
      kind: "num"
      text: string
      value: number
      decimals: number
      grouped: boolean
    }

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
    const raw = match[0]
    const decimals = raw.includes(".") ? raw.split(".")[1].length : 0
    runs.push({
      kind: "num",
      text: raw,
      value: Number(raw.replaceAll(",", "")),
      decimals,
      grouped: raw.includes(","),
    })
    last = index + raw.length
  }
  if (last < text.length) runs.push({ kind: "unit", text: text.slice(last) })
  return runs
}

const formatters = new Map<string, Intl.NumberFormat>()

/** A number spelled the way its run was: same decimals, same grouping. */
export function formatRun(
  run: Extract<Run, { kind: "num" }>,
  value: number,
): string {
  const key = `${run.decimals}:${run.grouped}`
  let formatter = formatters.get(key)
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-US", {
      minimumFractionDigits: run.decimals,
      maximumFractionDigits: run.decimals,
      useGrouping: run.grouped,
    })
    formatters.set(key, formatter)
  }
  return formatter.format(value)
}

/** A figure's units in order — its shape, with the numbers taken out. */
const shape = (runs: Run[]) =>
  runs.map((run) => (run.kind === "num" ? "#" : run.text)).join("")

/**
 * Where an animation starts: the previous figure's numbers when it had the
 * same shape (a count that moved within its unit), zero otherwise — a
 * first fill, a card that changed kind (`—` to `12 days`), or a unit that
 * changed under the number (`145.1M` to `1.2B`, where counting down from
 * 145.1 would draw `140B` on the way).
 */
export function startValues(previous: string | undefined, next: Run[]) {
  const before = previous ? splitFigure(previous) : []
  const same = before.length > 0 && shape(before) === shape(next)
  const old = before.flatMap((run) => (run.kind === "num" ? [run.value] : []))
  return next
    .filter((run) => run.kind === "num")
    .map((_, i) => (same ? old[i] : 0))
}

/* DOM ------------------------------------------------------------------- */

const DURATION = 900
const ease = (t: number) => 1 - (1 - t) ** 4

const reduced = () =>
  typeof matchMedia === "function" &&
  matchMedia("(prefers-reduced-motion: reduce)").matches

/** Animations waiting for their panel to scroll into view. */
const pending = new WeakMap<Element, () => void>()
let observer: IntersectionObserver | null = null

const watch = (panel: Element, start: () => void) => {
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        observer?.unobserve(entry.target)
        entry.target.setAttribute("data-seen", "")
        pending.get(entry.target)?.()
        pending.delete(entry.target)
      }
    },
    { threshold: 0.35 },
  )
  const queued = pending.get(panel)
  pending.set(panel, () => {
    queued?.()
    start()
  })
  observer.observe(panel)
}

const paint = (target: HTMLElement, runs: Run[], values?: number[]) => {
  let n = 0
  target.replaceChildren(
    ...runs.map((run) => {
      const span = document.createElement("span")
      if (run.kind === "num") {
        span.className = "num"
        span.textContent = values ? formatRun(run, values[n++]) : run.text
      } else {
        span.className = "unit"
        span.textContent = run.text
      }
      return span
    }),
  )
}

/**
 * Write `text` into a readout value. Writing the figure already shown is a
 * no-op, which is what lets a stale-while-revalidate feed paint its cached
 * payload and then the identical network one without the numbers jumping.
 */
export function setReadout(target: HTMLElement, text: string) {
  const previous = target.dataset.figure
  if (previous === text) return
  target.dataset.figure = text

  const runs = splitFigure(text)
  const hasNumber = runs.some((run) => run.kind === "num")
  target.toggleAttribute("data-word", !hasNumber)

  const panel = target.closest(".readout") ?? target
  if (!hasNumber || reduced()) {
    paint(target, runs)
    if (!panel.hasAttribute("data-seen")) watch(panel, () => {})
    return
  }

  const from = startValues(previous, runs)
  const to = runs.flatMap((run) => (run.kind === "num" ? [run.value] : []))
  paint(target, runs, from)

  const run = () => {
    // A newer write owns the element now; let it animate instead.
    if (target.dataset.figure !== text) return
    const begin = performance.now()
    const frame = (now: number) => {
      if (target.dataset.figure !== text) return
      const t = Math.min((now - begin) / DURATION, 1)
      if (t === 1) return paint(target, runs)
      const k = ease(t)
      paint(
        target,
        runs,
        from.map((a, i) => a + (to[i] - a) * k),
      )
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  }

  if (panel.hasAttribute("data-seen")) run()
  else watch(panel, run)
}
