/**
 * Minimal PhotoSwipe-style image zoom, dependency-free. One reusable
 * <dialog> per page; clicking a zoomable image FLIP-animates it from
 * its place in the text to the viewport center, click anywhere or Esc
 * flies it back. The dialog starts from the thumbnail's already-cached
 * bitmap and swaps in the largest available source once it loads.
 * Styles and the per-page mount live in Lightbox.astro.
 *
 * Zoomable: bare content images (`prose-content img`, minus the inline
 * custom emoji), post banners, and the /memos media cards — whose
 * wrapping permalink (the full-size original) keeps working without
 * JS and for modified clicks.
 */

let dialog: HTMLDialogElement | null = null
let big: HTMLImageElement | null = null
let current: HTMLImageElement | null = null
let closing = false

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

function ensureDialog(): HTMLDialogElement {
  if (dialog) return dialog
  dialog = document.createElement("dialog")
  dialog.className = "lightbox"
  big = document.createElement("img")
  dialog.append(big)

  dialog.addEventListener("click", requestClose)
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault()
    requestClose()
  })
  // Safety net for any close that bypasses the animation path (e.g. a
  // browser force-closing the top layer on repeated Esc).
  dialog.addEventListener("close", () => {
    if (current) current.style.visibility = ""
    current = null
    closing = false
    if (big) {
      big.style.transition = "none"
      big.style.transform = ""
    }
    dialog?.classList.remove("is-open")
  })

  document.body.append(dialog)
  return dialog
}

/** translate+scale mapping the dialog image onto the thumbnail. */
function invert(thumb: HTMLImageElement, target: HTMLImageElement): string {
  const from = thumb.getBoundingClientRect()
  const to = target.getBoundingClientRect()
  if (!from.width || !to.width) return "none"
  const scale = from.width / to.width
  return `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${scale})`
}

function open(thumb: HTMLImageElement, fullHref: string | null) {
  if (closing) return
  const host = ensureDialog()
  if (host.open || !big) return

  // Attribute dimensions carry the full image's size (set by the feeds
  // and the image service), which lets the dialog lay out correctly
  // before the hi-res file arrives.
  big.width = Number(thumb.getAttribute("width")) || thumb.naturalWidth
  big.height = Number(thumb.getAttribute("height")) || thumb.naturalHeight
  big.src = thumb.currentSrc || thumb.src
  big.alt = thumb.alt
  host.setAttribute("aria-label", thumb.alt || "Enlarged image")

  const full = fullHref ?? largestSrc(thumb)
  if (full && full !== big.src) {
    const hi = new Image()
    hi.onload = () => {
      if (current === thumb && big) big.src = full
    }
    hi.src = full
  }

  host.showModal()
  current = thumb
  // FLIP: commit the inverted transform without transitioning, then
  // release it so the image flies from the thumbnail into place.
  big.style.transition = "none"
  big.style.transform = invert(thumb, big)
  thumb.style.visibility = "hidden"
  void big.offsetWidth
  big.style.transition = ""
  requestAnimationFrame(() => {
    host.classList.add("is-open")
    if (big) big.style.transform = ""
  })
}

function requestClose() {
  if (!dialog?.open || closing || !current || !big) return
  closing = true
  const target = big
  dialog.classList.remove("is-open")
  target.style.transform = invert(current, target)

  let finished = false
  const finish = () => {
    if (finished) return
    finished = true
    dialog?.close()
  }
  target.addEventListener("transitionend", finish, { once: true })
  setTimeout(finish, 400)
}

export function mountLightbox() {
  document.addEventListener("click", (event) => {
    if (event.defaultPrevented) return
    if (event.button !== 0) return
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return

    const target = event.target instanceof Element ? event.target : null
    const img = target?.closest("img")
    if (!(img instanceof HTMLImageElement)) return
    if (dialog?.contains(img)) return
    if (!img.complete || img.naturalWidth === 0) return

    const anchor = img.closest("a")
    if (anchor) {
      // Only the memo media permalinks are hijacked; other linked
      // images keep their navigation.
      if (!anchor.matches(".memo-shot a")) return
      event.preventDefault()
      open(img, anchor.href)
    } else if (img.matches("prose-content img:not(.emoji), post-banner img")) {
      open(img, null)
    }
  })
}
