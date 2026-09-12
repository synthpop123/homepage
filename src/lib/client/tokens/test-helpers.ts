/** Minimal well-formed payload pieces the unit tests build on. */
import {
  type QuotaPlan,
  type Site,
  SITE_SCHEMA_VERSION,
  type SiteDay,
  type SiteRange,
  type Usage,
  type UsageSpan,
} from "./schema"

export const day = (
  date: string,
  tokens = 0,
  extra: Partial<SiteDay> = {},
): SiteDay => ({
  date,
  tokens,
  cost: 0,
  messages: 0,
  providers: {},
  clients: {},
  ...extra,
})

/** A day's client slice: totals plus the models behind them. */
export const dayClient = (
  tokens: number,
  cost: number,
  models: Record<string, { tokens: number; cost: number }> = {},
): SiteDay["clients"][string] => ({ tokens, cost, models })

export const usage = (tokens = 0): Usage => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  reasoning: 0,
  tokens,
  messages: 0,
  cost: 0,
})

export const span: UsageSpan = { days: 0, firstDate: null, lastDate: null }

export const device = (): Site["devices"][number] => ({
  name: "MacbookPro",
  firstSeen: 1784199105234,
  lastSeen: 1784989231554,
  cliVersion: "3.1.0",
  sessions: 12,
  activeMs: 3_600_000,
  longestMs: 1_200_000,
  maxConcurrent: 2,
  mcpServers: ["context7"],
  activeDays: 3,
  tokens: 100,
  messages: 5,
  cost: 1.5,
})

export const modelRows = (
  ...models: [model: string, tokens: number, cost?: number][]
): SiteRange["byModel"] =>
  models.map(([model, tokens, cost = 0]) => ({
    ...usage(tokens),
    ...span,
    cost,
    model,
    providers: ["anthropic"],
  }))

export const providerRows = (
  ...providers: [provider: string, tokens: number][]
): SiteRange["byProvider"] =>
  providers.map(([provider, tokens]) => ({
    ...usage(tokens),
    ...span,
    provider,
    models: [],
  }))

export const rangeStats = (
  byProvider: SiteRange["byProvider"] = [],
  byClient: SiteRange["byClient"] = [],
  byModel: SiteRange["byModel"] = [],
): SiteRange => ({
  from: null,
  totals: { ...usage(), activeDays: 0, firstDate: null, lastDate: null },
  byModel,
  byClient,
  byProvider,
})

export const site = (
  byProvider: SiteRange["byProvider"] = [],
  byClient: SiteRange["byClient"] = [],
): Site => ({
  schemaVersion: SITE_SCHEMA_VERSION,
  deviceOnlineWithinMs: 2_700_000,
  generatedAt: "2026-07-20T00:00:00Z",
  today: "2026-07-20",
  quota: [],
  ranges: {
    week: rangeStats(),
    month: rangeStats(),
    quarter: rangeStats(),
    all: rangeStats(byProvider, byClient),
  },
  daily: [],
  devices: [],
})

export const quotaPlan = (): QuotaPlan => ({
  provider: "openai",
  label: "Codex",
  plan: "Team",
  capturedAt: "2026-07-20T00:00:00Z",
  windows: [
    { label: "Weekly", usedPercent: 28, resetsAt: "2026-07-22T00:00:00Z" },
  ],
  resetCredits: ["2026-07-25T00:00:00Z"],
})
