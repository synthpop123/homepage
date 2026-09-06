import { describe, expect, it } from "bun:test"
import { aiIcon, clientLabel, modelLabel, providerLabel } from "./labels"

describe("labels and icons", () => {
  it("falls back to the raw id for ids that shadow Object members", () => {
    for (const id of [
      "constructor",
      "__proto__",
      "toString",
      "hasOwnProperty",
    ]) {
      expect(clientLabel(id)).toBe(id)
      expect(providerLabel(id)).toBe(id)
      expect(aiIcon("client", id)).toBeNull()
      expect(aiIcon("provider", id)).toBeNull()
      expect(aiIcon("model", id)).toBeNull()
    }
  })

  it("still resolves the known ids", () => {
    expect(clientLabel("claude")).toBe("Claude Code")
    expect(clientLabel("other")).toBe("Other")
    expect(clientLabel("brand-new-cli")).toBe("brand-new-cli")
    expect(providerLabel("zed.dev")).toBe("Zed")
    expect(providerLabel("alibaba")).toBe("Alibaba")
    expect(providerLabel("meta")).toBe("Meta")
    expect(providerLabel("openrouter")).toBe("OpenRouter")
    expect(aiIcon("client", "claude")).toBe("claudecode")
    expect(aiIcon("provider", "moonshotai")).toBe("moonshot")
    expect(aiIcon("provider", "deepseek")).toBe("deepseek")
    expect(aiIcon("provider", "alibaba")).toBe("alibaba")
    expect(aiIcon("provider", "meta")).toBe("meta")
    expect(aiIcon("provider", "openrouter")).toBe("openrouter")
    expect(aiIcon("model", "claude-opus-5")).toBe("claude")
    expect(aiIcon("model", "deepseek-v4-flash")).toBe("deepseek")
    expect(aiIcon("model", "qwen3.8-max")).toBe("qwen")
  })

  // The icon slug and the [data-p] palette key are the same brand key,
  // which is what lets a model band wear its vendor's color without a
  // CSS rule per model id.
  it("places models on their vendor's brand key", () => {
    expect(aiIcon("model", "claude-opus-4-5")).toBe("claude")
    expect(aiIcon("model", "gpt-5.6-sol")).toBe("openai")
    expect(aiIcon("model", "o3")).toBe("openai")
    expect(aiIcon("model", "glm-4.7")).toBe("zai")
    expect(aiIcon("model", "composer-2.5")).toBe("cursor")
    expect(aiIcon("model", "muse-spark-1.2")).toBe("meta")
    expect(aiIcon("model", "ox-alpha")).toBe("openrouter")
    expect(aiIcon("model", "brand-new-model")).toBeNull()
    expect(aiIcon("model", "unknown")).toBeNull()
  })

  it("labels the collector's placeholder model ids", () => {
    expect(modelLabel("unknown")).toBe("Other")
    expect(modelLabel("<synthetic>")).toBe("Synthetic")
  })

  it("humanizes model ids into display names", () => {
    // Exact overrides keep their canonical spelling.
    expect(modelLabel("muse-spark-1.2")).toBe("Muse Spark 1.2")
    // Brand words are spelled per word, so every variant of a line is right.
    expect(modelLabel("deepseek-v4-flash")).toBe("DeepSeek V4 Flash")
    expect(modelLabel("deepseek-v4-pro")).toBe("DeepSeek V4 Pro")
    // Generic path: split into words, Title Case, dot-join versions.
    expect(modelLabel("claude-fable-5")).toBe("Claude Fable 5")
    expect(modelLabel("claude-opus-4-5")).toBe("Claude Opus 4.5")
    expect(modelLabel("claude-haiku-4-5")).toBe("Claude Haiku 4.5")
    expect(modelLabel("gemini-2.5-pro")).toBe("Gemini 2.5 Pro")
    expect(modelLabel("gpt-5.2-codex")).toBe("GPT 5.2 Codex")
    expect(modelLabel("kimi-k2")).toBe("Kimi K2")
    // A lone unknown id falls back to the raw string.
    expect(modelLabel("brand-new-model")).toBe("Brand New Model")
  })
})
