/**
 * Mounts every `<flights-feed>`: loads the Flights section of /misc
 * stale-while-revalidate and renders it: the readout, the route map, the
 * strip under it naming the route in focus, the ranked routes and the
 * two composition bars. Pointing at a route (on the map or in the list),
 * or focusing its row, puts it in focus; the most flown one is in focus
 * until then.
 */

import { FLIGHTS } from "@/consts"
import {
  formatDuration,
  loadSite,
  type Site,
  statCards,
} from "@/lib/client/flights"
import { setReadout } from "@/lib/client/readout"
import { markRoute, renderComposition, renderRoutes } from "./lists"
import { createRouteMap } from "./map"

const numberFormatter = new Intl.NumberFormat("en-US")
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)")

function mount(feed: HTMLElement) {
  const endpoint = feed.dataset.endpoint
  const stage = feed.querySelector<HTMLElement>(".flights-map")
  const strip = feed.querySelector<HTMLElement>(".flights-strip")
  const routeList = feed.querySelector<HTMLOListElement>(".flights-routes ol")
  const airlines = feed.querySelector<HTMLElement>('[data-tally="airlines"]')
  const aircraft = feed.querySelector<HTMLElement>('[data-tally="aircraft"]')
  const body = feed.querySelector<HTMLElement>(".flights-body")
  const fallback = feed.querySelector<HTMLElement>(".flights-fallback")
  const region = feed.dataset.basemap
  const world = feed.dataset.world
  if (
    !endpoint ||
    !stage ||
    !strip ||
    !routeList ||
    !airlines ||
    !aircraft ||
    !body ||
    !region ||
    !world
  )
    return

  let site: Site | null = null
  let rendered = ""
  let focus: number | null = null
  const open = new Set<string>()

  const map = createRouteMap(stage, { region, world }, (index) => pick(index))

  const part = (name: string) =>
    strip.querySelector<HTMLElement>(`[data-part="${name}"]`)!

  /** Puts a route in focus: on the map, in the list and in the strip. */
  const pick = (index: number) => {
    if (!site || index === focus) return
    focus = index
    const route = site.routes[index]
    const airport = (code: string) =>
      site?.airports.find((a) => a.code === code)
    map.select(index, !reducedMotion.matches)
    markRoute(routeList, index)
    part("from").textContent = route.from
    part("to").textContent = route.to
    part("from-name").textContent = airport(route.from)?.name ?? ""
    part("to-name").textContent = airport(route.to)?.name ?? ""
    part("km").textContent = `${numberFormatter.format(route.km)} km`
    part("detail").textContent = [
      route.minutes === null ? "" : `${formatDuration(route.minutes)} avg`,
      route.flights > 0
        ? `${route.flights}× flown`
        : `${route.upcoming} upcoming`,
    ]
      .filter(Boolean)
      .join(" · ")
    // Replay the line's fill toward the arrival end.
    const line = part("line")
    line.removeAttribute("data-drawn")
    void line.offsetWidth
    line.setAttribute("data-drawn", "")
  }

  /** Flips a list's fold, renders it again, and keeps focus on its toggle. */
  const toggler =
    (key: string, render: () => void, scope: HTMLElement) => () => {
      if (open.has(key)) open.delete(key)
      else open.add(key)
      render()
      scope.querySelector<HTMLElement>(".comp-more-btn")?.focus()
    }

  const renderRouteList = () => {
    if (!site) return
    renderRoutes(
      routeList,
      site,
      FLIGHTS.routes,
      open.has("routes"),
      toggler("routes", renderRouteList, routeList),
    )
    markRoute(routeList, focus)
  }

  const renderTallies = () => {
    if (!site) return
    for (const [block, tally, noun] of [
      [airlines, site.airlines, "airline"],
      [aircraft, site.aircraft, "aircraft type"],
    ] as const) {
      const key = block.dataset.tally ?? ""
      renderComposition(
        block,
        tally,
        FLIGHTS.named,
        noun,
        open.has(key),
        toggler(key, renderTallies, block),
      )
    }
  }

  routeList.addEventListener("pointerover", (event) => {
    if (event.pointerType !== "mouse") return
    const row = (event.target as Element).closest<HTMLElement>("[data-route]")
    if (row) pick(Number(row.dataset.route))
  })
  routeList.addEventListener("focusin", (event) => {
    const row = (event.target as Element).closest<HTMLElement>("[data-route]")
    if (row) pick(Number(row.dataset.route))
  })
  routeList.addEventListener("click", (event) => {
    const row = (event.target as Element).closest<HTMLElement>("[data-route]")
    if (row) pick(Number(row.dataset.route))
  })

  let frame = 0
  new ResizeObserver(() => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      if (site) map.draw(site).catch(() => {})
    })
  }).observe(stage)

  loadSite(endpoint, (next) => {
    if (next.routes.length === 0) throw new Error("No routes")
    const signature = JSON.stringify(next)
    if (signature === rendered) return
    rendered = signature
    site = next

    const cards = statCards(next)
    feed.querySelectorAll<HTMLElement>(".readout > div").forEach((cell, i) => {
      const card = cards[i]
      const value = cell.querySelector<HTMLElement>(".value")
      const foot = cell.querySelector<HTMLElement>(".foot")
      if (!card || !value || !foot) return
      cell.querySelector("dt")!.textContent = card.label
      setReadout(value, card.value)
      foot.textContent = card.foot
    })
    renderRouteList()
    renderTallies()
    const start = focus ?? 0
    focus = null
    pick(Math.min(start, next.routes.length - 1))
    // A base map that fails to load leaves the map blank, not the section.
    map.draw(next).catch(() => stage.setAttribute("data-failed", ""))
    feed.setAttribute("aria-busy", "false")
  }).catch(() => {
    body.hidden = true
    if (fallback) fallback.hidden = false
    feed.setAttribute("aria-busy", "false")
  })
}

document.querySelectorAll<HTMLElement>("flights-feed").forEach(mount)
