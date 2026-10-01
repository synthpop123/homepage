/**
 * The Markdown pipeline, in order. Sätteri runs each list over every
 * post; `astro.config.ts` hands both to the processor. A plugin's own
 * file changing does not invalidate Astro's rendered-post cache — delete
 * `node_modules/.astro/data-store.json` before building.
 */

import { asides } from "./asides"
import { calloutDirective } from "./callout"
import { blockExpressiveCode, inlineExpressiveCode } from "./expressive-code"
import { externalLinks } from "./external-links"
import { headingAnchors } from "./heading-anchors"
import { headingNamespace } from "./heading-namespace"
import { temmlMath } from "./math"
import { mermaidDiagram } from "./mermaid"
import { tableScroll } from "./table-scroll"
import { unhandledDirectives } from "./unhandled-directives"

export { expressiveCodeAssets } from "./expressive-code"

export const mdastPlugins = [
  calloutDirective,
  inlineExpressiveCode,
  temmlMath,
  mermaidDiagram,
  // Last: it judges whatever directive the plugins above left unclaimed.
  unhandledDirectives,
]

export const hastPlugins = [
  externalLinks,
  asides,
  blockExpressiveCode,
  tableScroll,
  headingNamespace,
  headingAnchors,
]
