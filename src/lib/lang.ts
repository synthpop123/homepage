/**
 * The language a post is written in, read from its Markdown when the
 * frontmatter does not say. Only prose counts: code, maths, HTML, URLs and
 * link targets are dropped first, since a Chinese post's code is English.
 * Each Han character is weighed against each Latin word, and a post whose
 * prose is mostly Han is `zh-CN`; anything else is the site's own locale.
 */

const HAN = /[㐀-䶿一-鿿豈-﫿]/g
const WORD = /[A-Za-z][A-Za-z'-]*/g
const FENCE = /^(`{3,}|~{3,})[^\n]*\n([\s\S]*?)^\1[^\n]*$/gm

/** Markdown less what is never read as words: maths, HTML tags, link
 *  targets and bare URLs. */
const readable = (markdown: string) =>
  markdown
    .replace(/\$\$[\s\S]*?\$\$/g, "")
    .replace(/\$[^$\n]*\$/g, "")
    .replace(/<[^>\n]*>/g, "")
    .replace(/\]\([^)]*\)/g, "]")
    .replace(/https?:\/\/\S+/g, "")

export const prose = (markdown: string): string =>
  readable(markdown.replace(FENCE, "").replace(/`[^`\n]*`/g, ""))

/** How long a post is to read: every Han character a word, as a reader
 *  of Chinese counts them, plus every Latin word or number, code
 *  included — a walkthrough that is mostly commands is still long. */
export function countWords(markdown: string): number {
  const { han, latin } = words(markdown)
  return han + latin
}

/** The same words as minutes of reading: 400 Han characters or 230
 *  Latin words a minute, at least one. */
export function readingMinutes(markdown: string): number {
  const { han, latin } = words(markdown)
  return Math.max(1, Math.round(han / 400 + latin / 230))
}

const words = (markdown: string) => {
  const text = readable(markdown.replace(FENCE, "$2"))
  const han = text.match(HAN)?.length ?? 0
  const latin = text.replace(HAN, " ").match(/[A-Za-z0-9][\w'’.-]*/g)
  return { han, latin: latin?.length ?? 0 }
}

export function detectLang(markdown: string, fallback: string): string {
  const text = prose(markdown)
  const han = text.match(HAN)?.length ?? 0
  const words = text.match(WORD)?.length ?? 0
  return han > 0 && han >= words ? "zh-CN" : fallback
}
