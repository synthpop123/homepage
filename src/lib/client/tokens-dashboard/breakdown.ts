/**
 * Breakdown section renderer: the top models / clients / providers
 * lists with proportional row fills, usage-span tooltips, the
 * per-row model disclosures, and the show-more toggle. A factory,
 * because the expanded/collapsed state must survive re-renders when the
 * range or metric changes.
 */

import {
  aiIcon,
  clientLabel,
  formatCostExact,
  formatDate,
  formatExact,
  formatMetric,
  type MetricKey,
  type ModelCell,
  modelLabel,
  providerLabel,
  type RangeKey,
  type Site,
  type Usage,
  type UsageSpan,
} from "../tokens"
import {
  el,
  expandableRow,
  type Icons,
  modelSubRows,
  type Query,
  usageRow,
} from "./dom"

const TOP_ROWS = 8

type BreakdownKind = "model" | "client" | "provider"

export function createBreakdown(q: Query, icons: Icons) {
  /** Lists the visitor has expanded past the top rows. */
  const expanded = new Set<BreakdownKind>()
  /** Rows opened onto their models, as `kind:id` — the id spaces overlap
   *  (Cursor is both a client and a provider). Survives a re-render. */
  const openRows = new Set<string>()
  let last: { site: Site; range: RangeKey; metric: MetricKey } | null = null

  const render = (site: Site, range: RangeKey, metric: MetricKey) => {
    last = { site, range, metric }
    const stats = site.ranges[range]

    const groups: {
      key: BreakdownKind
      rows: {
        id: string
        name: string
        usage: Usage & UsageSpan
        /** Canonical providers a model was served through. */
        via?: string[]
        /** The models behind a client or provider row — the disclosure's
         *  contents. Model rows have no split of their own. */
        models?: ModelCell[]
      }[]
    }[] = [
      {
        key: "model",
        rows: stats.byModel.map((entry) => ({
          id: entry.model,
          name: modelLabel(entry.model),
          usage: entry,
          via: entry.providers,
        })),
      },
      {
        key: "client",
        rows: stats.byClient.map((entry) => ({
          id: entry.client,
          name: clientLabel(entry.client),
          usage: entry,
          models: entry.models,
        })),
      },
      {
        key: "provider",
        rows: stats.byProvider.map((entry) => ({
          id: entry.provider,
          name: providerLabel(entry.provider),
          usage: entry,
          models: entry.models,
        })),
      },
    ]

    for (const group of groups) {
      const list = q(`.tk-rows[data-list="${group.key}"]`)
      if (!list) continue
      const total = stats.totals[metric]
      const live = group.rows
        .filter((row) => row.usage[metric] > 0)
        .sort((a, b) => b.usage[metric] - a.usage[metric])
      const isOpen = expanded.has(group.key)
      const shown = isOpen ? live : live.slice(0, TOP_ROWS)
      const rest = live.slice(TOP_ROWS)

      const items = shown.map((row) => {
        // Row depth that has no column: exact numbers, unit cost, span.
        const parts = [
          `${formatExact(row.usage.tokens)} tokens`,
          formatCostExact(row.usage.cost),
          `${formatExact(row.usage.messages)} messages`,
        ]
        if (row.usage.tokens > 0 && row.usage.cost > 0) {
          parts.push(
            `${formatCostExact(row.usage.cost / (row.usage.tokens / 1e6))} per 1M`,
          )
        }
        if (row.usage.days > 0) {
          parts.push(
            `used ${row.usage.days} ${row.usage.days === 1 ? "day" : "days"}`,
          )
        }
        if (row.usage.firstDate) {
          parts.push(`first ${formatDate(row.usage.firstDate)}`)
        }
        // Which providers served this model — the interesting half of a
        // multi-client setup, where the same model arrives through a
        // vendor API and a gateway both.
        const via = row.via?.filter((id) => id !== "").map(providerLabel)
        if (via && via.length > 0) parts.push(`via ${via.join(", ")}`)
        const spec = {
          icon: aiIcon(group.key, row.id),
          name: row.name,
          value: formatMetric(row.usage[metric], metric),
          share: total > 0 ? row.usage[metric] / total : NaN,
          title: `${row.name} — ${parts.join(" · ")}`,
        }
        // One model still earns a disclosure: the row names the client or
        // the vendor, never the model behind it. Only an empty list —
        // a model row, or nothing above zero — stays plain.
        const subRows = modelSubRows(
          row.models ?? [],
          row.usage[metric],
          metric,
        )
        if (subRows.length === 0) return usageRow(icons, spec)
        const key = `${group.key}:${row.id}`
        return expandableRow(icons, spec, subRows, openRows.has(key), () => {
          if (openRows.has(key)) openRows.delete(key)
          else openRows.add(key)
        })
      })

      if (rest.length > 0) {
        const row = el("li", "tk-more")
        const button = document.createElement("button")
        button.type = "button"
        button.className = "tk-more-btn"
        button.setAttribute("aria-expanded", String(isOpen))
        const chevron = icons.icon("chevron")
        if (chevron) button.append(chevron)
        const noun = group.key + (rest.length === 1 ? "" : "s")
        button.append(
          el(
            "span",
            "more-label",
            isOpen ? "Show less" : `Show ${rest.length} more ${noun}`,
          ),
        )
        if (!isOpen) {
          const sum = rest.reduce((acc, r) => acc + r.usage[metric], 0)
          button.append(el("span", "more-amount", formatMetric(sum, metric)))
        }
        button.addEventListener("click", () => {
          if (isOpen) expanded.delete(group.key)
          else expanded.add(group.key)
          if (last) render(last.site, last.range, last.metric)
        })
        row.append(button)
        items.push(row)
      }

      if (items.length === 0) {
        items.push(el("li", "tk-empty", "No usage in this range."))
      }
      list.replaceChildren(...items)
    }
  }

  return { render }
}
