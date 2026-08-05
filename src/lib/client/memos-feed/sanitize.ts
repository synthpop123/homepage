/**
 * The trust boundary for remote status HTML. Mastodon serves content as
 * markup, so it is parsed into an inert document and rebuilt node by
 * node against an allow-list: unknown elements are unwrapped (their text
 * survives, the element doesn't), every attribute is dropped except a
 * plain http(s) `href` and the handful of Mastodon presentation classes
 * the styles here key off, and text nodes are tokenized so custom emoji
 * become inline images.
 *
 * This is the one part of the feed that needs a DOM (DOMParser), which
 * is why it sits beside the renderer rather than in the pure data layer.
 */

import { el } from "../dom"
import { splitEmojiText } from "../memos"

const ALLOWED = new Set([
  "P",
  "BR",
  "A",
  "SPAN",
  "STRONG",
  "B",
  "EM",
  "I",
  "DEL",
  "CODE",
  "PRE",
  "BLOCKQUOTE",
  "UL",
  "OL",
  "LI",
])

/**
 * The classes Mastodon uses to shorten links (`invisible` hides the
 * scheme, `ellipsis` marks the truncation) and to mark mentions and
 * hashtags. Copying the remote `class` attribute wholesale would let a
 * status address any selector on the page.
 */
const ALLOWED_CLASSES = new Set(["invisible", "ellipsis", "mention", "hashtag"])

/** Text with its :shortcode: runs replaced by inline emoji images. */
export const emojify = (text: string, emojis: Record<string, string>) =>
  splitEmojiText(text, emojis).map((token) => {
    if (token.type === "text") return document.createTextNode(token.value)
    const img = el("img", "emoji") as HTMLImageElement
    img.src = token.url
    img.alt = token.shortcode
    img.draggable = false
    return img
  })

const keepClasses = (source: Element, clone: Element) => {
  const kept = (source.getAttribute("class") ?? "")
    .split(/\s+/)
    .filter((name) => ALLOWED_CLASSES.has(name))
  if (kept.length > 0) clone.setAttribute("class", kept.join(" "))
}

const sanitize = (
  node: Node,
  emojis: Record<string, string>,
): DocumentFragment => {
  const fragment = document.createDocumentFragment()
  node.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      fragment.append(...emojify(child.textContent ?? "", emojis))
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const source = child as Element
      if (!ALLOWED.has(source.tagName)) {
        fragment.append(sanitize(source, emojis))
        return
      }
      const clone = el(source.tagName.toLowerCase())
      if (source.tagName === "A") {
        const href = source.getAttribute("href") ?? ""
        if (/^https?:\/\//i.test(href)) {
          clone.setAttribute("href", href)
          clone.setAttribute("target", "_blank")
          clone.setAttribute("rel", "nofollow noopener noreferrer")
        }
      }
      if (source.tagName === "A" || source.tagName === "SPAN") {
        keepClasses(source, clone)
      }
      clone.append(sanitize(source, emojis))
      fragment.append(clone)
    }
  })
  return fragment
}

/** Remote status HTML → a fragment safe to append. */
export const toFragment = (html: string, emojis: Record<string, string>) =>
  sanitize(new DOMParser().parseFromString(html, "text/html").body, emojis)
