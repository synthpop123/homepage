/**
 * Quota section renderer: how much of each subscription's rate-limit
 * window is spent, and when it comes back.
 *
 * This is the only section drawn from *reported* data — one card per
 * subscription, each read from its own vendor by its own collector on
 * its own timer (see tokens-worker's `src/quota.ts`) — which shapes the
 * whole design. Every number here can be silently stale, so nothing is
 * presented as simply current: each card dates itself from its own
 * `capturedAt` (one can be a minute old while the other has been stuck
 * for hours), and a window whose reset time has passed says it reset
 * instead of showing a percentage that is no longer true. No control
 * applies to it, but the clock does: the controller re-renders it every
 * minute, so countdowns tick and a window that rolls over while the page
 * is open turns into its reset state without a reload.
 */

import {
  aiIcon,
  formatAgo,
  formatIn,
  formatInstant,
  formatRemaining,
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
 * How close `resetsAt − capturedAt` may sit to the full window before we
 * treat it as OpenAI's unused placeholder (`now + window`) rather than a
 * real open window. Absorbs unix-second truncation and the gap between
 * the vendor clock and the Worker's `capturedAt`.
 */
const PLACEHOLDER_SLACK_MS = 2 * 60 * 1000

/**
 * A banked reset lapsing within a day is spend-it-or-lose-it; that one
 * tile is the only part of the list that is a warning.
 */
const CREDIT_URGENT_MS = 24 * 60 * 60 * 1000

const MS = { d: 86_400_000, h: 3_600_000, m: 60_000, s: 1_000 } as const

/**
 * Length of the rate-limit window named by `label`. Session/Weekly are
 * the names `/api/site` publishes; a trailing `5h` / `7d` covers Codex
 * additional limits the Worker leaves unmapped. Unknown labels return
 * null — without a length we cannot tell a placeholder from an open
 * window at 0% spend.
 */
export function windowDurationMs(label: string): number | null {
  if (label === "Session") return 5 * MS.h
  if (label === "Weekly") return 7 * MS.d
  const match = /(?:^|\s)(\d+)([dhms])$/i.exec(label)
  if (!match) return null
  const n = Number(match[1])
  const unit = match[2].toLowerCase() as keyof typeof MS
  return n > 0 ? n * MS[unit] : null
}

/**
 * Whether the reset foot should appear. OpenAI reports integer
 * `used_percent: 0` even after a real spend has opened the window, and
 * fills unused windows with `resetsAt ≈ capturedAt + duration` that
 * drifts on every poll. An anchored window is already shorter than the
 * full duration (minus slack); Anthropic simply omits `resetsAt` until
 * spend starts.
 */
export function windowIsOpen(
  window: QuotaWindow,
  capturedAtMs: number,
): boolean {
  if (window.resetsAt === null) return false
  if (window.usedPercent > 0) return true
  const duration = windowDurationMs(window.label)
  if (duration === null) return false
  const remaining = Date.parse(window.resetsAt) - capturedAtMs
  // Past the vendor's reset with no recorded spend: still say so, so a
  // stale 0% card does not look untouched.
  if (!Number.isFinite(remaining) || remaining <= 0) return true
  return remaining < duration - PLACEHOLDER_SLACK_MS
}

/**
 * Whether the window this snapshot describes has since rolled over — the
 * vendor's own reset time is behind us. Nothing reported about it is
 * current any more: the figure and the bar both describe a window that
 * has ended, and the one that replaced it is unread until the next
 * collector run. So the whole window renders as reset, not just its
 * foot; a bar drawn at 11% under the word "reset" is the card
 * contradicting itself.
 *
 * Only windows the vendor actually anchored qualify (windowIsOpen) —
 * OpenAI's drifting placeholder is always in the future anyway, and a
 * window with no reset time cannot have passed one.
 */
export function windowHasReset(
  window: QuotaWindow,
  now: number,
  capturedAtMs: number,
): boolean {
  if (!windowIsOpen(window, capturedAtMs) || window.resetsAt === null) {
    return false
  }
  const resetsAt = Date.parse(window.resetsAt)
  return Number.isFinite(resetsAt) && resetsAt <= now
}

/**
 * What one window's row says, decided once so the renderer only writes
 * it down:
 *
 * - `idle`  — the vendor has not anchored the window (OpenAI's drifting
 *   placeholder, Anthropic's omitted reset). Nothing is counting down,
 *   so the foot says what starts the clock instead of going blank — an
 *   empty foot is what left one card's rows a line out of step with
 *   the other's.
 * - `open`  — the reading is current: "resets in 2h 5m". Only the reset,
 *   not what is left: the figure and the bar already say that twice.
 * - `reset` — the vendor's reset time has passed since the report. The
 *   ended window's spend no longer applies and the new one starts from
 *   zero, so the row reads 0% on an empty track; what nobody knows yet
 *   is whether anything has been spent since, and the foot says so.
 *
 * The foot is relative — the countdown is what reads at a glance — and
 * the wall-clock instant, which is what you plan around, rides in
 * `title` for whoever wants it.
 */
export type WindowView = {
  state: "idle" | "open" | "reset"
  used: number
  foot: string
  title?: string
}

export function windowView(
  window: QuotaWindow,
  now: number,
  capturedAtMs: number,
): WindowView {
  const used = Math.min(100, Math.max(0, window.usedPercent))
  if (!windowIsOpen(window, capturedAtMs) || window.resetsAt === null) {
    return {
      state: "idle",
      used,
      // A vendor that reports spend with no reset time is a shape
      // neither collector has produced, but the foot must not claim the
      // window has not started while the bar says otherwise.
      foot: used > 0 ? "reset time not reported" : "starts on first use",
    }
  }
  const at = Date.parse(window.resetsAt)
  const instant = formatInstant(window.resetsAt)
  if (windowHasReset(window, now, capturedAtMs)) {
    return {
      state: "reset",
      used: 0,
      foot: `reset ${formatAgo(at, now)} · awaiting report`,
      title: `Reset ${instant}`,
    }
  }
  return {
    state: "open",
    used,
    foot: `resets ${formatIn(at, now)}`,
    title: `Resets ${instant}`,
  }
}

/**
 * Label left, figure right — "Session … 9% used" — so the figure column
 * lines up down the card and across both cards, and the word "used"
 * settles which way the bar reads.
 */
function figureRow(label: string, value: string, unit: string) {
  const head = el("div", "win-head")
  const figure = el("span", "win-used")
  figure.append(el("b", "", value), ` ${unit}`)
  head.append(el("span", "win-label", label), figure)
  return head
}

function renderWindow(
  window: QuotaWindow,
  provider: string,
  now: number,
  capturedAtMs: number,
): HTMLElement {
  const view = windowView(window, now, capturedAtMs)
  const item = el("li", "tk-window")
  item.dataset.state = view.state

  // A gauge, not a share: the other bars on the page cut one number
  // into its parts, this one measures a number against a ceiling that
  // is never drawn anywhere else. So it gets its own form — a thin
  // track carrying one rounded head. The vendor's hue is set on the
  // track, so the head inherits it and the track washes itself in it.
  const bar = el("div", "tk-meter")
  bar.dataset.p = provider
  if (view.used >= HIGH_USE) bar.dataset.high = ""
  // A window barely touched should still show that it was touched — the
  // head's own min-inline-size keeps the sliver visible — but an
  // untouched one shows nothing at all, or that floor would report a
  // spend of zero as a spend.
  if (view.used > 0) {
    const fill = el("span")
    fill.style.inlineSize = `${view.used}%`
    bar.append(fill)
  }

  const foot = el("p", "win-foot", view.foot)
  if (view.title) foot.title = view.title
  item.append(
    figureRow(window.label, `${Math.round(view.used)}%`, "used"),
    bar,
    foot,
  )
  return item
}

function renderPlan(plan: QuotaPlan, icons: Icons, now: number): HTMLElement {
  const item = el("li", "tk-plan")

  // Mark, name and tier are one phrase — "Codex · Team" — not a name
  // with a badge stuck to it, so the separator is part of the text. The
  // age trails at the far end: each plan is read by its own collector on
  // its own timer, so it is a fact about this card, not about the page.
  // Claude's card wears the model star rather than Anthropic's corporate
  // mark: the subscription is "Claude", and the star is what this page
  // already gives Claude models. The exception is listed rather than
  // derived, because every other plan does want its vendor's mark —
  // Codex is OpenAI's product and wears OpenAI's.
  const head = el("div", "plan-head")
  const mark =
    plan.provider === "anthropic"
      ? aiIcon("model", "claude")
      : aiIcon("provider", plan.provider)
  head.append(icons.slot(mark))
  head.append(el("span", "plan-name", plan.label))
  if (plan.plan) head.append(el("span", "plan-tier", `· ${plan.plan}`))

  const capturedAt = Date.parse(plan.capturedAt)
  const age = el("span", "plan-age", formatAgo(capturedAt, now))
  age.title = `Read ${new Date(capturedAt).toLocaleString()}`
  // Beyond the threshold the age is the headline, not a footnote: the
  // numbers beside it may describe a window that has since ended.
  age.toggleAttribute("data-stale", now - capturedAt > STALE_AFTER_MS)
  head.append(age)

  const windows = el("ol", "tk-windows")
  windows.append(
    ...plan.windows.map((window) =>
      renderWindow(window, plan.provider, now, capturedAt),
    ),
  )

  item.append(head, windows)

  // Banked resets are a property of the plan, not of any one window,
  // and they expire whether or not they are spent — so each is its own
  // tile rather than a summary like "next expires in 6d". They are spent
  // one at a time, and which one to spend depends on when the others
  // lapse: the tiles run soonest first, the first wears the plan's hue
  // as the one to spend next, and one about to lapse turns red. The
  // hourglass says "expires in"; the instant is on hover.
  const unspent = plan.resetCredits.filter((at) => Date.parse(at) > now)
  if (unspent.length > 0) {
    const credits = el("div", "plan-credits")
    credits.dataset.p = plan.provider
    const list = el("ol", "credits-list")
    list.append(
      ...unspent.map((at, i) => {
        const expires = Date.parse(at)
        const tile = el("li", "credit")
        tile.title = `Expires ${formatInstant(at)}`
        if (i === 0) tile.dataset.next = ""
        if (expires - now < CREDIT_URGENT_MS) tile.dataset.urgent = ""
        tile.append(
          icons.slot("hourglass"),
          el("span", "", formatRemaining(expires, now) ?? ""),
        )
        return tile
      }),
    )
    // Same row as a window's head, so the count sits in the figure
    // column: "Banked resets … 3 left".
    credits.append(
      figureRow("Banked resets", `${unspent.length}`, "left"),
      list,
    )
    item.append(credits)
  }

  return item
}

export function renderQuota(q: Query, site: Site, icons: Icons) {
  const section = q(".tk-quota-section")
  const list = q(".tk-plans")
  if (!section || !list) return

  // No collector has ever reported, or the account has none to report:
  // the section is absent rather than empty. An empty state here would
  // explain a piece of plumbing the reader has no stake in.
  const absent = site.quota.length === 0
  section.hidden = absent
  if (absent) return

  const now = Date.now()
  list.replaceChildren(
    ...site.quota.map((plan) => renderPlan(plan, icons, now)),
  )
}
