/**
 * The sparklines beside a /misc section's heading: the last month of
 * the section's daily series as a row of thin bars, so the heading says
 * the section is live before the reader gets to it. SectionHead.astro
 * draws the empty bars (so the heading never shifts); the section's feed
 * fills them through `drawSpark` once its data lands.
 */

export const SPARK_DAYS = 30

/** Each day's height as a share of the busiest day; all zeros for a
 *  quiet month rather than a division by zero. */
export function sparkShares(values: number[]): number[] {
  const max = Math.max(...values, 0)
  return values.map((value) => (max > 0 ? value / max : 0))
}

/** Fill section `id`'s sparkline with the last month of its daily
 *  `values` (oldest first), and say the month's total, as `describe`
 *  words it, in the tooltip. */
export function drawSpark(
  id: string,
  values: number[],
  describe: (total: number) => string,
) {
  const spark = document.querySelector<HTMLElement>(`[data-spark="${id}"]`)
  if (!spark) return
  const bars = spark.querySelectorAll<HTMLElement>("i")
  const month = values.slice(-bars.length)
  const shares = sparkShares(month)
  // A series shorter than the month leaves its oldest bars empty.
  const offset = bars.length - shares.length
  bars.forEach((bar, index) => {
    const share = shares[index - offset] ?? 0
    bar.style.setProperty("--share", String(share))
    bar.toggleAttribute("data-zero", share === 0)
  })
  const total = month.reduce((sum, value) => sum + value, 0)
  spark.title = `${describe(total)} in the last ${bars.length} days`
  spark.removeAttribute("data-skeleton")
}
