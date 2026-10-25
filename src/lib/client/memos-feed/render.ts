/**
 * Turns one normalized memo into DOM: the date rail, the sanitized
 * content, and the attachment grid. Everything the shape of an entry
 * depends on is decided in the pure layer (`memos.ts`) — this module
 * only builds nodes, so its only branches are about which element a
 * thing renders as.
 */

import { el } from "../dom"
import { monthDay, TIME_ZONE } from "../feed"
import {
  type Memo,
  type MemoMedia,
  sizesFor,
  splitMedia,
  timeLabel,
} from "../memos"
import { emojify, toFragment } from "./sanitize"

const yearFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  timeZone: TIME_ZONE,
})

/** The calendar year a memo was posted in, in the site's zone. */
export const memoYear = (memo: Memo) =>
  yearFormatter.format(new Date(memo.createdAt))

const reduceMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches

/* Attachments ---------------------------------------------------------- */

function renderImage(item: MemoMedia, sizes: string) {
  // The wrapping permalink is the no-JS path to the full-size original,
  // and what the lightbox hijacks when it can take over.
  const link = el("a") as HTMLAnchorElement
  link.href = item.href
  link.target = "_blank"
  link.rel = "noopener noreferrer"

  const img = el("img") as HTMLImageElement
  img.src = item.src ?? item.href
  if (item.srcset) {
    img.srcset = item.srcset
    img.sizes = sizes
  }
  img.alt = item.alt
  img.loading = "lazy"
  img.decoding = "async"
  if (item.width && item.height) {
    img.width = item.width
    img.height = item.height
  }

  img.addEventListener("error", () => {
    // One retry, straight at the original: dropping the srcset alone
    // would re-request the preview that just failed.
    if (img.srcset) {
      img.removeAttribute("srcset")
      img.removeAttribute("sizes")
      img.src = item.href
    }
  })

  link.append(img)
  return link
}

/**
 * `gifv` is Mastodon's animated GIF: an mp4 that should play silently
 * on its own. Under reduced motion it falls back to the same treatment
 * as a real video — poster frame, controls, nothing loaded until asked.
 */
function renderVideo(item: MemoMedia) {
  const video = el("video") as HTMLVideoElement
  video.src = item.href
  if (item.src) video.poster = item.src
  video.playsInline = true
  video.setAttribute("aria-label", item.alt)
  // Same reason the images carry them: a lone attachment is laid out
  // from its own ratio, and the card shrink-wraps whatever that is.
  if (item.width && item.height) {
    video.width = item.width
    video.height = item.height
  }
  if (item.loop && !reduceMotion()) {
    // Both spellings: autoplay is gated on the element being muted, and
    // the property alone doesn't reflect into the attribute the policy
    // is documented against.
    video.muted = true
    video.setAttribute("muted", "")
    video.loop = true
    video.autoplay = true
    video.preload = "auto"
  } else {
    video.controls = true
    video.preload = "none"
  }
  return video
}

function renderMediaGrid(media: MemoMedia[]) {
  const grid = el("div", "memo-media")
  grid.dataset.count = String(Math.min(media.length, 4))
  media.forEach((item, index) => {
    const figure = el("figure", "memo-shot")
    figure.append(
      item.kind === "video"
        ? renderVideo(item)
        : renderImage(item, sizesFor(media, index)),
    )
    grid.append(figure)
  })
  return grid
}

function renderAudio(item: MemoMedia) {
  const player = el("audio", "memo-audio") as HTMLAudioElement
  player.src = item.href
  player.controls = true
  player.preload = "none"
  player.setAttribute("aria-label", item.alt)
  return player
}

/* Content warnings ----------------------------------------------------- */

/**
 * Folds `body` behind a disclosure. One primitive covers both of
 * Mastodon's cases — a content warning shrouds the whole entry under
 * its own text, a merely sensitive attachment shrouds only the media
 * and leaves the note itself readable.
 */
function shroud(summaryNodes: Node[], body: Node[]) {
  const details = el("details", "memo-cw")
  const summary = el("summary")
  summary.append(...summaryNodes)
  const inner = el("div", "memo-cw-body")
  inner.append(...body)
  details.append(summary, inner)
  return details
}

/* Entries -------------------------------------------------------------- */

function renderRail(memo: Memo) {
  const rail = el("p", "memo-rail")
  const permalink = el("a", "memo-time") as HTMLAnchorElement
  permalink.href = memo.url
  permalink.target = "_blank"
  permalink.rel = "noopener noreferrer"
  permalink.title = timeLabel(memo.createdAt)
  const date = new Date(memo.createdAt)
  const time = el("time") as HTMLTimeElement
  time.dateTime = date.toISOString()
  // The year is said once, by the marker that opens it on the thread,
  // so each entry only needs the day; the full instant is on hover.
  time.textContent = monthDay.format(date)
  permalink.append(time)
  rail.append(permalink)
  if (memo.edited) rail.append(el("span", "memo-edited", "edited"))
  return rail
}

/** The node on the thread where a new year starts. */
export function renderYear(year: string) {
  const item = el("li", "memo-year")
  item.append(el("h2", "", year))
  return item
}

export function renderMemo(memo: Memo) {
  const item = el("li", "memo")
  const article = el("article")
  article.append(renderRail(memo))

  const main = el("div", "memo-main")
  const { grid, audio } = splitMedia(memo.media)
  const mediaNodes: Node[] = [
    ...(grid.length > 0 ? [renderMediaGrid(grid)] : []),
    ...audio.map(renderAudio),
  ]

  let content: HTMLElement | null = null
  if (memo.text) {
    content = el("prose-content", "memo-content")
    if (memo.language) content.setAttribute("lang", memo.language)
    content.append(toFragment(memo.html, memo.emojis))
  }

  if (memo.spoiler) {
    main.append(
      shroud(emojify(memo.spoiler, memo.emojis), [
        ...(content ? [content] : []),
        ...mediaNodes,
      ]),
    )
  } else {
    if (content) main.append(content)
    if (mediaNodes.length > 0) {
      main.append(
        ...(memo.sensitive
          ? [shroud([document.createTextNode("Sensitive media")], mediaNodes)]
          : mediaNodes),
      )
    }
  }

  article.append(main)
  item.append(article)
  return item
}
