// Type-only import for the `ctx.data.astro` DataMap augmentation.
import type {} from "@astrojs/markdown-satteri"
import { defineMdastPlugin } from "satteri"

const escapeHtml = (value: string) =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")

/**
 * Turns ```mermaid fences into `<pre class="mermaid">` elements so they skip
 * Expressive Code and get rendered client-side (see `Mermaid.astro`).
 *
 * Opt-in per post via `mermaid: true` frontmatter, which also gates the
 * `<Mermaid />` client script in `src/pages/blog/[...id].astro`. Without the
 * flag, fences fall through to Expressive Code as regular code blocks.
 */
export const mermaidDiagram = defineMdastPlugin({
  name: "mermaid-diagram",
  code(node, ctx) {
    if (node.lang !== "mermaid") return
    if (ctx.data.astro?.frontmatter.mermaid !== true) return
    return {
      type: "html",
      value: `<pre class="mermaid">${escapeHtml(node.value)}</pre>`,
    }
  },
})
