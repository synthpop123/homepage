/**
 * Quota section renderer: how much of each subscription's rate-limit
 * window is spent, and when it comes back.
 *
 * This is the only section drawn from *reported* data — one card per
 * subscription, each read from its own vendor by its own collector on
 * its own timer (see cf-workers-api's `src/services/tokens/quota.ts`) — which shapes the
 * whole design. Every number here can be silently stale, so nothing is
 * presented as simply current: each card dates itself from its own
 * `capturedAt` (one can be a minute old while the other has been stuck
 * for hours), and a window whose reset time has passed says it reset
 * instead of showing a percentage that is no longer true. No control
 * applies to it, but the clock does: the controller re-renders it every
 * minute, so countdowns tick and a window that rolls over while the page
 * is open turns into its reset state without a reload. The collector
 * re-reads a plan 90 s after each of its windows resets (on top of its
 * half-hourly timer), and `followUpDue` has the page fetch that report
 * shortly after, so the reset state is a minute or two, not half an hour.
 */

import { relativeTime } from "../feed"
import {
  aiIcon,
  formatIn,
  formatInstant,
  formatRemaining,
  type QuotaAllowance,
  type QuotaCredit,
  type QuotaPlan,
  type QuotaShare,
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

/**
 * When, after a window's reset, the page asks for the report the
 * collector makes for it: the collector re-runs 90 s after the reset
 * (`arm-quota-reset.sh` on its host), so this leaves it time to land.
 */
const FOLLOW_UP_MS = { from: 2 * 60_000, to: 3 * 60_000 } as const

const MS = { d: 86_400_000, h: 3_600_000, m: 60_000, s: 1_000 } as const

/** The fields the window arithmetic reads — the breakdown plays no part
 *  in when a window opens or resets. */
type WindowTiming = Pick<QuotaWindow, "label" | "usedPercent" | "resetsAt">

/**
 * The instant one calendar month before `at`, in UTC, with the day held
 * to the shorter month's last ("Mar 31" → "Feb 28"), the way a monthly
 * billing anchor rolls back.
 */
function monthBefore(at: Date): number {
  const year = at.getUTCFullYear()
  const month = at.getUTCMonth() - 1
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const start = new Date(at)
  start.setUTCFullYear(year, month, Math.min(at.getUTCDate(), lastDay))
  return start.getTime()
}

/**
 * Length of the rate-limit window named by `label`. Session/Weekly/
 * Monthly are the names `/tokens/site` publishes (a scoped ceiling
 * extends the name: "Weekly · Opus"); a trailing `5h` / `7d` covers
 * Codex additional limits the Worker leaves unmapped. Unknown labels
 * return null — without a length we cannot tell a placeholder from an
 * open window at 0% spend.
 *
 * A month is not a fixed length, so Monthly is measured back from the
 * window's own reset — OpenCode Go anchors it to the subscription day —
 * and has no length until the vendor names one.
 */
export function windowDurationMs(
  label: string,
  resetsAt: string | null = null,
): number | null {
  // "Weekly · Opus" is a weekly window scoped to one model.
  if (/^Session\b/.test(label)) return 5 * MS.h
  if (/^Weekly\b/.test(label)) return 7 * MS.d
  if (/^Monthly\b/.test(label)) {
    const at = resetsAt === null ? Number.NaN : Date.parse(resetsAt)
    if (!Number.isFinite(at)) return null
    return at - monthBefore(new Date(at))
  }
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
  window: WindowTiming,
  capturedAtMs: number,
): boolean {
  if (window.resetsAt === null) return false
  if (window.usedPercent > 0) return true
  const duration = windowDurationMs(window.label, window.resetsAt)
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
  window: WindowTiming,
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
 * Whether a window reset two to three minutes ago on a plan whose report
 * predates it — the moment the collector's post-reset report should have
 * landed. The page ticks once a minute, so exactly one tick falls in the
 * band and the follow-up fetch runs once per reset; a tick missed (a
 * hidden tab) leaves it to the regular five-minute reload.
 */
export function followUpDue(site: Pick<Site, "quota">, now: number): boolean {
  return site.quota.some((plan) => {
    const capturedAt = Date.parse(plan.capturedAt)
    return plan.windows.some((window) => {
      if (!windowHasReset(window, now, capturedAt) || !window.resetsAt) {
        return false
      }
      const since = now - Date.parse(window.resetsAt)
      return since >= FOLLOW_UP_MS.from && since < FOLLOW_UP_MS.to
    })
  })
}

/**
 * What one window's row says, decided once so the renderer only writes
 * it down:
 *
 * - `idle`  — the vendor has not anchored the window (OpenAI's drifting
 *   placeholder, Anthropic's omitted reset). Nothing is counting down,
 *   so the foot says the window is untouched and idle (its title, what
 *   starts the clock) instead of going blank — an
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
type WindowView = {
  state: "idle" | "open" | "reset"
  used: number
  foot: string
  title?: string
  /** Share of the window's length already behind us, 0–1 — only for an
   *  open window whose length is known. */
  elapsed?: number
}

/**
 * Share of an anchored window that has passed: the window started one
 * `duration` before its reset, so what is left of it is the countdown.
 * Null when the length is unknown or nothing is anchored.
 */
export function windowElapsed(
  window: WindowTiming,
  now: number,
): number | null {
  const duration = windowDurationMs(window.label, window.resetsAt)
  if (duration === null || window.resetsAt === null) return null
  const left = Date.parse(window.resetsAt) - now
  if (!Number.isFinite(left)) return null
  return Math.min(1, Math.max(0, 1 - left / duration))
}

/**
 * Spend measured against the clock, for the meter's tooltip: the tick on
 * the track shows where time stands, and the numbers ride in the title.
 */
export const paceTitle = (used: number, elapsed: number) =>
  `${Math.round(used)}% used with ${Math.round(elapsed * 100)}% of the window gone`

export function windowView(
  window: WindowTiming,
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
      foot: used > 0 ? "reset time not reported" : "on standby",
      ...(used > 0 ? {} : { title: "The clock starts at first use" }),
    }
  }
  const at = Date.parse(window.resetsAt)
  const instant = formatInstant(window.resetsAt)
  if (windowHasReset(window, now, capturedAtMs)) {
    return {
      state: "reset",
      used: 0,
      foot: `reset ${relativeTime(at, now)}`,
      title: `Reset ${instant}`,
    }
  }
  const elapsed = windowElapsed(window, now)
  return {
    state: "open",
    used,
    foot: `resets ${formatIn(at, now)}`,
    title: `Resets ${instant}`,
    ...(elapsed === null ? {} : { elapsed }),
  }
}

/** "$100", "$25.50" — whole amounts stay whole, anything else shows
 *  cents, in the currency the vendor named (US dollars when it named
 *  none: both vendors bill in them). */
export function formatMoney(value: number, currency: string | null = "USD") {
  const whole = Number.isInteger(value)
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency ?? "USD",
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: whole ? 0 : 2,
    }).format(value)
  } catch {
    // An unknown currency code is the vendor's typo, not a reason to
    // lose the number.
    return `${value.toFixed(whole ? 0 : 2)} ${currency}`
  }
}

/**
 * One allowance's row: spend against a dollar ceiling, the foot saying
 * when it lapses. An allowance is a grant, not a window — Claude's cloud
 * session credits expire rather than refill — so a passed expiry does
 * not read as a full allowance the way a passed reset does: what was
 * spent stays, and the rest is gone until a report says otherwise. The
 * vendor either dates it or does not, so there is no idle state.
 */
type AllowanceView = {
  state: "open" | "expired"
  used: number
  figure: string
  foot: string
  title?: string
  /** The ceiling: "$100 total", beside the figure's "used". */
  total: string
}

export function allowanceView(
  allowance: QuotaAllowance,
  now: number,
): AllowanceView {
  const limit = allowance.limitDollars
  const total = `${formatMoney(limit)} total`
  const at =
    allowance.expiresAt === null ? Number.NaN : Date.parse(allowance.expiresAt)
  const spent = Math.min(limit, Math.max(0, allowance.usedDollars))
  if (Number.isFinite(at) && at <= now) {
    return {
      state: "expired",
      used: (spent / limit) * 100,
      figure: formatMoney(spent),
      foot: `expired ${relativeTime(at, now)}`,
      title: `Expired ${formatInstant(allowance.expiresAt ?? "")}`,
      total,
    }
  }
  return {
    state: "open",
    used: (spent / limit) * 100,
    figure: formatMoney(spent),
    foot: Number.isFinite(at)
      ? `expires ${formatIn(at, now)}`
      : "no expiry reported",
    ...(Number.isFinite(at)
      ? { title: `Expires ${formatInstant(allowance.expiresAt ?? "")}` }
      : {}),
    // What is left is the ceiling less the figure: say the ceiling once
    // and let "used" and the bar do the subtraction.
    total,
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
  head.append(el("span", "win-label", label.replace(" · ", " ")), figure)
  return head
}

/**
 * The gauge itself. A thin track carrying one rounded head; when the
 * vendor says where the spend went, the head is cut into those surfaces
 * — one hue stepped lighter per share, largest first — so the split
 * reads inside the reading instead of as a second chart.
 */
function meter(
  provider: string,
  used: number,
  shares: QuotaShare[] = [],
): HTMLElement {
  // A gauge, not a share: the other bars on the page cut one number
  // into its parts, this one measures a number against a ceiling that
  // is never drawn anywhere else. So it gets its own form. The vendor's
  // hue is set on the track, so the head inherits it and the track
  // washes itself in it.
  const bar = el("div", "tk-meter")
  bar.dataset.p = provider
  if (used >= HIGH_USE) bar.dataset.high = ""
  // A window barely touched should still show that it was touched — the
  // head's own min-inline-size keeps the sliver visible — but an
  // untouched one shows nothing at all, or that floor would report a
  // spend of zero as a spend.
  if (used > 0) {
    const fill = el("span", "tk-fill")
    fill.style.inlineSize = `${used}%`
    if (shares.length > 1) {
      fill.append(
        ...shares.map((share, i) => {
          const part = el("i")
          part.dataset.shade = String(i)
          part.style.flexGrow = String(share.percent)
          return part
        }),
      )
    }
    bar.append(fill)
  }
  return bar
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

  const shares = view.state === "reset" ? [] : window.breakdown
  const bar = meter(provider, view.used, shares)

  const foot = el("p", "win-foot")
  const when = el("span", "", view.foot)
  if (view.title) when.title = view.title
  foot.append(when)

  // Where the clock stands in the window: a tick on the track, so a
  // head short of it is spend running slower than time.
  if (view.elapsed !== undefined) {
    const tick = el("b", "tk-pace")
    tick.style.insetInlineStart = `${view.elapsed * 100}%`
    bar.append(tick)
    bar.title = paceTitle(view.used, view.elapsed)
  }

  item.append(
    figureRow(window.label, `${Math.round(view.used)}%`, "used"),
    bar,
    foot,
  )

  // Where the spend went, keyed to the head's shades. A lone surface is
  // still named — "all of it Claude Code" is a finding too.
  if (shares.length > 0 && view.used > 0) {
    const split = el("ul", "win-split")
    split.dataset.p = provider
    split.append(
      ...shares.map((share, i) => {
        const row = el("li")
        row.dataset.shade = String(i)
        row.title = `${share.label}: ${Math.round(share.percent)}% of this window's usage`
        row.append(
          el("span", "win-split-name", share.label),
          el("span", "win-split-share", `${Math.round(share.percent)}%`),
        )
        return row
      }),
    )
    item.append(split)
  }
  return item
}

function renderAllowance(
  allowance: QuotaAllowance,
  provider: string,
  now: number,
): HTMLElement {
  const view = allowanceView(allowance, now)
  const item = el("li", "tk-window")
  item.dataset.state = view.state
  item.dataset.kind = "allowance"

  const foot = el("p", "win-foot")
  const when = el("span", "", view.foot)
  if (view.title) when.title = view.title
  foot.append(when, el("span", "win-total", view.total))

  item.append(
    figureRow(allowance.label, view.figure, "used"),
    meter(provider, view.used),
    foot,
  )
  return item
}

function creditTitle(credit: QuotaCredit) {
  const expires = `Expires ${formatInstant(credit.expiresAt)}`
  return credit.title ? `${credit.title}\n${expires}` : expires
}

function renderPlan(plan: QuotaPlan, icons: Icons, now: number): HTMLElement {
  const item = el("li", "tk-plan")

  // Mark, name and tier are one phrase — "Codex Team", the tier muted —
  // not a name with a badge stuck to it. The age trails at the far end: each plan is read by its own collector on
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
  // The same mark again as the card's backdrop, large and faint in the
  // vendor's hue — the way the Uses cards carry theirs.
  item.dataset.p = plan.provider
  const backdrop = icons.slot(mark)
  backdrop.className = "plan-mark"
  item.append(backdrop)
  head.append(el("span", "plan-name", plan.label))
  if (plan.plan) head.append(el("span", "plan-tier", plan.plan))

  const capturedAt = Date.parse(plan.capturedAt)
  const age = el("span", "plan-age", relativeTime(capturedAt, now))
  age.title = `Read ${new Date(capturedAt).toLocaleString()}`
  // Beyond the threshold the age is the headline, not a footnote: the
  // numbers beside it may describe a window that has since ended.
  age.toggleAttribute("data-stale", now - capturedAt > STALE_AFTER_MS)
  head.append(age)

  // Dollar allowances continue the list of ceilings: they are measured
  // the same way — spend against a limit that comes back — and only the
  // unit differs.
  const windows = el("ol", "tk-windows")
  windows.append(
    ...plan.windows.map((window) =>
      renderWindow(window, plan.provider, now, capturedAt),
    ),
    ...plan.allowances.map((allowance) =>
      renderAllowance(allowance, plan.provider, now),
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
  const unspent = plan.resetCredits.filter(
    (credit) => Date.parse(credit.expiresAt) > now,
  )
  if (unspent.length > 0) {
    const credits = el("div", "plan-credits")
    credits.dataset.p = plan.provider
    const list = el("ol", "credits-list")
    list.append(
      ...unspent.map((credit, i) => {
        const expires = Date.parse(credit.expiresAt)
        const tile = el("li", "credit")
        tile.title = creditTitle(credit)
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
    // column: "Banked resets … 3 left". What a credit resets rides in
    // each tile's title.
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
