/**
 * The Music section's pieces: the all-time readout, the heatmap's level
 * scale, and one row of the last-played list.
 */

import { el } from "@/lib/client/dom"
import {
  dayInstant,
  monthDay,
  relativeTime,
  TIME_ZONE,
} from "@/lib/client/feed"
import { mountHeatmap } from "@/lib/client/heatmap"
import {
  formatPlays,
  isPlaying,
  type Site,
  type SiteListen,
  STAT_KEYS,
} from "@/lib/client/music"
import { setReadout } from "@/lib/client/readout"

const numberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
})
const timeFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: TIME_ZONE,
})

export const fillStats = (feed: HTMLElement, stats: Site["stats"]) => {
  feed.querySelectorAll<HTMLElement>(".stat").forEach((stat) => {
    const key = STAT_KEYS.find((name) => name === stat.dataset.key)
    const target = stat.querySelector<HTMLElement>(".value")
    if (key && target) setReadout(target, numberFormatter.format(stats[key]))
  })
}

export const buildHeatmap = (feed: HTMLElement, activity: Site["activity"]) => {
  const grid = feed.querySelector<HTMLElement>(".heat-grid")
  if (!grid || activity.length === 0) throw new Error("No activity data")

  mountHeatmap(grid, activity, (shown) => {
    // Linear scale over the visible window, so narrow viewports keep
    // their contrast instead of inheriting a year-wide maximum.
    const max = Math.max(...shown.map((day) => day.plays), 1)
    return shown.map((day) => ({
      level:
        day.plays === 0 ? 0 : Math.max(1, Math.ceil((day.plays / max) * 4)),
      title: `${formatPlays(day.plays)} on ${monthDay.format(dayInstant(day.date))}`,
    }))
  })
}

/**
 * One listen. The first row of the list is the lead: the same markup
 * plus a record sliding out of the sleeve, its label printed with the
 * cover art, which turns while the row is hovered.
 */
export const buildRow = (listen: SiteListen, lead: boolean) => {
  const row = el("li", "music-item")

  const link = el("a", "music-link") as HTMLAnchorElement
  link.href = listen.url
  link.target = "_blank"
  link.rel = "noopener noreferrer"

  const src = lead
    ? (listen.cover.medium ?? listen.cover.small)
    : listen.cover.small
  const art = (alt: string, size: number) => {
    const img = document.createElement("img")
    img.src = src ?? ""
    img.alt = alt
    img.loading = "lazy"
    img.decoding = "async"
    img.width = size
    img.height = size
    return img
  }

  const cover = el("span", "cover")
  if (src) cover.append(art(`${listen.title} cover art`, lead ? 160 : 40))

  if (lead) {
    row.dataset.lead = ""
    if (isPlaying(listen.at)) row.dataset.recent = ""
    const disc = el("span", "disc")
    disc.setAttribute("aria-hidden", "true")
    const label = el("span", "disc-label")
    if (src) label.append(art("", 64))
    disc.append(label)
    const sleeve = el("span", "sleeve")
    sleeve.append(disc, cover)
    link.append(sleeve)
  } else {
    link.append(cover)
  }

  // Short enough to sit beside the artists on a half-width row without
  // either one being cut; the full instant is on hover.
  const when = el("time", "when", relativeTime(listen.at)) as HTMLTimeElement
  when.dateTime = listen.at
  when.title = timeFormatter.format(new Date(listen.at))

  const artists = el("span", "artists", listen.artists.join(", "))

  const meta = el("span", "meta")
  if (lead) {
    meta.append(when, el("span", "title", listen.title), artists)
  } else {
    const sub = el("span", "sub")
    sub.append(artists, when)
    meta.append(el("span", "title", listen.title), sub)
  }
  link.append(meta)

  row.append(link)
  return row
}

/**
 * Brings a rendered list's times up to now without rebuilding it (and
 * reloading its artwork): each "12m ago", and whether the lead record
 * still turns.
 */
export const refreshTimes = (list: HTMLElement) => {
  for (const when of list.querySelectorAll<HTMLTimeElement>("time.when")) {
    when.textContent = relativeTime(when.dateTime)
  }
  const lead = list.querySelector<HTMLElement>("[data-lead]")
  const at = lead?.querySelector<HTMLTimeElement>("time.when")?.dateTime
  if (lead && at) lead.toggleAttribute("data-recent", isPlaying(at))
}
