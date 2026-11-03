import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { Glob } from "bun"

/**
 * Colours come from tokens. A literal is allowed only where a token cannot
 * reach: the token files themselves, the `theme-color` meta (which a browser
 * reads before any CSS), and the OG renderer (Satori draws without CSS), which
 * the second test holds to the tokens instead.
 */
const ALLOW = [
  "src/styles/color.css",
  "src/styles/tokens/shared.css",
  "src/components/MetaHead.astro",
  "src/lib/og.ts",
]
const LITERAL = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(/g

/** The parts of a file a colour could hide in. */
function stylable(file: string, text: string): string {
  if (!file.endsWith(".astro")) return text
  const blocks = text.match(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/g) ?? []
  return blocks.join("\n")
}

describe("colour literals", () => {
  it("appear only in the token files", async () => {
    const offenders: string[] = []
    for await (const file of new Glob("src/**/*.{css,astro,ts}").scan(".")) {
      if (ALLOW.includes(file) || file.endsWith(".test.ts")) continue
      const hits = stylable(file, readFileSync(file, "utf8")).match(LITERAL)
      if (hits) offenders.push(`${file}: ${[...new Set(hits)].join(" ")}`)
    }
    expect(offenders).toEqual([])
  })
})

/** A token's light-scheme value, following var() aliases through color.css. */
function lightValue(css: string, name: string): string {
  const decl = css.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1].trim()
  if (!decl) throw new Error(`--${name} is not declared`)
  const light = decl.match(/^light-dark\(\s*([^,]+?)\s*,/)?.[1] ?? decl
  const alias = light.match(/^var\(--([a-z0-9-]+)\)$/)?.[1]
  return alias ? lightValue(css, alias) : light.toLowerCase()
}

describe("OG cards", () => {
  const css = readFileSync("src/styles/color.css", "utf8")
  const og = readFileSync("src/lib/og.ts", "utf8")
  const constant = (name: string) =>
    og.match(new RegExp(`const ${name} = "(#[0-9a-f]+)"`))?.[1]

  it.each([
    ["BG", "background"],
    ["FG", "foreground"],
    ["MUTED", "muted-foreground"],
    ["CELL", "heat-0"],
    ["RELATED", "heat-1"],
    ["ACCENT", "accent-fill"],
  ])("%s mirrors --%s in the light scheme", (og, token) => {
    expect(constant(og)).toBe(lightValue(css, token))
  })
})
