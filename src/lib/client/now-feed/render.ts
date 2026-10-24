/**
 * The Now bento's tile renderers. Each fills its tile in place from a
 * payload, replacing what it touches, so a cached paint, a refresh and a
 * once-a-minute repaint all go through the same code. Every string they
 * print comes from the DOM-free `now.ts`.
 */

import { el } from "@/lib/client/dom"
import {
  dateFormatter,
  dayInstant,
  relativeTime,
  TIME_ZONE,
} from "@/lib/client/feed"
import { isPlaying } from "@/lib/client/music"
import {
  PORTFOLIO_RANGE,
  portfolioView,
  type Site,
  tokenBars,
  tokensFoot,
  tokensLabel,
  watchedLabel,
} from "@/lib/client/now"
import { setReadout } from "@/lib/client/readout"
import { formatTokens } from "@/lib/client/tokens/format"

const SVG = "http://www.w3.org/2000/svg"

const exact = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: TIME_ZONE,
})

/** A time element whose text is relative and whose title is exact. */
const setTime = (time: HTMLTimeElement, at: string, text: string) => {
  time.dateTime = at
  time.textContent = text
  time.title = exact.format(new Date(at))
}

/** Swap an image only when its source moved, so a repaint with the
 *  same payload never flashes the artwork. */
const setImage = (img: HTMLImageElement | null, src: string | null) => {
  if (!img) return
  img.hidden = !src
  if (!src) img.removeAttribute("src")
  else if (img.getAttribute("src") !== src) img.src = src
}

const text = (tile: HTMLElement, selector: string, value: string) => {
  tile.querySelector(selector)?.replaceChildren(value)
}

/**
 * A tile with nothing to show. It may have shown something a moment
 * ago, so everything a full render sets goes back: the link, the art,
 * the playing mark and, where given, the label.
 */
const empty = (tile: HTMLElement, what: string, label?: string) => {
  tile.dataset.empty = ""
  tile.removeAttribute("data-playing")
  const link = tile.querySelector("a")
  link?.removeAttribute("href")
  link?.removeAttribute("title")
  for (const img of tile.querySelectorAll("img")) setImage(img, null)
  if (label) text(tile, ".now-label", label)
  tile.querySelector(".now-title, .now-figure")?.replaceChildren(what)
  tile.querySelector(".now-figure")?.removeAttribute("data-dir")
  for (const extra of tile.querySelectorAll(
    ".now-sub, .now-foot, .now-bars, .now-spark, .now-strip, .now-axis",
  ))
    extra.replaceChildren()
}

export function renderListen(tile: HTMLElement, site: Site, now: number) {
  const listen = site.listen
  if (!listen) return empty(tile, "Nothing yet", "Listening")
  delete tile.dataset.empty
  const link = tile.querySelector("a")!
  link.href = listen.url
  // The cover, and the record's label printed with the same art.
  setImage(
    tile.querySelector(".cover img"),
    listen.cover.medium ?? listen.cover.small,
  )
  setImage(
    tile.querySelector(".disc-label img"),
    listen.cover.small ?? listen.cover.medium,
  )
  const playing = isPlaying(listen.at, now)
  tile.toggleAttribute("data-playing", playing)
  text(tile, ".now-label", playing ? "Now playing" : "Listening")
  text(tile, ".now-title", listen.title)
  text(tile, ".now-sub", listen.artists.join(", "))
  const time = el("time") as HTMLTimeElement
  setTime(time, listen.at, relativeTime(listen.at, now))
  tile.querySelector(".now-foot")?.replaceChildren(time)
}

export function renderFilm(tile: HTMLElement, site: Site, today: string) {
  const film = site.film
  if (!film) return empty(tile, "Nothing yet", "Watched")
  delete tile.dataset.empty
  tile.querySelector("a")!.href = film.url
  setImage(tile.querySelector("img"), film.poster)
  text(tile, ".now-label", film.rewatch ? "Rewatched" : "Watched")
  const title = el("span", undefined, film.title)
  if (film.year) title.append(" ", el("span", "now-year", String(film.year)))
  tile.querySelector(".now-title")?.replaceChildren(title)

  const foot: Node[] = []
  if (film.rating !== null) {
    const rating = el("span", "now-rating")
    rating.style.setProperty("--score", String(film.rating))
    rating.setAttribute("role", "img")
    rating.setAttribute("aria-label", `${film.rating} out of 5 stars`)
    rating.append(el("span"))
    foot.push(rating)
  }
  const time = el(
    "time",
    undefined,
    watchedLabel(film.watched, today),
  ) as HTMLTimeElement
  time.dateTime = film.watched
  time.title = dateFormatter.format(dayInstant(film.watched))
  foot.push(time)
  tile.querySelector(".now-foot")?.replaceChildren(...foot)
}

/** Runs as spans: a narrow tile wraps between them, never inside one. */
const runs = (tile: HTMLElement, values: string[]) =>
  tile
    .querySelector(".now-foot")
    ?.replaceChildren(...values.map((run) => el("span", undefined, run)))

export function renderTokens(tile: HTMLElement, site: Site, today: string) {
  text(tile, ".now-label", tokensLabel(site.today, today))
  const tokens = site.tokens
  if (!tokens) return empty(tile, "—")
  delete tile.dataset.empty
  tile.querySelector("a")?.setAttribute("href", "/tokens")
  const figure = tile.querySelector<HTMLElement>(".now-figure")
  if (figure) setReadout(figure, formatTokens(tokens.tokens))
  runs(tile, tokensFoot(tokens))
  tile.querySelector(".now-bars")?.replaceChildren(
    ...tokenBars(tokens.recent, site.today).map(({ height, title }) => {
      const bar = el("i")
      bar.style.setProperty("--bar", String(height))
      bar.title = title
      return bar
    }),
  )
}

const svg = (name: string, attrs: Record<string, string>) => {
  const node = document.createElementNS(SVG, name)
  for (const [key, value] of Object.entries(attrs))
    node.setAttribute(key, value)
  return node
}

export function renderPortfolio(tile: HTMLElement, site: Site) {
  const portfolio = site.portfolio
  if (!portfolio) return empty(tile, "—")
  delete tile.dataset.empty
  const view = portfolioView(portfolio)
  const link = tile.querySelector("a")!
  link.setAttribute("href", "/misc#portfolio")
  link.title = view.title
  text(tile, ".now-label", `Portfolio · ${PORTFOLIO_RANGE}`)
  const figure = tile.querySelector<HTMLElement>(".now-figure")
  if (figure) {
    figure.dataset.dir = view.dir
    setReadout(figure, view.figure)
  }
  runs(tile, view.foot)

  tile.querySelector(".now-spark")?.replaceChildren(
    svg("polygon", { class: "now-area", points: view.area }),
    svg("line", {
      class: "now-base",
      x1: "0",
      x2: "100",
      y1: String(view.base),
      y2: String(view.base),
    }),
    svg("polyline", { class: "now-ghost", points: view.ghost }),
    svg("polyline", { class: "now-line", points: view.line }),
  )
  const dot = tile.querySelector<HTMLElement>(".now-dot")
  if (dot) {
    dot.style.setProperty("--end", `${view.end}%`)
    dot.dataset.dir = view.dir
  }
  tile.querySelector(".now-strip")?.replaceChildren(
    ...view.cells.map(({ dir, level, title }) => {
      const cell = el("i")
      cell.dataset.dir = dir
      cell.dataset.level = String(level)
      cell.title = title
      return cell
    }),
  )
  const keys = el("span", "now-keys")
  keys.append(
    el("span", "now-key", "Portfolio"),
    el("span", "now-key now-key-ghost", "S&P 500"),
  )
  tile
    .querySelector(".now-axis")
    ?.replaceChildren(
      el("span", undefined, view.from),
      keys,
      el("span", undefined, view.to),
    )
}
