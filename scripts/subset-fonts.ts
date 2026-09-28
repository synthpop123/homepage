/**
 * Subsets the two web fonts every page loads, Geist and Geist Mono
 * (variable), to the scripts this site is written in and the weights it
 * sets, and the maths face to what formulas reach.
 *
 * Geist ships Cyrillic, Greek and Vietnamese too, about a third of each
 * file, and none of it is used here. What stays: Latin through Latin
 * Extended-A (so an accented artist or film name from a feed still
 * renders in Geist), the combining accents, general punctuation,
 * super/subscripts, currency, letterlike symbols, arrows and maths
 * operators, plus every character the content and source use today.
 * Geist Mono also keeps box drawing, for directory trees in code blocks.
 * Anything else falls through to the fallback face in fonts.css.
 *
 * The `wght` axis stays variable but is cut to the range in use: 400 to
 * 600 for Geist (body, --font-weight-medium's 450, one 600 in Flights),
 * 400 to 700 for Geist Mono, whose code theme sets bold tokens. The
 * @font-face `font-weight` ranges in fonts.css have to match.
 *
 * STIX Two Math, the MathML face, is cut by range rather than by use:
 * every glyph ordinary maths can reach (Latin and Greek, operators,
 * arrows, delimiters, and the italic, bold, double-struck, script,
 * sans and monospace alphabets the browser maps <mi> letters onto),
 * so a new formula rarely needs a re-run. Its MATH table stays, with
 * the stretchy variants of every glyph kept.
 *
 * Run with `bun scripts/subset-fonts.ts`. Re-runnable: it always subsets
 * from the full fonts pinned in git history, never from the files it
 * writes. Re-run it after adding content in another script.
 */
import { execSync } from "node:child_process"
import { globSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import subsetFont from "subset-font"

// Last commits that carry the full woff2s.
const FULL_FONT_COMMIT = "fc8a5ec"
const FULL_MATH_COMMIT = "3b2daa0"

const RANGES: [number, number][] = [
  [0x20, 0x7e], // ASCII
  [0xa0, 0x17f], // Latin-1 supplement, Latin Extended-A
  [0x2c6, 0x2dc], // spacing accents (circumflex, caron, ring, tilde)
  [0x300, 0x30c], // combining accents
  [0x327, 0x327], // combining cedilla
  [0x2000, 0x206f], // general punctuation
  [0x2070, 0x209f], // superscripts and subscripts
  [0x20a0, 0x20cf], // currency
  [0x2100, 0x214f], // letterlike (™, №)
  [0x2190, 0x21ff], // arrows
  [0x2200, 0x22ff], // mathematical operators
  [0xfb01, 0xfb02], // fi, fl
]

/** Box drawing, which only the monospace face needs. */
const BOX: [number, number] = [0x2500, 0x257f]

/** Every character the content and the source use today. */
function usedChars(): string {
  const files = [
    ...globSync("src/content/**/*.md"),
    ...globSync("src/content/**/*.json"),
    ...globSync("src/**/*.{astro,ts}"),
  ]
  return files.map((file) => readFileSync(file, "utf8")).join("")
}

const chars = (ranges: [number, number][]) =>
  ranges
    .map(([from, to]) => {
      let out = ""
      for (let code = from; code <= to; code++)
        out += String.fromCodePoint(code)
      return out
    })
    .join("")

const dir = "src/assets/fonts"
const used = usedChars()

for (const [file, ranges, maxWeight] of [
  ["Geist-Variable.woff2", RANGES, 600],
  ["GeistMono-Variable.woff2", [...RANGES, BOX], 700],
] as const) {
  const full = execSync(`git show ${FULL_FONT_COMMIT}:${dir}/${file}`, {
    maxBuffer: 8 * 1024 * 1024,
  })
  const text = [...new Set(chars([...ranges]) + used)].join("")
  const output = await subsetFont(full, text, {
    targetFormat: "woff2",
    variationAxes: { wght: { min: 400, max: maxWeight, default: 400 } },
  })
  writeFileSync(path.join(dir, file), output)
  const percent = ((1 - output.length / full.length) * 100).toFixed(1)
  console.log(
    `[subset] ${file}: ${full.length} -> ${output.length} bytes (-${percent}%)`,
  )
}

/** What maths reaches: the text ranges above plus the maths blocks. */
const MATH_RANGES: [number, number][] = [
  [0x20, 0x7e], // ASCII
  [0xa0, 0xff], // Latin-1 (×, ÷, ¬, ±)
  [0x131, 0x131], // dotless i
  [0x237, 0x237], // dotless j
  [0x2c6, 0x2dc], // spacing accents
  [0x300, 0x36f], // combining accents
  [0x391, 0x3f6], // Greek
  [0x2000, 0x206f], // general punctuation (invisible operators too)
  [0x2070, 0x209f], // superscripts and subscripts
  [0x20d0, 0x20ff], // combining marks for symbols (vector arrows)
  [0x2100, 0x214f], // letterlike (ℝ, ℕ, ℓ)
  [0x2190, 0x21ff], // arrows
  [0x2200, 0x22ff], // mathematical operators
  [0x2300, 0x23ff], // technical (ceilings, floors, brace pieces)
  [0x25a0, 0x25ff], // geometric shapes (∎)
  [0x27c0, 0x27ff], // miscellaneous maths A, long arrows
  [0x2900, 0x2aff], // arrows B, maths B, supplemental operators
  [0x1d400, 0x1d433], // bold
  [0x1d434, 0x1d467], // italic
  [0x1d49c, 0x1d4cf], // script
  [0x1d538, 0x1d56b], // double-struck
  [0x1d5a0, 0x1d5d3], // sans-serif
  [0x1d670, 0x1d6a3], // monospace
  [0x1d6a8, 0x1d6e1], // bold Greek
  [0x1d6fc, 0x1d735], // italic Greek
]

const math = "STIXTwoMath-Regular.woff2"
const fullMath = execSync(`git show ${FULL_MATH_COMMIT}:${dir}/${math}`, {
  maxBuffer: 8 * 1024 * 1024,
})
const mathOutput = await subsetFont(fullMath, chars(MATH_RANGES), {
  targetFormat: "woff2",
})
writeFileSync(path.join(dir, math), mathOutput)
console.log(
  `[subset] ${math}: ${fullMath.length} -> ${mathOutput.length} bytes (-${((1 - mathOutput.length / fullMath.length) * 100).toFixed(1)}%)`,
)
