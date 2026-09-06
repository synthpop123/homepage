/** Display names and brand icons for the ids the payload carries. */

/** Sentinel for residual segments and their label. */
export const OTHER = "other"

/**
 * Maps, not plain objects: every id below is looked up with a string the
 * collector took from a CLI payload, and nothing constrains those ids
 * beyond "non-empty". On an object literal, `constructor` resolves to a
 * function and `__proto__` to Object.prototype instead of missing — the
 * `?? id` fallback never fires and a row renders the source text of a
 * native function. The producer keeps its own slice maps prototype-free
 * for the same reason (tokens-worker: src/site.ts).
 */
const CLIENT_LABELS = new Map<string, string>([
  ["cursor", "Cursor"],
  ["codex", "Codex"],
  ["claude", "Claude Code"],
  ["pi", "Pi"],
  ["opencode", "OpenCode"],
  ["gemini", "Gemini CLI"],
  ["grok", "Grok Build"],
  ["hermes", "Hermes Agent"],
  ["zed", "Zed"],
  ["unknown", "Other"],
  [OTHER, "Other"],
])

const PROVIDER_LABELS = new Map<string, string>([
  ["anthropic", "Anthropic"],
  ["openai", "OpenAI"],
  ["google", "Google"],
  ["xai", "xAI"],
  ["cursor", "Cursor"],
  ["moonshotai", "Moonshot AI"],
  ["zai", "Z.ai"],
  ["deepseek", "DeepSeek"],
  ["alibaba", "Alibaba"],
  ["meta", "Meta"],
  ["openrouter", "OpenRouter"],
  // Serving gateways: the collector re-attributes their rows to model
  // vendors; these ids remain only for models the rules can't place.
  ["opencode", "OpenCode"],
  ["zed.dev", "Zed"],
  ["unknown", "Other"],
  [OTHER, "Other"],
])

export const clientLabel = (id: string) => CLIENT_LABELS.get(id) ?? id

export const providerLabel = (id: string) => PROVIDER_LABELS.get(id) ?? id

/* Model names ---------------------------------------------------------- */

/**
 * Display names for model ids. The collector reports the CLI's raw model
 * id (claude-opus-4-5); the dashboard should read like a human writes it
 * (Claude Opus 4.5). The generic path splits the id into words, Title
 * Cases them and joins numeric runs into dotted versions; MODEL_WORDS
 * holds the words whose brand spelling that would get wrong (GPT,
 * DeepSeek), so every variant of a line is right at once, and
 * MODEL_NAMES the few whole ids no rule could derive.
 */

/** Words whose display form isn't plain Title Case. */
const MODEL_WORDS = new Map<string, string>([
  ["gpt", "GPT"],
  ["glm", "GLM"],
  ["deepseek", "DeepSeek"],
])

/** Exact-id overrides: canonical names no generic rule could derive. */
const MODEL_NAMES = new Map<string, string>([
  ["muse-spark-1.2", "Muse Spark 1.2"],
  // Placeholders. Nothing renders them any more (PLACEHOLDER_IDS), but
  // the labels stay honest for anything that reaches modelLabel directly.
  ["unknown", "Other"],
  ["<synthetic>", "Synthetic"],
])

const isVersion = (token: string) => /^\d+(\.\d+)*$/.test(token)

const titleWord = (word: string) =>
  MODEL_WORDS.get(word) ?? word.charAt(0).toUpperCase() + word.slice(1)

/** claude-fable-5 → Claude Fable 5; claude-opus-4-5 → Claude Opus 4.5
 *  (consecutive version parts join with a dot). */
const genericModelName = (id: string) => {
  const words: string[] = []
  for (const raw of id.split(/[-_]/)) {
    const last = words[words.length - 1]
    if (isVersion(raw) && last !== undefined && isVersion(last)) {
      words[words.length - 1] = `${last}.${raw}`
    } else {
      words.push(titleWord(raw))
    }
  }
  return words.join(" ")
}

export const modelLabel = (id: string) =>
  MODEL_NAMES.get(id) ?? genericModelName(id)

/* Brand icons ---------------------------------------------------------- */

/**
 * Ids the collector reports for usage it could not attribute. Nothing on
 * the page renders them: a row reading "Other — 6.8K" answers no
 * question a visitor has, and every place one could appear (breakdown
 * rows, the model disclosures, Today's top models, a color band, the
 * "models tried" count) is somewhere "unattributed" is not an answer.
 * The cost is that shares no longer quite sum to their range — which the
 * collector's own totals still do, and which is the smaller lie.
 */
export const PLACEHOLDER_IDS = new Set(["unknown", "<synthetic>"])

/** Maps for the same reason the label tables are — and here a stray
 *  inherited value would be interpolated into a CSS attribute selector
 *  (dom.ts, createIcons) rather than merely printed. */
const PROVIDER_ICONS = new Map<string, string>([
  ["anthropic", "anthropic"],
  ["openai", "openai"],
  ["google", "google"],
  ["xai", "xai"],
  ["cursor", "cursor"],
  ["moonshotai", "moonshot"],
  ["zai", "zai"],
  ["deepseek", "deepseek"],
  ["alibaba", "alibaba"],
  ["meta", "meta"],
  ["openrouter", "openrouter"],
  ["opencode", "opencode"],
  ["zed.dev", "zed"],
])

const CLIENT_ICONS = new Map<string, string>([
  ["cursor", "cursor"],
  ["claude", "claudecode"],
  ["codex", "codex"],
  ["pi", "pi"],
  ["opencode", "opencode"],
  ["gemini", "gemini"],
  ["grok", "grok"],
  ["hermes", "hermesagent"],
  ["zed", "zed"],
])

/** Ordered prefix rules over canonical model names. */
const MODEL_ICONS: [RegExp, string][] = [
  [/^claude/, "claude"],
  [/codex/, "codex"],
  [/^(gpt|o\d)/, "openai"],
  [/^gemini/, "gemini"],
  [/^grok/, "grok"],
  [/^(composer|cursor|auto$|agent)/, "cursor"],
  [/^kimi/, "kimi"],
  [/^deepseek/, "deepseek"],
  [/^qwen/, "qwen"],
  [/^glm/, "zai"],
  [/^muse/, "meta"],
  [/^ox-/, "openrouter"],
  [/^big-pickle/, "opencode"],
]

/** Editorial icon choice only; vendor attribution comes from the payload. */
function modelIcon(id: string): string | null {
  const model = id.toLowerCase()
  for (const [pattern, brand] of MODEL_ICONS) {
    if (pattern.test(model)) return brand
  }
  return null
}

/**
 * Lobe Icons slug (vendored under src/assets/icons/ai/) for a breakdown
 * row, or null when the brand has no icon there — rows render a blank
 * spacer so names stay aligned.
 */
export function aiIcon(
  kind: "model" | "client" | "provider",
  id: string,
): string | null {
  if (kind === "provider") return PROVIDER_ICONS.get(id) ?? null
  if (kind === "client") return CLIENT_ICONS.get(id) ?? null
  return modelIcon(id)
}
