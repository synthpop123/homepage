import { readFileSync } from "node:fs"
import path from "node:path"
import { Resvg } from "@resvg/resvg-js"
import satori from "satori"
import { SITE } from "@/consts"
import type { TimelineCell } from "@/lib/content"
import { formatCompact, formatDate } from "@/lib/utils"

// Colors mirror the light theme grays in src/styles/color.css.
const BG = "#fcfcfc"
const FG = "#202020"
const MUTED = "#646464"
// The timeline's cells: the heatmap's empty, faintest and accent steps.
const CELL = "#e8e8e8"
const RELATED = "#9be9a8"
const ACCENT = "#30a14e"

const WIDTH = 1200
const HEIGHT = 630

// Resolved from the project root: import.meta.url is unreliable after the
// build bundles this module, but `astro build` always runs from the root.
const asset = (relative: string) => path.resolve(process.cwd(), relative)

// Satori falls back across the font list per glyph, so Inter serves Latin
// while the Noto Sans SC subset (CJK + full-width punctuation) serves Chinese.
// Satori applies no OpenType features, so the Inter files have the site's
// --font-sans-features baked into their cmap, and use the Display cut,
// since every card size is display size. Built from the Inter 4.1 release:
//   pyftfeatfreeze -f ss01,ss03,ss04,cv11 -S -U "" InterDisplay-<w>.ttf f.ttf
//   pyftsubset f.ttf --no-hinting --layout-features=calt,ccmp,kern,locl,mark,mkmk \
//     --unicodes=U+20-7E,U+A0-17F,U+2C6-2DC,U+300-30C,U+2000-206F,U+20A0-20CF,U+2190-22FF
const fonts = [
  {
    name: "Inter",
    data: readFileSync(asset("src/assets/fonts/og/InterDisplay-Regular.ttf")),
    weight: 400 as const,
    style: "normal" as const,
  },
  {
    name: "Inter",
    data: readFileSync(asset("src/assets/fonts/og/InterDisplay-Medium.ttf")),
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
  props: {
    ...props,
    // Satori reads an empty array as children to lay out, not as none.
    ...(children.length > 0 && {
      children: children.length === 1 ? children[0] : children,
    }),
  },
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
        fontFamily: '"Inter", "Noto Sans SC"',
      },
    },
    ...children,
  )

const CELL_COLORS: Record<TimelineCell, string> = {
  current: ACCENT,
  related: RELATED,
  other: CELL,
}

/** Every post on the site as one cell of a strip, like a row of the
 *  heatmap: on a post's card the post is lit, its kin tinted. */
const timeline = (cells: TimelineCell[]) =>
  h(
    "div",
    { style: { display: "flex", gap: 6, marginBottom: 28 } },
    ...cells.map((cell) =>
      h("div", {
        style: {
          flex: 1,
          height: 14,
          borderRadius: 3,
          backgroundColor: CELL_COLORS[cell],
        },
      }),
    ),
  )

const footer = (hostname: string, cells: TimelineCell[], meta?: string) =>
  h(
    "div",
    { style: { display: "flex", flexDirection: "column" } },
    timeline(cells),
    h(
      "div",
      {
        style: {
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          fontSize: 26,
        },
      },
      h("div", { style: { fontWeight: 500 } }, hostname),
      h("div", { style: { color: MUTED } }, meta ?? ""),
    ),
  )

const render = async (node: Node) => {
  const svg = await satori(node, { width: WIDTH, height: HEIGHT, fonts })
  return new Resvg(svg).render().asPng()
}

type PostCard = {
  title: string
  description: string
  date: Date
  words: number
  tags?: string[]
  hostname: string
  timeline: TimelineCell[]
}

export function renderPostCard({
  title,
  description,
  date,
  words,
  tags,
  hostname,
  timeline: cells,
}: PostCard) {
  const meta = [
    formatDate(date),
    `${formatCompact(words)} words`,
    (tags ?? [])
      .slice(0, 3)
      .map((tag) => `#${tag}`)
      .join(" "),
  ]
    .filter(Boolean)
    .join("     ")

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
      footer(hostname, cells, meta),
    ),
  )
}

export function renderSiteCard(hostname: string, cells: TimelineCell[]) {
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
      footer(hostname, cells),
    ),
  )
}
