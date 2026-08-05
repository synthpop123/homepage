/**
 * Devices section renderer: the reporting-device inventory with liveness
 * dots, and the CLI metadata behind an expandable row. Rendered once per
 * load. The metadata used to live in a `title` tooltip, which is
 * unreachable on touch — a phone got the dot and nothing else.
 */

import {
  formatAgo,
  formatCost,
  formatDate,
  formatDuration,
  formatExact,
  formatTokens,
  isOnline,
  type Site,
  type SiteDevice,
} from "../tokens"
import { el, type Icons, type Query } from "./dom"

/** Metadata that has no column, as label/value pairs; empty when the
 *  device reported none of it (older CLIs, or a first submission). */
const detailsOf = (device: SiteDevice): [string, string][] =>
  (
    [
      ["Active time", device.activeMs ? formatDuration(device.activeMs) : ""],
      [
        "Longest stretch",
        device.longestMs ? formatDuration(device.longestMs) : "",
      ],
      [
        "Peak concurrency",
        device.maxConcurrent && device.maxConcurrent > 1
          ? `${device.maxConcurrent} sessions`
          : "",
      ],
      [
        "MCP servers",
        device.mcpServers?.length ? device.mcpServers.join(", ") : "",
      ],
      [
        "First seen",
        device.firstSeen
          ? formatDate(new Date(device.firstSeen).toISOString())
          : "",
      ],
    ] as [string, string][]
  ).filter(([, value]) => value !== "")

export function renderDevices(q: Query, site: Site, icons: Icons) {
  const list = q(".tk-devices")
  if (!list) return
  if (site.devices.length === 0) {
    list.replaceChildren(el("li", "tk-empty", "No devices reporting yet."))
    return
  }
  list.replaceChildren(
    ...site.devices.map((device) => {
      const item = el("li", "tk-device")
      const online = isOnline(device.lastSeen)
      const details = detailsOf(device)

      const dot = el("span", "dot")
      if (online) dot.dataset.online = ""
      dot.setAttribute("role", "img")
      dot.setAttribute("aria-label", online ? "Online" : "Offline")

      const id = el("span", "dev-id")
      const seen =
        device.lastSeen === null
          ? "never reported"
          : `${online ? "synced" : "last seen"} ${formatAgo(device.lastSeen)}`
      const facts = [
        seen,
        device.cliVersion ? `v${device.cliVersion}` : "",
        device.sessions ? `${formatExact(device.sessions)} sessions` : "",
      ].filter((part) => part !== "")
      id.append(
        el("span", "dev-name", device.name),
        el("span", "dev-seen", facts.join(" · ")),
      )

      const usage = el("span", "dev-usage")
      const tokens = el("span", "dev-tokens", formatTokens(device.tokens))
      tokens.title = `${formatExact(device.tokens)} tokens`
      usage.append(
        tokens,
        el(
          "span",
          "dev-meta",
          `${formatCost(device.cost)} · ${device.activeDays} active ${
            device.activeDays === 1 ? "day" : "days"
          }`,
        ),
      )

      // Nothing to expand into means nothing to click: a device without
      // metadata stays a plain row rather than an empty disclosure.
      if (details.length === 0) {
        const row = el("div", "dev-row")
        row.append(dot, id, usage)
        item.append(row)
        return item
      }

      const button = document.createElement("button")
      button.type = "button"
      button.className = "dev-row"
      button.setAttribute("aria-expanded", "false")
      const chevron = icons.icon("chevron")
      button.append(dot, id, usage)
      if (chevron) {
        chevron.setAttribute("aria-hidden", "true")
        button.append(chevron)
      }

      const table = el("dl", "dev-details")
      table.hidden = true
      for (const [label, value] of details) {
        const pair = document.createElement("div")
        pair.append(el("dt", "", label), el("dd", "", value))
        table.append(pair)
      }
      button.addEventListener("click", () => {
        const open = button.getAttribute("aria-expanded") === "true"
        button.setAttribute("aria-expanded", String(!open))
        table.hidden = open
      })

      item.append(button, table)
      return item
    }),
  )
}
