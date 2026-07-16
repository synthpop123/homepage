// subset-font ships no type declarations; minimal surface used by
// scripts/subset-og-fonts.ts.
declare module "subset-font" {
  export default function subsetFont(
    buffer: Buffer,
    text: string,
    options?: { targetFormat?: "sfnt" | "woff" | "woff2" },
  ): Promise<Buffer>
}
