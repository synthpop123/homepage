import { describe, expect, it } from "bun:test"
import { countWords, detectLang, prose, readingMinutes } from "./lang"

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

describe("countWords", () => {
  it("counts each Han character and each Latin word or number", () => {
    expect(countWords("用 Docker 部署 k3s 集群，跑了 4 个节点。")).toBe(13)
  })

  it("counts code, but not link targets or fences", () => {
    const markdown =
      "看[文档](https://example.com/docs)\n```sh\nrun this now\n```"
    expect(countWords(markdown)).toBe(6)
  })
})

describe("readingMinutes", () => {
  it("reads 400 Han characters or 230 Latin words a minute", () => {
    expect(readingMinutes("字".repeat(4000))).toBe(10)
    expect(readingMinutes("word ".repeat(2300))).toBe(10)
    expect(readingMinutes(`${"字".repeat(2000)} ${"word ".repeat(1150)}`)).toBe(
      10,
    )
  })

  it("never says less than a minute", () => {
    expect(readingMinutes("")).toBe(1)
    expect(readingMinutes("短文。")).toBe(1)
  })
})
