/**
 * Shared client-side plumbing for the GitHub-style activity heatmaps
 * (Music, Tokens, GitHub): cell geometry, weekday math, and the
 * fit-to-width renderer. The matching markup and styles live in Heatmap.astro.
 * Imported from component <script> blocks, so everything here must be
 * browser-safe.
 */

// px, keep in sync with --heat-cell / --heat-gap in Heatmap.astro.
export const HEAT_CELL = 12
export const HEAT_GAP = 3
export const HEAT_MAX_WEEKS = 52

/**
 * Monday = 0 … Sunday = 6, derived from the date part alone (anchored
 * at noon UTC) so grids stay aligned to the data source's day
 * boundaries, not the visitor's local time zone.
 */
export const weekdayIndex = (day: string) =>
  (new Date(`${day.slice(0, 10)}T12:00:00Z`).getUTCDay() + 6) % 7

export type HeatCell = { level: number; title: string }

/**
 * Fill a Heatmap.astro grid with as many trailing weeks of `days` as
 * fit its width, pad the first column down to the right weekday, and
 * re-fit on viewport changes (rotation, resize, mobile URL bar) so the
 * fixed-size cells never overflow. `days` must be chronological and
 * dense; `cells` maps the visible slice to one { level, title } per day.
 */
export function mountHeatmap<T extends { date: string }>(
  grid: HTMLElement,
  days: T[],
  cells: (shown: T[]) => HeatCell[],
) {
  if (days.length === 0) throw new Error("No activity data")
  const lastWeekday = weekdayIndex(days[days.length - 1].date)
  let weeks = 0

  const render = () => {
    const fittable = Math.floor(
      (grid.clientWidth + HEAT_GAP) / (HEAT_CELL + HEAT_GAP),
    )
    const next = Math.max(1, Math.min(HEAT_MAX_WEEKS, fittable))
    if (next === weeks) return
    weeks = next

    const shown = days.slice(-((weeks - 1) * 7 + lastWeekday + 1))
    const fragment = document.createDocumentFragment()
    for (let pad = weekdayIndex(shown[0].date); pad > 0; pad--) {
      const cell = document.createElement("span")
      cell.dataset.pad = ""
      fragment.append(cell)
    }
    for (const { level, title } of cells(shown)) {
      const cell = document.createElement("span")
      cell.dataset.level = String(level)
      cell.title = title
      fragment.append(cell)
    }
    grid.replaceChildren(fragment)
  }

  render()
  grid.removeAttribute("data-skeleton")
  new ResizeObserver(render).observe(grid)
}
