import { defineConfig } from "astro/config"
import sitemap from "@astrojs/sitemap"
import { satteri } from "@astrojs/markdown-satteri"
import {
  blockExpressiveCode,
  expressiveCodeAssets,
  inlineExpressiveCode,
} from "./src/lib/expressive-code"
import { temmlMath } from "./src/lib/math"
import { mermaidDiagram } from "./src/lib/mermaid"
import { calloutDirective } from "./src/lib/callout"
import { externalLinks } from "./src/lib/external-links"
import { asides } from "./src/lib/asides"
import { headingNamespace } from "./src/lib/heading-namespace"
import { headingAnchors } from "./src/lib/heading-anchors"

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
      mdastPlugins: [
        calloutDirective,
        inlineExpressiveCode,
        temmlMath,
        mermaidDiagram,
      ],
      hastPlugins: [
        externalLinks,
        asides,
        blockExpressiveCode,
        headingNamespace,
        headingAnchors,
      ],
    }),
  },
})
