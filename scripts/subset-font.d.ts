// subset-font ships no type declarations; minimal surface used by
// scripts/subset-fonts.ts and scripts/subset-og-fonts.ts.
declare module "subset-font" {
  type Axis = number | { min: number; max: number; default?: number }
  export default function subsetFont(
    buffer: Buffer,
    text: string,
    options?: {
      targetFormat?: "sfnt" | "woff" | "woff2"
      variationAxes?: Record<string, Axis>
    },
  ): Promise<Buffer>
}
