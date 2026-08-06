/**
 * Quota section renderer: how much of each subscription's rate-limit
 * window is spent, and when it comes back.
 *
 * This is the only section drawn from *reported* data — a collector on
 * one host asks the vendor every 30 minutes (see tokens-worker's
 * `src/quota.ts`) — which shapes the whole design. Every number here can
 * be silently stale, so nothing is presented as simply current: the
 * section dates itself from `capturedAt`, and a window whose reset time
 * has passed says it reset instead of showing a percentage that is no
 * longer true. Rendered once per load; no control applies to it.
 */

import {
  aiIcon,
  formatAgo,
  formatIn,
  formatInstant,
  type QuotaPlan,
  type QuotaWindow,
  type Site,
} from "../tokens"
import { el, type Icons, type Query } from "./dom"

/**
 * Past this, the bar stops being a neutral measurement and becomes a
 * warning. High enough that a busy week does not cry wolf, low enough to
 * still be a heads-up rather than an obituary.
 */
const HIGH_USE = 90

/**
 * A snapshot older than this is presented as an age rather than as the
 * current state. Four missed reports: a timer that ran late is normal,
 * two hours of silence is a collector that stopped.
 */
const STALE_AFTER_MS = 2 * 60 * 60 * 1000

/**
 * "72% left · resets Aug 8, 21:28 · in 2d", or what is true instead.
 * The wall-clock time is the fact worth planning around and the
 * countdown is what reads at a glance, so both ship — neither is left
 * to a `title` no touch device can reach.
 */
function windowFoot(window: QuotaWindow, now: number): string {
  const remaining = Math.max(0, 100 - window.usedPercent)
  const left = `${Math.round(remaining)}% left`
  if (window.resetsAt === null) return left
  // The vendor's own reset time, so a window that rolled over since the
  // last report is stated as reset rather than drawn as a full bar.
  const until = formatIn(Date.parse(window.resetsAt), now)
  return until === null
    ? "window reset — awaiting next report"
    : `${left} · resets ${formatInstant(window.resetsAt)} · ${until}`
}

function renderWindow(
  window: QuotaWindow,
  provider: string,
  now: number,
): HTMLElement {
  const item = el("li", "tk-window")

  const head = el("div", "win-head")
  head.append(
    el("span", "win-label", window.label),
    el("span", "win-used", `${Math.round(window.usedPercent)}%`),
  )

  // The share bar from the Overview and Today mixes, with one segment:
  // same geometry, same brand palette, so a quota bar reads as the same
  // kind of object as every other proportion on the page.
  const bar = el("div", "tk-mix-bar")
  const fill = el("span")
  fill.dataset.p = provider
  // A window barely touched should still show that it was touched; the
  // bar's own min-inline-size keeps the sliver visible.
  fill.style.inlineSize = `${Math.min(100, Math.max(0, window.usedPercent))}%`
  if (window.usedPercent >= HIGH_USE) fill.dataset.high = ""
  bar.append(fill)

  item.append(head, bar, el("p", "win-foot", windowFoot(window, now)))
  return item
}

function renderPlan(plan: QuotaPlan, icons: Icons, now: number): HTMLElement {
  const item = el("li", "tk-plan")

  // Mark, name and tier are one phrase — "Codex · Team" — not a name
  // with a badge stuck to it, so the separator is part of the text.
  const head = el("div", "plan-head")
  head.append(icons.slot(aiIcon("provider", plan.provider)))
  head.append(el("span", "plan-name", plan.label))
  if (plan.plan) head.append(el("span", "plan-tier", `· ${plan.plan}`))

  const windows = el("ol", "tk-windows")
  windows.append(
    ...plan.windows.map((window) => renderWindow(window, plan.provider, now)),
  )

  item.append(head, windows)

  // Manual resets are a property of the plan, not of any one window, and
  // they expire whether or not they are spent — so each expiry is listed
  // in full rather than summarised as "next expires in 6d". They are
  // spent one at a time, and which one to spend depends on when the
  // others lapse.
  const unspent = plan.resetCredits.filter((at) => Date.parse(at) > now)
  if (unspent.length > 0) {
    const credits = el("div", "plan-credits")
    credits.append(
      el(
        "p",
        "credits-head",
        `${unspent.length} manual ${unspent.length === 1 ? "reset" : "resets"}`,
      ),
    )
    const list = el("ol", "credits-list")
    list.append(
      ...unspent.map((at) =>
        el(
          "li",
          "",
          `expires ${formatInstant(at)} · ${formatIn(Date.parse(at), now)}`,
        ),
      ),
    )
    credits.append(list)
    item.append(credits)
  }

  return item
}

export function renderQuota(q: Query, site: Site, icons: Icons) {
  const section = q(".tk-quota-section")
  const list = q(".tk-plans")
  const meta = q(".tk-quota-meta")
  if (!section || !list) return

  // No collector has ever reported, or the account has none to report:
  // the section is absent rather than empty. An empty state here would
  // explain a piece of plumbing the reader has no stake in.
  const absent = !site.quota || site.quota.plans.length === 0
  section.hidden = absent
  // The table of contents is rendered by the page shell, outside this
  // component, so a hidden section would otherwise leave a live link
  // pointing into nothing.
  document
    .querySelector('nav a[href="#quota"]')
    ?.closest("li")
    ?.toggleAttribute("hidden", absent)
  if (absent || !site.quota) return

  const now = Date.now()
  const capturedAt = Date.parse(site.quota.capturedAt)
  list.replaceChildren(
    ...site.quota.plans.map((plan) => renderPlan(plan, icons, now)),
  )

  if (meta) {
    meta.textContent = `read ${formatAgo(capturedAt, now)}`
    meta.title = new Date(capturedAt).toLocaleString()
    // Beyond the threshold the age is the headline, not a footnote: the
    // numbers above it may be describing a week that has since ended.
    meta.toggleAttribute("data-stale", now - capturedAt > STALE_AFTER_MS)
  }
}
