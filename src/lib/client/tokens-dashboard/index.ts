/**
 * Runtime controller for the Tokens dashboard — Tokens.astro owns the
 * markup, styles and skeletons, this module owns everything that runs
 * in the browser. One mount per <tokens-dashboard> root: load the
 * /api/site payload, render the one-shot sections (heatmap, facts,
 * devices), and re-render the dynamic ones (overview, trend, rhythm,
 * breakdown) whenever the range / metric / stacking controls change.
 */

import {
  loadSite,
  type MetricKey,
  type RangeKey,
  type Site,
  type StackDim,
} from "../tokens"
import { renderFacts, renderHeatmap } from "./activity"
import { createBreakdown } from "./breakdown"
import { renderDevices } from "./devices"
import { createIcons, scopedQuery } from "./dom"
import { renderOverview } from "./overview"
import { createRhythmChart, createTrendChart } from "./trend"

export function mountTokensDashboard(root: HTMLElement) {
  const endpoint = root.dataset.endpoint
  const body = root.querySelector<HTMLElement>(".tk-body")
  const form = root.querySelector<HTMLFormElement>(".tk-controls")
  const fallback = root.querySelector<HTMLElement>(".tk-fallback")
  if (!endpoint || !body || !form) return

  const q = scopedQuery(root)
  const icons = createIcons(root)
  const trend = createTrendChart(q)
  const rhythm = createRhythmChart(q)
  const breakdown = createBreakdown(q, icons)

  let site: Site | null = null

  const readState = () => {
    const values = new FormData(form)
    const stackInput = root.querySelector<HTMLInputElement>(
      'input[name="stack"]:checked',
    )
    return {
      range: (values.get("range") ?? "month") as RangeKey,
      metric: (values.get("metric") ?? "tokens") as MetricKey,
      stackDim: (stackInput?.value ?? "provider") as StackDim,
    }
  }

  const renderDynamic = () => {
    if (!site) return
    const { range, metric, stackDim } = readState()
    renderOverview(q, site, range)
    trend.render(site, range, metric, stackDim)
    rhythm.render(site, range, metric)
    breakdown.render(site, range, metric)
  }

  form.addEventListener("submit", (event) => event.preventDefault())
  form.addEventListener("change", renderDynamic)
  // The stack toggle lives in the chart footer, outside the form.
  q(".tk-chart-foot .tk-seg")?.addEventListener("change", renderDynamic)

  loadSite(endpoint)
    .then((loaded) => {
      site = loaded
      renderHeatmap(q, loaded)
      renderFacts(q, loaded)
      renderDevices(q, loaded)
      renderDynamic()
      root.setAttribute("aria-busy", "false")
    })
    .catch(() => {
      body.hidden = true
      if (fallback) fallback.hidden = false
      root.setAttribute("aria-busy", "false")
    })
}
