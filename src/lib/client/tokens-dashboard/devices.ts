/**
 * Devices section renderer: the reporting-device inventory with
 * liveness dots and CLI metadata, rendered once per load.
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
} from "../tokens"
import { el, type Query } from "./dom"

export function renderDevices(q: Query, site: Site) {
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

      // Depth that doesn't fit the row lives in the tooltip.
      const details = [
        device.activeMs
          ? `${formatDuration(device.activeMs)} active in total`
          : "",
        device.longestMs
          ? `longest stretch ${formatDuration(device.longestMs)}`
          : "",
        device.maxConcurrent && device.maxConcurrent > 1
          ? `up to ${device.maxConcurrent} concurrent sessions`
          : "",
        device.mcpServers?.length ? `MCP: ${device.mcpServers.join(", ")}` : "",
        device.firstSeen
          ? `first seen ${formatDate(new Date(device.firstSeen).toISOString())}`
          : "",
      ].filter((part) => part !== "")
      if (details.length > 0) item.title = details.join(" · ")

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
      const meta = [
        formatCost(device.cost),
        `${device.activeDays} active ${device.activeDays === 1 ? "day" : "days"}`,
      ].filter((part) => part !== "")
      usage.append(tokens, el("span", "dev-meta", meta.join(" · ")))

      item.append(dot, id, usage)
      return item
    }),
  )
}
