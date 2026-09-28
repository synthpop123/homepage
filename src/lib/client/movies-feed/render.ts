/**
 * One poster in the Movies wall. The artwork carries the card, the title
 * and its year sit under it, and the line under that pairs the rating
 * with the day it was watched. A rewatch is a tag on the poster's corner,
 * since it qualifies the film rather than the date.
 */

import { el } from "@/lib/client/dom"
import { dateFormatter, dayInstant, monthDay } from "@/lib/client/feed"
import type { SiteFilm } from "@/lib/client/movies"

export const buildCard = (film: SiteFilm) => {
  const card = el("li", "movie-card")
  const link = el("a", "movie-link") as HTMLAnchorElement
  link.href = film.url
  link.target = "_blank"
  link.rel = "noopener noreferrer"

  const poster = el("span", "poster")
  if (film.poster) {
    const img = document.createElement("img")
    img.src = film.poster
    img.alt = `${film.title} poster`
    img.loading = "lazy"
    img.decoding = "async"
    img.width = 150
    img.height = 225
    poster.append(img)
  }
  if (film.rewatch) poster.append(el("span", "rewatch", "Rewatch"))
  link.append(poster)

  const title = el("span", "title", film.title)
  if (film.year) title.append(" ", el("span", "year", String(film.year)))

  const foot = el("span", "foot")
  if (film.rating !== null) {
    const rating = el("span", "rating")
    rating.style.setProperty("--score", String(film.rating))
    rating.setAttribute("role", "img")
    rating.setAttribute("aria-label", `${film.rating} out of 5 stars`)
    rating.append(el("span"))
    foot.append(rating)
  }
  // The wall is recent by construction, so the year is noise on the
  // card; the full date is on hover.
  const watched = dayInstant(film.watched)
  const time = el("time", "date", monthDay.format(watched)) as HTMLTimeElement
  time.dateTime = film.watched
  time.title = dateFormatter.format(watched)
  foot.append(time)

  const meta = el("span", "meta")
  meta.append(title, foot)
  link.append(meta)
  card.append(link)
  return card
}
