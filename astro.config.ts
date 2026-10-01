import { defineConfig } from "astro/config"
import sitemap from "@astrojs/sitemap"
import { satteri } from "@astrojs/markdown-satteri"
import {
  expressiveCodeAssets,
  hastPlugins,
  mdastPlugins,
} from "./src/lib/markdown"

export default defineConfig({
  site: "https://lkwplus.com",
  trailingSlash: "never",
  compressHTML: true,
  prefetch: { prefetchAll: true },
  vite: { plugins: [expressiveCodeAssets()] },
  // Every image, Markdown ones included, ships a width srcset, so a phone
  // is not handed a 1600px screenshot. The layout CSS stays ours
  // (reset.css already caps images at their container).
  image: { layout: "constrained", responsiveStyles: false },
  integrations: [
    sitemap({
      filter: (page) =>
        !/\/blog\/[^/]+\/[^/]+\/?$/.test(page) && !page.includes("/tags/"),
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
