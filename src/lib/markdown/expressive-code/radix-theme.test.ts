import { describe, expect, it } from "bun:test"
import * as radix from "@radix-ui/colors"
import vitesseDark from "@shikijs/themes/vitesse-dark"
import vitesseLight from "@shikijs/themes/vitesse-light"
import { nearestStep, radixSteps, radixTheme } from "./radix-theme"

/** Every solid Radix value, lowercased. */
const RADIX = new Set(
  Object.entries(radix)
    .filter(([key, scale]) => typeof scale === "object" && !/A$|P3/.test(key))
    .flatMap(([, scale]) => Object.values(scale as Record<string, unknown>))
    .filter((hex): hex is string => typeof hex === "string")
    .map((hex) => hex.toLowerCase()),
)
const solid = (hex: string) => hex.toLowerCase().slice(0, 7)

const theme = (source: unknown) => {
  const t = structuredClone(source) as {
    type: "dark" | "light"
    colors: Record<string, string>
    tokenColors: { settings?: { foreground?: string; background?: string } }[]
  }
  return radixTheme({ type: t.type, colors: t.colors, settings: t.tokenColors })
}

describe("radixTheme", () => {
  for (const [name, source] of [
    ["vitesse-light", vitesseLight],
    ["vitesse-dark", vitesseDark],
  ] as const) {
    it(`puts every colour of ${name} on a Radix step`, () => {
      const t = theme(source)
      const hexes = [
        ...Object.values(t.colors),
        ...t.settings.flatMap((rule) => [
          rule.settings?.foreground,
          rule.settings?.background,
        ]),
      ].filter((v): v is string => typeof v === "string" && v.startsWith("#"))
      expect(hexes.length).toBeGreaterThan(20)
      for (const hex of hexes) expect(RADIX.has(solid(hex))).toBe(true)
    })

    it(`sets ${name}'s syntax at text steps (a hue's 11, Olive 11 or 12)`, () => {
      const t = theme(source)
      const text = new Set(
        radixSteps(t.type === "dark", true).map((s) => s.hex.toLowerCase()),
      )
      for (const rule of t.settings) {
        const fg = rule.settings?.foreground
        if (fg) expect(text.has(solid(fg))).toBe(true)
      }
    })
  }
})

describe("nearestStep", () => {
  it("keeps alpha and passes non-hex values through", () => {
    expect(nearestStep("#ffffff80", radixSteps(false, false))).toMatch(
      /^#[0-9a-f]{6}80$/i,
    )
    expect(nearestStep("var(--x)", radixSteps(false, false))).toBe("var(--x)")
  })
})

describe("greys", () => {
  it("sets Vitesse's comments in the neutral, not in a hue", () => {
    const comment = (source: unknown) =>
      theme(source).settings.find((rule) =>
        JSON.stringify(rule).includes('"comment"'),
      )?.settings?.foreground
    expect(comment(vitesseLight)?.toLowerCase()).toBe(
      radix.olive.olive11.toLowerCase(),
    )
    expect(comment(vitesseDark)?.toLowerCase()).toBe(
      radix.oliveDark.olive11.toLowerCase(),
    )
  })
})
