/**
 * The lists under the map: the routes flown, ranked, each row a bar of
 * its share of the most flown and a way to show it on the map; and the
 * airline and aircraft composition bars. Each shows its first few and
 * folds the rest behind a "Show N more" row, as the Tokens breakdowns do.
 */

import { el } from "@/lib/client/dom"
import {
  composition,
  flownRoutes,
  fold,
  type Site,
  type SiteCount,
  share,
} from "@/lib/client/flights"

const numberFormatter = new Intl.NumberFormat("en-US")

const plural = (n: number, word: string) =>
  `${numberFormatter.format(n)} ${word}${n === 1 ? "" : "s"}`

/**
 * One row per route flown, the first `named` of them unless `open`;
 * `data-route` is the route's place in `site.routes`.
 */
export function renderRoutes(
  list: HTMLOListElement,
  site: Site,
  named: number,
  open: boolean,
  toggle: () => void,
) {
  const flown = flownRoutes(site)
  const top = flown[0]?.flights ?? 0
  const city = (code: string) =>
    site.airports.find((airport) => airport.code === code)?.city ?? code
  const { named: shown, rest } = fold(flown, named)
  const rows = [...shown, ...(open ? rest : [])].map((route) => {
    const row = el("li", "route")
    const button = el("button", "route-hit")
    button.setAttribute("type", "button")
    button.dataset.route = String(site.routes.indexOf(route))
    button.setAttribute("aria-pressed", "false")
    button.setAttribute(
      "aria-label",
      `${city(route.from)} and ${city(route.to)}, ${plural(route.flights, "flight")}: show on the map`,
    )
    button.style.setProperty("--share", `${share(route.flights, top) * 100}%`)
    button.append(
      el("span", "route-code", `${route.from} ⇄ ${route.to}`),
      el("span", "route-name", `${city(route.from)} ⇄ ${city(route.to)}`),
      el("span", "route-count", numberFormatter.format(route.flights)),
    )
    row.append(button)
    return row
  })
  if (rest.length > 0) {
    const flights = rest.reduce((sum, route) => sum + route.flights, 0)
    rows.push(moreRow(rest.length, flights, open, toggle))
  }
  list.replaceChildren(...rows)
}

/** The route rows' pressed state, following the map's selection. */
export function markRoute(list: HTMLOListElement, index: number | null) {
  for (const button of list.querySelectorAll<HTMLElement>("[data-route]"))
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.route === String(index)),
    )
}

/** Shades of the section's accent for the named rows, then the rest. */
const SHADES = [100, 72, 52, 36]
const REST_SHADE = 16

const chevron = () => {
  const ns = "http://www.w3.org/2000/svg"
  const icon = document.createElementNS(ns, "svg")
  icon.setAttribute("viewBox", "0 0 24 24")
  icon.setAttribute("aria-hidden", "true")
  const path = document.createElementNS(ns, "path")
  path.setAttribute("d", "m6 9 6 6 6-6")
  icon.append(path)
  return icon
}

/** The fold row: `Show 6 more` and the flights behind it, or `Show less`. */
function moreRow(
  count: number,
  flights: number,
  open: boolean,
  toggle: () => void,
) {
  const row = el("li", "comp-more")
  const button = el("button", "comp-more-btn")
  button.setAttribute("type", "button")
  button.setAttribute("aria-expanded", String(open))
  button.append(
    chevron(),
    el("span", "comp-more-label", open ? "Show less" : `Show ${count} more`),
  )
  if (!open)
    button.append(el("span", "comp-n", numberFormatter.format(flights)))
  button.addEventListener("click", toggle)
  row.append(button)
  return row
}

/**
 * A composition bar and its legend. `open` is whether the rest is shown;
 * `toggle` flips it and asks for a render, so the state outlives a data
 * refresh the way the Tokens lists' does.
 */
export function renderComposition(
  block: HTMLElement,
  tally: SiteCount[],
  named: number,
  noun: string,
  open: boolean,
  toggle: () => void,
) {
  const { named: shown, rest, restFlights } = composition(tally, named)
  const total = tally.reduce((sum, item) => sum + item.flights, 0)
  const count = block.querySelector<HTMLElement>(".comp-count")
  if (count) count.textContent = plural(shown.length + rest.length, noun)

  type Part = { name: string; flights: number; shade: number; title: string }
  const part = (item: SiteCount, shade: number): Part => ({
    name: item.name,
    flights: item.flights,
    shade,
    title: `${item.name}${item.code ? ` (${item.code})` : ""}: ${plural(item.flights, "flight")}`,
  })
  const parts: Part[] = [
    ...shown.map((item, i) => part(item, SHADES[i] ?? REST_SHADE)),
    ...(open
      ? rest.map((item) => part(item, REST_SHADE))
      : rest.length > 0
        ? [
            {
              name: "",
              flights: restFlights,
              shade: REST_SHADE,
              title: `${plural(rest.length, noun)} more: ${plural(restFlights, "flight")}`,
            },
          ]
        : []),
  ]

  const bar = block.querySelector<HTMLElement>(".comp-bar")
  bar?.replaceChildren(
    ...parts.map((p) => {
      const segment = el("span")
      segment.style.flexGrow = String(p.flights)
      segment.style.setProperty("--shade", `${p.shade}%`)
      segment.title = p.title
      return segment
    }),
  )
  bar?.setAttribute(
    "aria-label",
    `${plural(total, "flight")} across ${plural(tally.length, noun)}`,
  )

  const rows = parts
    .filter((p) => p.name !== "")
    .map((p) => {
      const row = el("li", "comp-row")
      const swatch = el("i")
      swatch.style.setProperty("--shade", `${p.shade}%`)
      row.title = p.title
      row.append(
        swatch,
        el("span", "comp-name", p.name),
        el("span", "comp-n", numberFormatter.format(p.flights)),
      )
      return row
    })
  if (rest.length > 0)
    rows.push(moreRow(rest.length, restFlights, open, toggle))
  block.querySelector("ul")?.replaceChildren(...rows)
}
