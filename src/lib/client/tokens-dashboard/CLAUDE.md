# Tokens

The `/tokens` dashboard (`Tokens.astro`, `../tokens/`, this directory, styles in `src/styles/tokens/`). `../CLAUDE.md` covers what every live section shares.

- **`/tokens`** (`Tokens.astro`, `tokens/`, `tokens-dashboard/`, styles in `src/styles/tokens/`): AI token-usage dashboard — Quota, Activity (heatmap doubles as day picker for the day panel), overview/trend/breakdowns, Patterns, Devices.
- The service owns model/provider id mapping; the page never guesses a vendor from a model name (it reads `byModel[].providers`).
- Patterns: when the current streak is the record, the Longest card becomes **Previous best** (`computeFacts().previous`) and the current one reads "longest so far", so the two never repeat each other.
- Quota cards are *reported* data and must admit their age: per-card `capturedAt`, a window past its reset reads `reset 1h ago` (muted, like any foot) rather than a stale percentage, times shown in **Asia/Shanghai** (the collector's zone, which buckets every calendar day). The section re-renders every minute.
- `PLACEHOLDER_IDS` (`unknown`, `<synthetic>`) are dropped everywhere, so shares may not sum to 100%.
- Device kinds (backdrop icons) come from `TOKENS.devices` in `consts.ts`; the payload has no hardware info.
- Decoded but deliberately not drawn: `extraUsage`, `mcpServers`.
- Styles: one file per renderer module, all nested under `tokens-dashboard` (runtime DOM), the skeletons sit in the `feeds.states` layer, so they win over section rules whatever the import order. Skeletons here are sized to the real payload (the quota card is above the fold).
- AI brand icons are Lobe Icons mono SVGs in `src/assets/icons/ai/` (`aiIcon()`), `<title>` stripped — a nested `<title>` would shadow the row's own tooltip.
