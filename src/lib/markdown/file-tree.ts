import type { List, ListItem, PhrasingContent } from "mdast"
import { defineMdastPlugin } from "satteri"

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")

const textOf = (node: PhrasingContent): string =>
  "value" in node
    ? node.value
    : "children" in node
      ? node.children.map(textOf).join("")
      : ""

/** A comment's inline Markdown: code stays code, the rest is its text. */
const inline = (nodes: PhrasingContent[]) =>
  nodes
    .map((node) =>
      node.type === "inlineCode"
        ? `<code>${escapeHtml(node.value)}</code>`
        : escapeHtml(textOf(node)),
    )
    .join("")

export type FileKind =
  | "folder"
  | "folder-open"
  | "file"
  | "file-text"
  | "file-code"
  | "file-config"
  | "file-terminal"
  | "file-image"

const KINDS: [Exclude<FileKind, `folder${string}`>, RegExp][] = [
  ["file-text", /\.(md|mdx|txt|rst|adoc)$|^(readme|license|changelog|notice)$/],
  [
    "file-config",
    /\.(json5?|jsonc|ya?ml|toml|ini|conf|cfg|env|lock|xml|plist|properties)$|^\.|^dockerfile$|\.dockerfile$/,
  ],
  ["file-terminal", /\.(sh|bash|zsh|fish|ps1|bat|cmd)$|^(makefile|justfile)$/],
  ["file-image", /\.(png|jpe?g|gif|svg|webp|avif|ico)$/],
  [
    "file-code",
    /\.([cm]?[jt]sx?|py|rs|go|rb|java|kts?|swift|c|h|cc|cpp|hpp|cs|php|lua|astro|vue|svelte|s?css|html?|sql|nix|zig)$/,
  ],
]

/**
 * The icon an entry is drawn with: an open folder for a directory with
 * children, a shut one for an empty directory, else a file by its
 * extension or well-known name.
 */
export function fileKind(name: string, children = false): FileKind {
  if (name.endsWith("/")) return children ? "folder-open" : "folder"
  const lower = name.toLowerCase()
  return KINDS.find(([, test]) => test.test(lower))?.[0] ?? "file"
}

type Count = { dirs: number; files: number }

/**
 * One entry: the name is the item's first word, or its first `code` or
 * **bold** run (bold marks it), and whatever follows is its comment. An
 * entry with children, or a name ending in `/`, is a directory. Its row
 * is its kind's icon, name and comment; its children hang under it.
 */
function parse(item: ListItem) {
  const [head, ...rest] = item.children
  const phrasing = head?.type === "paragraph" ? [...head.children] : []
  let name = ""
  let mark = false
  const first = phrasing.shift()
  if (first?.type === "strong" || first?.type === "inlineCode") {
    name = textOf(first)
    mark = first.type === "strong"
  } else if (first?.type === "text") {
    const [, word, after] = /^\s*(\S+)([\s\S]*)$/.exec(first.value) ?? []
    name = word ?? ""
    if (after) phrasing.unshift({ type: "text", value: after })
  }
  const children = rest.filter((child): child is List => child.type === "list")
  const dir = children.length > 0 || name.endsWith("/")
  if (dir && !name.endsWith("/")) name += "/"
  return { name, mark, dir, children, note: inline(phrasing).trim() }
}

const row = ({ name, mark, children, note }: ReturnType<typeof parse>) =>
  [
    `<span data-row data-kind="${fileKind(name, children.length > 0)}">`,
    `<span data-name${mark ? " data-mark" : ""}>${escapeHtml(name)}</span>`,
    note ? `<span data-note>${note}</span>` : "",
    "</span>",
  ].join("")

function entry(item: ListItem, count: Count): string {
  const parsed = parse(item)
  count[parsed.dir ? "dirs" : "files"]++
  return [
    `<li${parsed.dir ? " data-dir" : ""}>`,
    row(parsed),
    ...parsed.children.map((list) => tree(list, count)),
    "</li>",
  ].join("")
}

const tree = (list: List, count: Count): string =>
  `<ul>${list.children.map((item) => entry(item, count)).join("")}</ul>`

/** `tree`'s own last line: "3 directories, 1 file". */
export const summary = ({ dirs, files }: Count) =>
  `${dirs} ${dirs === 1 ? "directory" : "directories"}, ${files} ${files === 1 ? "file" : "files"}`

/**
 * The listing as HTML, always under one root that heads the frame as a
 * code block's title does: a list of one directory is that directory
 * (a project, with its comment), any other list hangs off `./`, as
 * `tree` prints it. The head closes with `tree`'s count, the root left
 * out.
 */
export function fileTreeHtml(list: List): string {
  const count: Count = { dirs: 0, files: 0 }
  const only = list.children.length === 1 ? parse(list.children[0]) : null
  const root =
    only?.dir && only.children.length > 0
      ? only
      : { name: "./", mark: false, dir: true, children: [list], note: "" }
  const body = root.children.map((child) => tree(child, count)).join("")
  return [
    "<file-tree><div data-head>",
    row(root),
    `<span data-count lang="en">${summary(count)}</span>`,
    `</div>${body}</file-tree>`,
  ].join("")
}

/**
 * `:::file-tree` around a nested list: a directory listing in Geist Mono,
 * each entry's icon hung off its directory by hairline elbows, comments
 * muted, in place of an ASCII tree in a code block. In the feed it stays
 * the list it was written as.
 */
export const fileTreeDirective = defineMdastPlugin({
  name: "file-tree-directive",
  containerDirective(node, ctx) {
    if (node.name !== "file-tree") return
    const list = node.children.find((child) => child.type === "list")
    if (!list) {
      ctx.report({
        message: ":::file-tree holds a list",
        node,
        severity: "warning",
      })
      return
    }
    return { type: "html", value: fileTreeHtml(list) }
  },
})
