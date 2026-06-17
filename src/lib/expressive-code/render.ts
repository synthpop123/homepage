import type { ElementContent } from "hast"
import { toHtml } from "hast-util-to-html"
import { h } from "hastscript"
import { ExpressiveCodeBlock } from "satteri-expressive-code"
import { ecRenderer } from "./config"

export interface CodeInput {
  code: string
  lang?: string
  /** File name / title shown in the Expressive Code frame header. */
  title?: string
  /** Raw Expressive Code meta string (e.g. line markers); appended after `title`. */
  meta?: string
}

/** A single switchable tab: a renderable code block plus its tab label. */
export interface CodeTab extends CodeInput {
  label: string
}

function buildMeta({ title, meta }: CodeInput): string {
  const parts: string[] = []
  if (title) parts.push(`title=${JSON.stringify(title)}`)
  if (meta) parts.push(meta)
  return parts.join(" ")
}

/**
 * Renders one or more code blocks with the same Expressive Code renderer used
 * for blog posts. Each block is returned as a self-contained HTML string; the
 * shared base/theme styles and JS modules are injected only into the first one.
 */
export async function renderCodeBlocks(blocks: CodeInput[]): Promise<string[]> {
  const { ec, baseStyles, themeStyles, jsModules } = await ecRenderer
  const out: string[] = []
  let globalsInjected = false

  for (const block of blocks) {
    const { renderedGroupAst, styles } = await ec.render(
      new ExpressiveCodeBlock({
        code: block.code,
        language: block.lang ?? "plaintext",
        meta: buildMeta(block),
      }),
    )

    const extras: ElementContent[] = []
    const css = [
      ...(globalsInjected ? [] : [baseStyles, themeStyles]),
      ...styles,
    ]
      .filter(Boolean)
      .join("")
    if (css) extras.push(h("style", css))
    if (!globalsInjected) {
      for (const moduleCode of jsModules) {
        extras.push(h("script", { type: "module" }, moduleCode))
      }
      globalsInjected = true
    }

    if (extras.length) {
      const [first] = renderedGroupAst.children
      const firstIsStyle =
        first?.type === "element" && ["style", "link"].includes(first.tagName)
      renderedGroupAst.children.splice(firstIsStyle ? 1 : 0, 0, ...extras)
    }

    out.push(toHtml(renderedGroupAst))
  }

  return out
}
