import { defineConfig } from "astro/config"
import sitemap from "@astrojs/sitemap"
import { satteri } from "@astrojs/markdown-satteri"
import {
  blockExpressiveCode,
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
  redirects: {
    "/posts": "/blog",
    "/posts/[...id]": "/blog/[...id]",
    // Pre-rebuild standalone pages, now sections on /misc.
    "/movies": "/misc#movies",
    "/music": "/misc#music",
  },
  integrations: [
    sitemap({
      filter: (page) =>
        !/\/blog\/[^/]+\/[^/]+\/?$/.test(page) &&
        !page.includes("/tags/") &&
        !page.includes("/posts/"),
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
