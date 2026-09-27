import { describe, expect, it } from "bun:test"
import { detectLang, prose } from "./lang"

describe("prose", () => {
  it("drops code, maths, HTML and link targets", () => {
    const markdown = [
      "文字 [link](https://example.com/a) `inline code`",
      "```ts",
      "const english = 'lots of words here'",
      "```",
      "$$ x + y $$ and $z$ <kbd>Ctrl</kbd>",
    ].join("\n")
    expect(prose(markdown).replace(/\s+/g, " ").trim()).toBe(
      "文字 [link] and Ctrl",
    )
  })
})

describe("detectLang", () => {
  it("reads mostly-Han prose as Chinese", () => {
    expect(detectLang("通过 Komodo 和 Renovate 管理服务。", "en-US")).toBe(
      "zh-CN",
    )
  })

  it("keeps English prose, and a Chinese aside, in the fallback", () => {
    expect(detectLang("A post about k3s and GitOps.", "en-US")).toBe("en-US")
    expect(
      detectLang("An English post that quotes one phrase, 你好。", "en-US"),
    ).toBe("en-US")
  })

  it("does not count code toward either side", () => {
    const code = "```py\n" + "word ".repeat(200) + "\n```\n"
    expect(detectLang(`${code}中文说明文字`, "en-US")).toBe("zh-CN")
  })

  it("falls back when there is no prose at all", () => {
    expect(detectLang("```sh\nls\n```", "en-US")).toBe("en-US")
  })
})
