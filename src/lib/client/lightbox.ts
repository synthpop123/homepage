/**
 * Click-to-zoom for content images, backed by PhotoSwipe. This eager
 * module is only the trigger: a click delegate that decides what is
 * zoomable and assembles the slide data. PhotoSwipe itself (JS + CSS)
 * code-splits into a chunk fetched on first use, so pages pay nothing
 * up front. Styles for the zoom-in cursor and the per-page mount live
 * in Lightbox.astro.
 *
 * Zoomable: bare content images (`prose-content img`, minus the
 * inline custom emoji), post banners, and the /memos media cards —
 * whose wrapping permalink (the full-size original) keeps working
 * without JS and for modified clicks. A multi-image memo opens as one
 * swipeable gallery.
 *
 * Keyboard: a memo card is a link, so Enter on it opens the gallery
 * like a click. A bare image has no control of its own, so the mount
 * makes each one a button (focusable, Enter or Space) — only once the
 * script that answers it is running. PhotoSwipe traps focus while open,
 * closes on Escape and hands focus back to the thumbnail.
 */

import type { SlideData } from "photoswipe"
import stylesheetUrl from "photoswipe/style.css?url"

let busy = false

/**
 * PhotoSwipe's stylesheet, linked on first open. A dynamic import of the
 * CSS would not stay lazy: the bundler hoists it into a render-blocking
 * <link> on every page that mounts the lightbox. A failed load is
 * forgotten, so the next click tries again.
 */
let stylesheet: Promise<void> | undefined
const loadStylesheet = () =>
  (stylesheet ??= new Promise<void>((resolve, reject) => {
    const link = document.createElement("link")
    link.rel = "stylesheet"
    link.href = stylesheetUrl
    link.onload = () => resolve()
    link.onerror = () => {
      link.remove()
      stylesheet = undefined
      reject(new Error("PhotoSwipe stylesheet failed to load"))
    }
    document.head.append(link)
  }))

/** Largest srcset candidate, falling back to the rendered source. */
function largestSrc(img: HTMLImageElement): string {
  let best = ""
  let bestWidth = 0
  for (const candidate of img.srcset.split(",")) {
    const [url, descriptor] = candidate.trim().split(/\s+/)
    const width = descriptor?.endsWith("w") ? Number.parseFloat(descriptor) : 0
    if (url && width > bestWidth) {
      bestWidth = width
      best = url
    }
  }
  return best || img.currentSrc || img.src
}

/** Slide data for one thumbnail; `msrc` shows instantly as the
 *  placeholder while the full-size file loads. */
function slideFor(img: HTMLImageElement, src: string): SlideData {
  return {
    src,
    width: Number(img.getAttribute("width")) || img.naturalWidth,
    height: Number(img.getAttribute("height")) || img.naturalHeight,
    alt: img.alt,
    msrc: img.currentSrc || img.src,
  }
}

async function openGallery(
  thumbs: HTMLImageElement[],
  slides: SlideData[],
  index: number,
) {
  busy = true
  try {
    const [{ default: PhotoSwipe }] = await Promise.all([
      import("photoswipe"),
      loadStylesheet(),
    ])
    const single = slides.length === 1
    const pswp = new PhotoSwipe({
      dataSource: slides,
      index,
      loop: false,
      arrowPrev: !single,
      arrowNext: !single,
      counter: !single,
    })
    // Zoom the open/close animation from the clicked thumbnail.
    pswp.addFilter("thumbEl", (el, _data, i) => thumbs[i] ?? el)
    pswp.addFilter(
      "placeholderSrc",
      (src, slide) => thumbs[slide.index]?.currentSrc ?? src,
    )
    pswp.on("destroy", () => {
      busy = false
    })
    pswp.init()
  } catch {
    // Chunk failed to load (offline?) — allow the next click to retry.
    busy = false
  }
}

const BARE = "prose-content img:not(.emoji), post-banner img"

export function mountLightbox() {
  for (const img of document.querySelectorAll<HTMLImageElement>(BARE)) {
    if (img.closest("a")) continue
    img.tabIndex = 0
    img.setAttribute("role", "button")
    img.setAttribute("aria-haspopup", "dialog")
    if (!img.alt) img.setAttribute("aria-label", "Enlarge image")
  }

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return
    const img = event.target
    if (!(img instanceof HTMLImageElement) || !img.matches(BARE)) return
    if (img.closest("a")) return
    event.preventDefault()
    img.click()
  })

  document.addEventListener("click", (event) => {
    if (event.defaultPrevented || busy) return
    if (event.button !== 0) return
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return

    // Enter on a memo card clicks its link, not the image inside it.
    const target = event.target instanceof Element ? event.target : null
    const img =
      target?.closest("img") ??
      target?.closest(".memo-shot a")?.querySelector("img")
    if (!(img instanceof HTMLImageElement)) return
    if (!img.complete || img.naturalWidth === 0) return

    const anchor = img.closest("a")
    if (anchor) {
      // Only the memo media permalinks are hijacked; other linked
      // images keep their navigation.
      if (!anchor.matches(".memo-shot a")) return
      const group = img.closest(".memo-media")
      const links = group
        ? [...group.querySelectorAll<HTMLAnchorElement>(".memo-shot a")]
        : [anchor]
      const thumbs: HTMLImageElement[] = []
      const slides: SlideData[] = []
      for (const link of links) {
        const thumb = link.querySelector("img")
        if (thumb) {
          thumbs.push(thumb)
          slides.push(slideFor(thumb, link.href))
        }
      }
      if (slides.length === 0) return
      event.preventDefault()
      openGallery(thumbs, slides, Math.max(0, thumbs.indexOf(img)))
    } else if (img.matches(BARE)) {
      openGallery([img], [slideFor(img, largestSrc(img))], 0)
    }
  })
}
