/**
 * The Markdown pipeline, in order. Sätteri runs each list over every
 * post; `astro.config.ts` hands both to the processor. A plugin's own
 * file changing does not invalidate Astro's rendered-post cache — delete
 * `.astro/data-store.json` before building.
 */

import { asides } from "./asides"
import { calloutDirective } from "./callout"
import { blockExpressiveCode, inlineExpressiveCode } from "./expressive-code"
import { externalLinks } from "./external-links"
import { fileTreeDirective } from "./file-tree"
import { headingAnchors } from "./heading-anchors"
import { headingNamespace } from "./heading-namespace"
import { temmlMath } from "./math"
import { mermaidDiagram } from "./mermaid"
import { stepsDirective } from "./steps"
import { tableScroll } from "./table-scroll"
import { unhandledDirectives } from "./unhandled-directives"

export { expressiveCodeAssets } from "./expressive-code"

export const mdastPlugins = [
  calloutDirective,
  stepsDirective,
  fileTreeDirective,
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
