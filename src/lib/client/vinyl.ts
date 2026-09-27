/**
 * The record on a sleeve (`.sleeve`, feed.css) turns on an infinite CSS
 * animation; off screen it would keep costing frames nobody sees, so it
 * pauses there. Reduced motion is the stylesheet's to honour (reset.css
 * stops it outright).
 */
export function pauseOffscreen(): IntersectionObserver {
  return new IntersectionObserver((entries) => {
    for (const entry of entries)
      entry.target.toggleAttribute("data-offscreen", !entry.isIntersecting)
  })
}
