/**
 * Runtime controller for the Tokens dashboard — Tokens.astro owns the
 * markup, styles and skeletons, this module owns everything that runs
 * in the browser. One mount per <tokens-dashboard> root: load the
 * /tokens/site payload stale-while-revalidate (a locally cached copy from
 * any earlier visit paints instantly, the revalidated answer follows
 * and re-renders only if `generatedAt` moved — every renderer is
 * replaceChildren-idempotent, so a refresh is just rendering again),
 * then repaint whichever dynamic sections a change to the range /
 * metric / stacking controls can actually affect. The controls
 * themselves persist for the session.
 */

import {
  loadSite,
  DEFAULT_RANGE,
  type MetricKey,
  type RangeKey,
  type Site,
  type StackDim,
} from "../tokens"
import { createActivity } from "./activity"
import { createBreakdown } from "./breakdown"
import { renderDevices } from "./devices"
import { createIcons, scopedQuery } from "./dom"
import { renderFacts } from "./facts"
import { renderOverview } from "./overview"
import { renderQuota } from "./quota"
import { createRhythmChart, createTrendChart } from "./trend"

type Controls = { range: RangeKey; metric: MetricKey; stackDim: StackDim }

const CONTROLS_KEY = "tokens:controls"

/**
 * Radio groups are the source of truth for the controls, so persistence
 * is just re-checking inputs on mount. Stored values are compared, never
 * interpolated into a selector, and anything unrecognised simply matches
 * no input and leaves the markup's default checked.
 */
function restoreControls(root: HTMLElement) {
  let saved: Record<string, unknown> | null
  try {
    saved = JSON.parse(sessionStorage.getItem(CONTROLS_KEY) ?? "{}")
  } catch {
    return
  }
  const names = { range: "range", metric: "metric", stackDim: "stack" }
  for (const [field, name] of Object.entries(names)) {
    for (const input of root.querySelectorAll<HTMLInputElement>(
      `input[name="${name}"]`,
    )) {
      if (input.value === saved?.[field]) input.checked = true
    }
  }
}

const saveControls = (controls: Controls) => {
  try {
    sessionStorage.setItem(CONTROLS_KEY, JSON.stringify(controls))
  } catch {
    // Storage full or unavailable (private mode) — the controls just
    // start from their defaults next time.
  }
}

export function mountTokensDashboard(root: HTMLElement) {
  const endpoint = root.dataset.endpoint
  const body = root.querySelector<HTMLElement>(".tk-body")
  const form = root.querySelector<HTMLFormElement>(".tk-controls")
  const fallback = root.querySelector<HTMLElement>(".tk-fallback")
  const retry = root.querySelector<HTMLButtonElement>(".tk-retry")
  if (!endpoint || !body || !form) return

  const q = scopedQuery(root)
  const icons = createIcons(root)
  const activity = createActivity(q, icons)
  const trend = createTrendChart(q)
  const rhythm = createRhythmChart(q)
  const breakdown = createBreakdown(q, icons)

  let site: Site | null = null
  /** The control state the sections on screen were rendered from; null
   *  until a render completes, which is what makes a fresh payload (or a
   *  recovery after a throw) repaint everything. */
  let shown: Controls | null = null

  const readState = (): Controls => {
    const values = new FormData(form)
    return {
      range: (values.get("range") ?? DEFAULT_RANGE.key) as RangeKey,
      metric: (values.get("metric") ?? "tokens") as MetricKey,
      stackDim: (values.get("stack") ?? "provider") as StackDim,
    }
  }

  /**
   * Each section reads only some of the controls — the overview ignores
   * the metric, only the trend cares how bars are stacked — so a change
   * repaints just what it can actually alter. Re-deriving the rest means
   * re-running fillDaily over the whole series and re-sorting every
   * breakdown for output identical to what is already on screen.
   */
  const renderDynamic = () => {
    if (!site) return
    const next = readState()
    const moved = (...keys: (keyof Controls)[]) =>
      !shown || keys.some((key) => shown?.[key] !== next[key])

    if (moved("range")) renderOverview(q, site, next.range)
    if (moved("range", "metric", "stackDim")) {
      trend.render(site, next.range, next.metric, next.stackDim)
    }
    if (moved("range", "metric")) {
      rhythm.render(site, next.range, next.metric)
      breakdown.render(site, next.range, next.metric)
    }
    // Committed only once every section above has drawn: a half-render
    // must not be recorded as the state on screen.
    shown = next
    saveControls(next)
  }

  restoreControls(root)
  form.addEventListener("submit", (event) => event.preventDefault())
  // Form-associated footer inputs participate in FormData, but change
  // events follow DOM ancestry, so one listener belongs on the root.
  root.addEventListener("change", (event) => {
    if (
      event.target instanceof HTMLInputElement &&
      event.target.form === form
    ) {
      renderDynamic()
    }
  })

  const renderAll = (loaded: Site) => {
    // renderDynamic reads the module state, so commit before rendering —
    // but roll back if any renderer throws. A half-render must not count
    // as delivered: the revalidated payload often carries the same
    // generatedAt, and the equal-generatedAt skip below would otherwise
    // block the recovery render.
    const previous = site
    site = loaded
    // New numbers behind unchanged controls: every section is stale.
    shown = null
    try {
      renderQuota(q, loaded, icons)
      activity.render(loaded)
      renderFacts(q, loaded)
      renderDevices(q, loaded, icons)
      renderDynamic()
    } catch (error) {
      site = previous
      throw error
    }
    root.setAttribute("aria-busy", "false")
  }

  // The body and the fallback are the two states of one slot — loading
  // (skeletons) or failed — so a retry simply puts the skeletons back
  // and runs the load again. Only ever reached with nothing on screen:
  // a failed *refresh* keeps the stale render and never gets here.
  const showFallback = () => {
    body.hidden = true
    if (fallback) fallback.hidden = false
    root.setAttribute("aria-busy", "false")
  }

  // Data may arrive twice (cached paint, then the revalidated answer);
  // an unchanged generatedAt means the second is a no-op. Rejects only
  // when there is nothing to paint at all — a failed refresh keeps the
  // stale render instead of swapping it for the fallback.
  const load = () => {
    if (fallback) fallback.hidden = true
    body.hidden = false
    root.setAttribute("aria-busy", "true")
    loadSite(endpoint, (loaded) => {
      if (site?.generatedAt !== loaded.generatedAt) renderAll(loaded)
    }).catch(showFallback)
  }

  // Quota is the one section that ages on screen without a new payload:
  // its countdowns tick, and a window can roll over while the page is
  // open. Re-rendering it on the minute keeps both true; a hidden tab
  // skips the work and catches up the moment it is shown again.
  const tick = () => {
    if (site && !document.hidden) renderQuota(q, site, icons)
  }
  setInterval(tick, 60_000)
  document.addEventListener("visibilitychange", tick)

  retry?.addEventListener("click", load)
  load()
}
