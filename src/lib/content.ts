import { SITE } from "@/consts"
import { getImage } from "astro:assets"
import { getCollection, type CollectionEntry } from "astro:content"
import { countWords, detectLang } from "@/lib/lang"
import { isSubpost } from "@/lib/utils"

export const pageTitle = (title: string) => `${title} | ${SITE.title}`

/** The language a post is written in: its `lang`, or read from its body. */
export const postLang = (post: CollectionEntry<"blog">): string =>
  post.data.lang ?? detectLang(post.body ?? "", SITE.locale)

/** A `lang` for a post's title on a page in the site's own locale. */
export const titleLang = (post: CollectionEntry<"blog">) => {
  const lang = postLang(post)
  return lang === SITE.locale ? undefined : lang
}

/** How many words a set of entries holds between them. */
export const countEntryWords = (entries: CollectionEntry<"blog">[]) =>
  entries.reduce((sum, entry) => sum + countWords(entry.body ?? ""), 0)

/** A post's length in words, as its page reads: a series' opening post
 *  counts the series whole (its page is the series), a subpost itself. */
export const postWords = (chain: CollectionEntry<"blog">[], post = chain[0]) =>
  countEntryWords(post === chain[0] ? chain : [post])

export async function getPosts(): Promise<CollectionEntry<"blog">[]> {
  const posts = await getCollection("blog", ({ data }) => !data.draft)
  return posts
    .filter((post) => !isSubpost(post.id))
    .sort((a, b) => b.data.date.getTime() - a.data.date.getTime())
}

export async function getSubposts(): Promise<
  Map<string, CollectionEntry<"blog">[]>
> {
  const posts = await getCollection(
    "blog",
    ({ id, data }) => !data.draft && id.split("/").length === 2,
  )
  posts.sort(
    (a, b) =>
      (a.data.order ?? Infinity) - (b.data.order ?? Infinity) ||
      a.data.date.getTime() - b.data.date.getTime(),
  )
  return Map.groupBy(posts, (post) => post.id.split("/")[0])
}

/**
 * Every published post as the series it is read in: a top-level post,
 * newest first, followed by its subposts in order. This is the one
 * answer to "what is published" — the post pages, `/blog/<id>.md`, the
 * OG cards, llms.txt, the RSS feed and the About counts all read it, so
 * a subpost under a draft parent is nowhere rather than half-published.
 */
export async function getSeries(): Promise<CollectionEntry<"blog">[][]> {
  const posts = await getPosts()
  const series = await getSubposts()
  return posts.map((post) => [post, ...(series.get(post.id) ?? [])])
}

/**
 * Colocated assets a body links to as `./assets/…`. A `.md` served at
 * `/blog/<id>.md` is one directory shallower than its source, so those
 * targets have to become the published URLs of the same images before
 * the file leaves the site — otherwise every picture in the export is
 * a 404. Passing metadata to `getImage` (rather than reading `.src`)
 * asks for the same transform the rendered page already requested, so
 * the export points at an asset the build emits anyway. The glob stays
 * lazy: eager-importing the whole tree also emits every colocated file
 * nothing references, at full size.
 */
const BODY_ASSETS = import.meta.glob<{ default: ImageMetadata }>(
  "/src/content/blog/**/*.{png,jpg,jpeg,gif,webp,avif,svg}",
)

const RELATIVE_TARGET = /(\]\()(\.{1,2}\/[^)\s]+)/g

async function absoluteAssets(
  post: CollectionEntry<"blog">,
  body: string,
  source: URL,
): Promise<string> {
  if (!post.filePath) return body
  const dir = post.filePath.slice(0, post.filePath.lastIndexOf("/"))
  const published = new Map<string, string>()
  for (const [, , target] of body.matchAll(RELATIVE_TARGET)) {
    if (published.has(target)) continue
    const load = BODY_ASSETS[new URL(target, `file:///${dir}/`).pathname]
    if (!load) continue
    const { src } = await getImage({ src: (await load()).default })
    published.set(target, new URL(src, source).href)
  }
  return body.replace(RELATIVE_TARGET, (match, open, target) => {
    const url = published.get(target)
    return url ? `${open}${url}` : match
  })
}

/** A post's Markdown body with its colocated assets as absolute,
 *  published URLs: readable anywhere the post file itself is not. */
export const postBody = (post: CollectionEntry<"blog">, source: URL) =>
  absoluteAssets(post, post.body?.trim() ?? "", source)

/** Frontmatter + body, the source behind `/blog/<id>.md`. */
export async function postMarkdown(
  post: CollectionEntry<"blog">,
  source: URL,
): Promise<string> {
  const { title, description, date, updatedDate, tags, ai } = post.data
  const quote = (value: string) => JSON.stringify(value)
  const day = (value: Date) => value.toISOString().slice(0, 10)
  const frontmatter = [
    `title: ${quote(title)}`,
    `description: ${quote(description)}`,
    `date: ${day(date)}`,
  ]
  if (updatedDate) frontmatter.push(`updated: ${day(updatedDate)}`)
  if (tags?.length) frontmatter.push(`tags: [${tags.map(quote).join(", ")}]`)
  if (ai) frontmatter.push("ai: true")
  frontmatter.push(`lang: ${postLang(post)}`)
  frontmatter.push(`source: ${source}`)
  const body = await postBody(post, source)
  return `---\n${frontmatter.join("\n")}\n---\n\n${body}\n`
}

export async function getTags(): Promise<
  Map<string, CollectionEntry<"blog">[]>
> {
  const tags = new Map<string, CollectionEntry<"blog">[]>()
  for (const chain of await getSeries()) {
    const [post] = chain
    for (const tag of new Set(
      chain.flatMap((entry) => entry.data.tags ?? []),
    )) {
      const tagged = tags.get(tag)
      if (tagged) tagged.push(post)
      else tags.set(tag, [post])
    }
  }
  return new Map(
    [...tags].sort(
      ([a, postsA], [b, postsB]) =>
        postsB.length - postsA.length || a.localeCompare(b),
    ),
  )
}
