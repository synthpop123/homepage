/**
 * The language a post is written in, read from its Markdown when the
 * frontmatter does not say. Only prose counts: code, maths, HTML, URLs and
 * link targets are dropped first, since a Chinese post's code is English.
 * Each Han character is weighed against each Latin word, and a post whose
 * prose is mostly Han is `zh-CN`; anything else is the site's own locale.
 */

const HAN = /[㐀-䶿一-鿿豈-﫿]/g
const WORD = /[A-Za-z][A-Za-z'-]*/g

export function prose(markdown: string): string {
  return markdown
    .replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, "")
    .replace(/`[^`\n]*`/g, "")
    .replace(/\$\$[\s\S]*?\$\$/g, "")
    .replace(/\$[^$\n]*\$/g, "")
    .replace(/<[^>]*>/g, "")
    .replace(/\]\([^)]*\)/g, "]")
    .replace(/https?:\/\/\S+/g, "")
}

export function detectLang(markdown: string, fallback: string): string {
  const text = prose(markdown)
  const han = text.match(HAN)?.length ?? 0
  const words = text.match(WORD)?.length ?? 0
  return han > 0 && han >= words ? "zh-CN" : fallback
}
