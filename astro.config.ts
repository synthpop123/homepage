import { defineConfig } from "astro/config"
import sitemap from "@astrojs/sitemap"
import { satteri } from "@astrojs/markdown-satteri"
import {
  expressiveCodeAssets,
  hastPlugins,
  mdastPlugins,
} from "./src/lib/markdown"
import { SITE_ORIGIN } from "./src/lib/site-links"

/** The hosts a page talks to: the live sections' Worker, the tracker's
 *  collector, and the home cat's refresh. */
const CONNECT = [
  "https://api.lkwplus.com",
  "https://umami.lkwplus.com",
  "https://cataas.com",
]

export default defineConfig({
  site: SITE_ORIGIN,
  trailingSlash: "never",
  compressHTML: true,
  prefetch: { prefetchAll: true },
  // Each page carries a CSP <meta>: scripts run only from this origin or
  // by the hash of an inline one Astro emitted, so markup that reaches
  // the DOM some other way (/memos draws Mastodon's HTML through a
  // sanitizer) cannot run script even if the sanitizer misses. Styles
  // stay open to inline ones: `style` attributes carry the charts'
  // custom properties, and Mermaid and Expressive Code write their own.
  // What the pages fetch is listed; images may come from any https host
  // (covers, posters, avatars and the cat). public/_headers adds what a
  // <meta> cannot say (frame-ancestors).
  security: {
    csp: {
      styleDirective: { resources: ["'self'", "'unsafe-inline'"] },
      directives: [
        "default-src 'self'",
        "img-src 'self' data: blob: https:",
        "font-src 'self'",
        `connect-src 'self' ${CONNECT.join(" ")}`,
        "object-src 'none'",
        "base-uri 'self'",
      ],
    },
  },
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
