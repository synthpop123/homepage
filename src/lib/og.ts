import { readFileSync } from "node:fs"
import path from "node:path"
import { Resvg } from "@resvg/resvg-js"
import satori from "satori"
import { SITE } from "@/consts"
import { formatDate } from "@/lib/utils"

// Colors mirror the light theme grays in src/styles/color.css.
const BG = "#fcfcfc"
const FG = "#202020"
const MUTED = "#646464"
const BORDER = "#d9d9d9"

const WIDTH = 1200
const HEIGHT = 630

// Resolved from the project root: import.meta.url is unreliable after the
// build bundles this module, but `astro build` always runs from the root.
const asset = (relative: string) => path.resolve(process.cwd(), relative)

// Satori falls back across the font list per glyph, so Geist serves Latin
// while the Noto Sans SC subset (CJK + full-width punctuation) serves Chinese.
const fonts = [
  {
    name: "Geist",
    data: readFileSync(asset("src/assets/fonts/og/Geist-Regular.ttf")),
    weight: 400 as const,
    style: "normal" as const,
  },
  {
    name: "Geist",
    data: readFileSync(asset("src/assets/fonts/og/Geist-Medium.ttf")),
    weight: 500 as const,
    style: "normal" as const,
  },
  {
    name: "Noto Sans SC",
    data: readFileSync(asset("src/assets/fonts/og/NotoSansSC-Regular.woff")),
    weight: 400 as const,
    style: "normal" as const,
  },
  {
    name: "Noto Sans SC",
    data: readFileSync(asset("src/assets/fonts/og/NotoSansSC-Medium.woff")),
    weight: 500 as const,
    style: "normal" as const,
  },
]

const logoDataUri = `data:image/svg+xml;base64,${Buffer.from(
  readFileSync(asset("src/assets/logo.svg"), "utf8").replaceAll(
    "currentColor",
    FG,
  ),
).toString("base64")}`

type Node = { type: string; props: Record<string, unknown> }

const h = (
  type: string,
  props: Record<string, unknown>,
  ...children: (Node | string)[]
): Node => ({
  type,
  props: { ...props, children: children.length === 1 ? children[0] : children },
})

const logo = (size: number) =>
  h("img", { src: logoDataUri, width: size, height: size, style: {} })

const frame = (...children: Node[]) =>
  h(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        width: "100%",
        height: "100%",
        padding: 72,
        backgroundColor: BG,
        color: FG,
        fontFamily: '"Geist", "Noto Sans SC"',
      },
    },
    ...children,
  )

const footer = (hostname: string, meta?: string) =>
  h(
    "div",
    {
      style: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        paddingTop: 32,
        borderTop: `1px solid ${BORDER}`,
        fontSize: 26,
      },
    },
    h("div", { style: { fontWeight: 500 } }, hostname),
    h("div", { style: { color: MUTED } }, meta ?? ""),
  )

const render = async (node: Node) => {
  const svg = await satori(node, { width: WIDTH, height: HEIGHT, fonts })
  return new Resvg(svg).render().asPng()
}

type PostCard = {
  title: string
  description: string
  date: Date
  tags?: string[]
  hostname: string
}

export function renderPostCard({
  title,
  description,
  date,
  tags,
  hostname,
}: PostCard) {
  const meta = [
    formatDate(date),
    (tags ?? [])
      .slice(0, 3)
      .map((tag) => `#${tag}`)
      .join(" "),
  ]
    .filter(Boolean)
    .join("  ·  ")

  return render(
    frame(
      h(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "center",
            gap: 16,
            fontSize: 30,
            fontWeight: 500,
          },
        },
        logo(38),
        h("div", { style: {} }, SITE.title),
      ),
      h(
        "div",
        { style: { display: "flex", flexDirection: "column" } },
        h(
          "div",
          {
            style: {
              display: "block",
              lineClamp: 3,
              fontSize: 62,
              fontWeight: 500,
              lineHeight: 1.15,
              letterSpacing: "-0.02em",
            },
          },
          title,
        ),
        h(
          "div",
          {
            style: {
              display: "block",
              lineClamp: 2,
              marginTop: 28,
              maxWidth: 940,
              fontSize: 28,
              lineHeight: 1.5,
              color: MUTED,
            },
          },
          description,
        ),
      ),
      footer(hostname, meta),
    ),
  )
}

export function renderSiteCard(hostname: string) {
  return render(
    frame(
      logo(48),
      h(
        "div",
        { style: { display: "flex", flexDirection: "column" } },
        h(
          "div",
          {
            style: {
              fontSize: 104,
              fontWeight: 500,
              letterSpacing: "-0.03em",
            },
          },
          SITE.title,
        ),
        h(
          "div",
          { style: { marginTop: 12, fontSize: 36, color: MUTED } },
          `/${SITE.description.replace(/\.$/, "")}/`,
        ),
      ),
      footer(hostname),
    ),
  )
}
