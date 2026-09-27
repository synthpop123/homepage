/**
 * Subsets the two web fonts every page loads, Geist and Geist Mono
 * (variable, `wght` kept), to the scripts this site is written in.
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
 * Run with `bun scripts/subset-fonts.ts`. Re-runnable: it always subsets
 * from the full fonts pinned in git history, never from the files it
 * writes. Re-run it after adding content in another script.
 */
import { execSync } from "node:child_process"
import { globSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import subsetFont from "subset-font"

// Last commit that carries the full Geist woff2s.
const FULL_FONT_COMMIT = "fc8a5ec"

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

for (const [file, ranges] of [
  ["Geist-Variable.woff2", RANGES],
  ["GeistMono-Variable.woff2", [...RANGES, BOX]],
] as const) {
  const full = execSync(`git show ${FULL_FONT_COMMIT}:${dir}/${file}`, {
    maxBuffer: 8 * 1024 * 1024,
  })
  const text = [...new Set(chars([...ranges]) + used)].join("")
  const output = await subsetFont(full, text, { targetFormat: "woff2" })
  writeFileSync(path.join(dir, file), output)
  const percent = ((1 - output.length / full.length) * 100).toFixed(1)
  console.log(
    `[subset] ${file}: ${full.length} -> ${output.length} bytes (-${percent}%)`,
  )
}
