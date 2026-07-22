/**
 * Shared client-side plumbing for the GitHub-style activity heatmaps
 * (Music, Tokens): cell geometry, weekday math, and the
 * fit-to-width renderer. The matching markup and styles live in Heatmap.astro.
 * Imported from component <script> blocks, so everything here must be
 * browser-safe.
 */

export const HEAT_MAX_WEEKS = 52

/**
 * Cell geometry lives in one place — the --heat-cell / --heat-gap
 * custom properties on <activity-heatmap> in Heatmap.astro — and the
 * renderer reads the computed values instead of mirroring them here.
 */
const gridMetrics = (grid: HTMLElement) => {
  const styles = getComputedStyle(grid)
  return {
    cell: Number.parseFloat(styles.getPropertyValue("--heat-cell")),
    gap: Number.parseFloat(styles.getPropertyValue("--heat-gap")),
  }
}

/**
 * Monday = 0 … Sunday = 6, derived from the date part alone (anchored
 * at noon UTC) so grids stay aligned to the data source's day
 * boundaries, not the visitor's local time zone.
 */
export const weekdayIndex = (day: string) =>
  (new Date(`${day.slice(0, 10)}T12:00:00Z`).getUTCDay() + 6) % 7

export type HeatCell = { level: number; title: string }

/** One observer per grid, replaced on remount — a data refresh must not
 *  leave the previous mount's observer re-rendering its stale days. */
const observers = new WeakMap<HTMLElement, ResizeObserver>()

/**
 * Fill a Heatmap.astro grid with as many trailing weeks of `days` as
 * fit its width, pad the first column down to the right weekday, and
 * re-fit on viewport changes (rotation, resize, mobile URL bar) so the
 * fixed-size cells never overflow. `days` must be chronological and
 * dense; `cells` maps the visible slice to one { level, title } per day.
 * Remounting on the same grid replaces the previous data.
 */
export function mountHeatmap<T extends { date: string }>(
  grid: HTMLElement,
  days: T[],
  cells: (shown: T[]) => HeatCell[],
) {
  if (days.length === 0) throw new Error("No activity data")
  observers.get(grid)?.disconnect()
  const { cell, gap } = gridMetrics(grid)
  const lastWeekday = weekdayIndex(days[days.length - 1].date)
  let weeks = 0

  const render = () => {
    const fittable = Math.floor((grid.clientWidth + gap) / (cell + gap))
    const next = Math.max(1, Math.min(HEAT_MAX_WEEKS, fittable))
    if (next === weeks) return
    weeks = next

    const shown = days.slice(-((weeks - 1) * 7 + lastWeekday + 1))
    const fragment = document.createDocumentFragment()
    for (let pad = weekdayIndex(shown[0].date); pad > 0; pad--) {
      const node = document.createElement("span")
      node.dataset.pad = ""
      fragment.append(node)
    }
    for (const { level, title } of cells(shown)) {
      const node = document.createElement("span")
      node.dataset.level = String(level)
      node.title = title
      fragment.append(node)
    }
    grid.replaceChildren(fragment)
  }

  render()
  grid.removeAttribute("data-skeleton")
  const observer = new ResizeObserver(render)
  observer.observe(grid)
  observers.set(grid, observer)
}
