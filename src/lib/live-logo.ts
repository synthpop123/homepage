/**
 * The logo is a corner of a heatmap: four cells, the top-left always in
 * full ink so the shape reads the same. scripts/prebuild.ts redraws the
 * other three from the last three days of token use (oldest top-right,
 * then bottom-left, today bottom-right) on each build, and falls back to
 * the committed src/assets/logo.svg, whose steps rise .32, .58, .82.
 *
 * DOM-free and Astro-free, so the prebuild script can import it.
 */
import { shiftDays } from "./client/feed"
import { levelScale } from "./client/tokens/aggregate"
import type { Site } from "./client/tokens/schema"

/** The ink of a heat level, 0 to 4: an empty day stays a faint cell so
 *  the shape survives a quiet week. */
const INK = [0.32, 0.32, 0.58, 0.82, 1]

/** The committed logo's three cells. */
export const DEFAULT_INK = [0.32, 0.58, 0.82]

/** The heat level (0–4) of each of the three days ending on the
 *  snapshot's newest day, oldest first, on the payload's own scale. */
export function recentLevels(site: Pick<Site, "today" | "daily">): number[] {
  const level = levelScale(site.daily)
  const tokens = new Map(site.daily.map((day) => [day.date, day.tokens]))
  return [-2, -1, 0].map((delta) =>
    level(tokens.get(shiftDays(site.today, delta)) ?? 0),
  )
}

const inkOf = (levels: number[]) => levels.map((level) => INK[level] ?? INK[0])

/** The logo's SVG for three cells' inks (the committed one by default). */
export function logoSvg(levels?: number[]): string {
  const [tr, bl, br] = levels ? inkOf(levels) : DEFAULT_INK
  const cell = (x: number, y: number, ink: number) =>
    `<rect x="${x}" y="${y}" width="8.8" height="8.8" rx="2"${ink === 1 ? "" : ` opacity="${String(ink).replace(/^0/, "")}"`}/>`
  return [
    `<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">`,
    cell(2.1, 2.1, 1),
    cell(13.1, 2.1, tr),
    cell(2.1, 13.1, bl),
    cell(13.1, 13.1, br),
    `</svg>`,
    "",
  ].join("\n")
}
