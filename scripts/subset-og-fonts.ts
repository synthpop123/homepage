/**
 * Subsets the Noto Sans SC fonts used for build-time OG card rendering
 * (src/lib/og.ts). The full fonts weigh ~4.4 MB each and dominate both
 * checkout size and OG generation time.
 *
 * Kept glyphs: all GB2312 hanzi (6763 common characters, generated via
 * the gb18030 decoder rather than a hardcoded list), Latin, kana,
 * arrows, CJK/fullwidth punctuation, plus every character that appears
 * in the current blog content and site config — so existing pages can
 * never lose a glyph, and future titles are covered unless they use a
 * character outside GB2312.
 *
 * Run with `bun scripts/subset-og-fonts.ts`. Re-runnable: it always
 * subsets from the pristine full fonts stored in git history (pinned
 * blob below), not from the working-tree files it overwrites. After
 * adding a post whose title needs an exotic character, just re-run.
 */
import { execSync } from "node:child_process"
import { globSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import subsetFont from "subset-font"

// Last commit that carries the full (un-subset) Noto Sans SC woffs.
const FULL_FONT_COMMIT = "982bc39"

const RANGES: [number, number][] = [
  [0x20, 0x7e], // ASCII
  [0xa0, 0xff], // Latin-1 supplement
  [0x2000, 0x206f], // general punctuation (dashes, quotes, ellipsis)
  [0x2190, 0x21ff], // arrows
  [0x3000, 0x303f], // CJK symbols and punctuation
  [0x3040, 0x30ff], // hiragana + katakana
  [0xff00, 0xffef], // fullwidth and halfwidth forms
]

/** All 6763 GB2312 hanzi, decoded from the GB2312 two-byte zone. */
function gb2312Hanzi(): string {
  const decoder = new TextDecoder("gb18030")
  const bytes: number[] = []
  // Hanzi rows 16-87: lead byte 0xB0-0xF7, trail byte 0xA1-0xFE.
  for (let lead = 0xb0; lead <= 0xf7; lead++) {
    for (let trail = 0xa1; trail <= 0xfe; trail++) bytes.push(lead, trail)
  }
  return [...decoder.decode(new Uint8Array(bytes))]
    .filter((char) => /\p{Script=Han}/u.test(char))
    .join("")
}

/** Every character used in blog content and site config today. */
function contentChars(): string {
  const files = [
    ...globSync("src/content/**/*.md"),
    ...globSync("src/content/**/*.json"),
    "src/consts.ts",
  ]
  return files.map((file) => readFileSync(file, "utf8")).join("")
}

const rangeChars = RANGES.map(([from, to]) => {
  let chars = ""
  for (let code = from; code <= to; code++) chars += String.fromCodePoint(code)
  return chars
}).join("")

const text = [...new Set(rangeChars + gb2312Hanzi() + contentChars())].join("")
console.log(`[subset] keeping ${text.length} unique characters`)

const dir = "src/assets/fonts/og"

for (const file of ["NotoSansSC-Regular.woff", "NotoSansSC-Medium.woff"]) {
  const full = execSync(`git show ${FULL_FONT_COMMIT}:${dir}/${file}`, {
    maxBuffer: 32 * 1024 * 1024,
  })
  const output = await subsetFont(full, text, { targetFormat: "woff" })
  writeFileSync(path.join(dir, file), output)
  const percent = ((1 - output.length / full.length) * 100).toFixed(1)
  console.log(
    `[subset] ${file}: ${full.length} -> ${output.length} bytes (-${percent}%)`,
  )
}
