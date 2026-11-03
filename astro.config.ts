import { defineConfig } from "astro/config"
import sitemap from "@astrojs/sitemap"
import { satteri } from "@astrojs/markdown-satteri"
import {
  expressiveCodeAssets,
  hastPlugins,
  mdastPlugins,
} from "./src/lib/markdown"
import { SITE_ORIGIN } from "./src/lib/site-links"

export default defineConfig({
  site: SITE_ORIGIN,
  trailingSlash: "never",
  compressHTML: true,
  prefetch: { prefetchAll: true },
  vite: {
    plugins: [expressiveCodeAssets()],
    // Only Mermaid's lazy chunks pass 500 kB: its langium parsers (~630 kB)
    // and ELK (~1.4 MB, never fetched — Mermaid.astro pins dagre). The
    // site's own chunks stay far below either, so the default only cried
    // wolf on every build.
    build: { chunkSizeWarningLimit: 1500 },
  },
  // Every image, Markdown ones included, ships a width srcset, so a phone
  // is not handed a 1600px screenshot. The layout CSS stays ours
  // (reset.css already caps images at their container).
  image: { layout: "constrained", responsiveStyles: false },
  integrations: [
    sitemap({
      filter: (page) =>
        !/\/blog\/[^/]+\/[^/]+\/?$/.test(page) &&
        !page.includes("/tags/") &&
        !/\/fixtures\/?$/.test(page),
    }),
  ],
  markdown: {
    syntaxHighlight: false,
    processor: satteri({
      features: { directive: true, math: true },
      mdastPlugins,
      hastPlugins,
    }),
  },
})
