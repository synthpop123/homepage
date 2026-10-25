/**
 * Devices section renderer: one card per reporting device, side by side,
 * in the same idiom as the quota cards above. Everything a device reports
 * is on the card at once, because a disclosure is one more thing a touch
 * device has to find; the rarer figures (longest stretch, peak
 * concurrency) ride in the `title` of the active-time cell they qualify.
 * Rendered per payload and again on the minute: Online and the report
 * age are relative to now.
 */

import { relativeTime } from "../feed"
import {
  formatCost,
  formatDuration,
  formatExact,
  formatShare,
  formatTokens,
  isOnline,
  type Site,
  type SiteDevice,
} from "../tokens"
import { splitFigure } from "../readout"
import { el, type Icons, type Query } from "./dom"

/** The active-time cell's tooltip: what the figure alone leaves out. */
const stretchNote = (device: SiteDevice) =>
  [
    device.longestMs
      ? `Longest stretch ${formatDuration(device.longestMs)}`
      : "",
    device.maxConcurrent && device.maxConcurrent > 1
      ? `peak ${device.maxConcurrent} concurrent sessions`
      : "",
  ]
    .filter((part) => part !== "")
    .join(", ")

/** "1.9B" as a number run and a smaller unit run, like the readouts,
 *  without their count-up: the card is rebuilt on every render. */
const figure = (text: string) => {
  const target = el("span", "dev-tokens")
  target.append(
    ...splitFigure(text).map((run) =>
      el("span", run.kind === "num" ? "num" : "unit", run.text),
    ),
  )
  return target
}

export function renderDevices(q: Query, site: Site, icons: Icons) {
  const list = q(".tk-devices")
  if (!list) return
  if (site.devices.length === 0) {
    list.replaceChildren(el("li", "tk-empty", "No devices reporting yet."))
    return
  }
  const total = site.devices.reduce((sum, device) => sum + device.tokens, 0)

  list.replaceChildren(
    ...site.devices.map((device) => {
      const online = isOnline(device.lastSeen, site.deviceOnlineWithinMs)
      const card = el("li", "tk-device")
      if (online) card.dataset.online = ""

      const mark = icons.icon(`device:${device.name}`) ?? icons.icon("device")
      if (mark) {
        mark.classList.add("dev-mark")
        mark.setAttribute("aria-hidden", "true")
        card.append(mark)
      }

      const status = el("span", "dev-status")
      status.append(
        el("span", "dot"),
        device.lastSeen === null
          ? "Never reported"
          : online
            ? "Online"
            : `Seen ${relativeTime(device.lastSeen)}`,
      )
      const head = el("div", "dev-head")
      head.append(status)

      const id = el("div", "dev-id")
      id.append(el("h3", "dev-name", device.name))

      const ratio = total > 0 ? device.tokens / total : 0
      const tokens = figure(formatTokens(device.tokens))
      tokens.title = `${formatExact(device.tokens)} tokens`
      const meter = el("span", "dev-meter")
      meter.style.setProperty("--share", `${(ratio * 100).toFixed(2)}%`)
      const share = el("div", "dev-share")
      share.append(
        tokens,
        meter,
        el("span", "dev-cap", `${formatShare(ratio)} of all tokens`),
      )

      const stats = el("dl", "dev-stats")
      const cells: [string, string, string?][] = [
        ["Cost", formatCost(device.cost)],
        ["Active days", formatExact(device.activeDays)],
        ["Sessions", device.sessions ? formatExact(device.sessions) : "—"],
        [
          "Active time",
          device.activeMs ? formatDuration(device.activeMs) : "—",
          stretchNote(device),
        ],
      ]
      for (const [label, value, note] of cells) {
        const pair = document.createElement("div")
        if (note) pair.title = note
        pair.append(el("dt", "", label), el("dd", "", value))
        stats.append(pair)
      }

      card.append(head, id, share, stats)
      return card
    }),
  )
}
