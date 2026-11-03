/**
 * The code themes in Radix Colors. Expressive Code ships Vitesse with its
 * own hex values; customizeTheme hands each theme here, and every colour
 * in it comes back as the nearest Radix step (by OKLab distance, alpha
 * kept), light themes onto the light scales and dark onto the dark.
 *
 * Syntax colours follow Radix's rule for text: a hue at step 11, and the
 * neutral (Olive, the site's) at 11 for quiet text such as comments or 12
 * for the body of the code. The theme's other colours (selection,
 * borders, the editor's own surfaces) may land on any step.
 *
 * Pure and Astro-free, so it is unit-tested on its own.
 */
import * as radix from "@radix-ui/colors"

type Rgb = [number, number, number]
type Step = { name: string; hex: string; lab: Rgb }

/** The grey families Radix pairs with other hues; only Olive, the site's
 *  neutral, is a candidate. */
const OTHER_GREYS = new Set(["gray", "mauve", "slate", "sage", "sand"])

const parse = (hex: unknown): { rgb: Rgb; alpha: string } | null => {
  if (typeof hex !== "string") return null
  const m = hex.trim().match(/^#([0-9a-f]{3,8})$/i)
  if (!m) return null
  let h = m[1]
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("")
  if (h.length !== 6 && h.length !== 8) return null
  return {
    rgb: [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16)) as Rgb,
    alpha: h.length === 8 ? h.slice(6) : "",
  }
}

const linear = (c: number) => {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}

const oklab = ([r8, g8, b8]: Rgb): Rgb => {
  const [r, g, b] = [linear(r8), linear(g8), linear(b8)]
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

/** Every solid step of every scale for one scheme. */
function steps(dark: boolean): Step[] {
  const out: Step[] = []
  for (const [key, scale] of Object.entries(radix)) {
    if (typeof scale !== "object" || !scale) continue
    if (/A$|P3/.test(key) || key.endsWith("Dark") !== dark) continue
    const family = dark ? key.slice(0, -4) : key
    if (OTHER_GREYS.has(family)) continue
    for (const [name, hex] of Object.entries(scale as Record<string, string>)) {
      const parsed = parse(hex)
      if (parsed) out.push({ name, hex, lab: oklab(parsed.rgb) })
    }
  }
  return out
}

const LIGHT = steps(false)
const DARK = steps(true)

const stepNumber = (name: string) => Number(name.match(/(\d+)$/)?.[1])
const isNeutral = (name: string) => name.startsWith("olive")

/** Where a syntax colour may land: a hue's step 11, or Olive 11 or 12. */
const textSteps = (all: Step[]) =>
  all.filter(({ name }) =>
    isNeutral(name)
      ? [11, 12].includes(stepNumber(name))
      : stepNumber(name) === 11,
  )

const LIGHT_TEXT = textSteps(LIGHT)
const DARK_TEXT = textSteps(DARK)
const LIGHT_GREY_TEXT = LIGHT_TEXT.filter(({ name }) => isNeutral(name))
const DARK_GREY_TEXT = DARK_TEXT.filter(({ name }) => isNeutral(name))

/** A colour with next to no hue (a comment's grey, even a greenish one)
 *  is the neutral's, whatever hue it leans to. */
const GREY_CHROMA = 0.04
const isGrey = (value: string) => {
  const parsed = parse(value)
  if (!parsed) return false
  const [, a, b] = oklab(parsed.rgb)
  return Math.hypot(a, b) < GREY_CHROMA
}

const distance = (a: Rgb, b: Rgb) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

/** The nearest step to a colour among the candidates, its alpha kept
 *  unless `solid`. A value that isn't a hex colour (a CSS variable,
 *  `inherit`) passes through unchanged. */
export function nearestStep(
  value: string,
  candidates: Step[],
  solid = false,
): string {
  const parsed = parse(value)
  if (!parsed) return value
  const lab = oklab(parsed.rgb)
  let best = candidates[0]
  let bestDistance = Number.POSITIVE_INFINITY
  for (const step of candidates) {
    const d = distance(lab, step.lab)
    if (d < bestDistance) {
      best = step
      bestDistance = d
    }
  }
  return best.hex + (solid ? "" : parsed.alpha)
}

/** The candidates for one scheme: text steps, or every step. */
export const radixSteps = (dark: boolean, text: boolean) =>
  dark ? (text ? DARK_TEXT : DARK) : text ? LIGHT_TEXT : LIGHT

/** A syntax colour's step: Olive 11 or 12 for a grey, else the nearest
 *  text step. Opaque: a translucent text colour is not a Radix step. */
function textStep(value: string, dark: boolean): string {
  const greys = dark ? DARK_GREY_TEXT : LIGHT_GREY_TEXT
  return nearestStep(
    value,
    isGrey(value) ? greys : radixSteps(dark, true),
    true,
  )
}

type ThemeLike = {
  type: "dark" | "light"
  /** Expressive Code's themes keep their default text and background
   *  here too, read from the colours when the theme was made. */
  fg?: string
  bg?: string
  colors: Record<string, string>
  settings: { settings?: { foreground?: string; background?: string } }[]
}

/** Rewrites a theme's colours in place onto Radix steps. */
export function radixTheme<T extends ThemeLike>(theme: T): T {
  const dark = theme.type === "dark"
  if (theme.fg) theme.fg = textStep(theme.fg, dark)
  if (theme.bg) theme.bg = nearestStep(theme.bg, radixSteps(dark, false))
  for (const key of Object.keys(theme.colors)) {
    theme.colors[key] = nearestStep(theme.colors[key], radixSteps(dark, false))
  }
  for (const rule of theme.settings) {
    const s = rule.settings
    if (!s) continue
    if (s.foreground) s.foreground = textStep(s.foreground, dark)
    if (s.background)
      s.background = nearestStep(s.background, radixSteps(dark, false))
  }
  return theme
}
