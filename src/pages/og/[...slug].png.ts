import { getSeries, postWords } from "@/lib/content"
import { renderPostCard, renderSiteCard, type TimelineCell } from "@/lib/og"
import type { APIRoute } from "astro"
import type { CollectionEntry } from "astro:content"

// Build-time OG cards: /og/site.png for pages, /og/blog/<id>.png for posts
// without a hand-made frontmatter image (those keep their own banner).
// Every card carries the site's posts as a timeline, oldest first.
export async function getStaticPaths() {
  const series = (await getSeries()).toReversed()
  const tagsOf = (chain: CollectionEntry<"blog">[]) =>
    new Set(chain.flatMap(({ data }) => data.tags ?? []))
  const timeline = (chain: CollectionEntry<"blog">[]): TimelineCell[] => {
    const tags = tagsOf(chain)
    return series.map((other) =>
      other === chain
        ? "current"
        : tagsOf(other).isDisjointFrom(tags)
          ? "other"
          : "related",
    )
  }

  return [
    {
      params: { slug: "site" },
      props: { timeline: series.map((): TimelineCell => "related") },
    },
    ...series.flatMap((chain) =>
      chain
        .filter(({ data }) => !data.image)
        .map((post) => ({
          params: { slug: `blog/${post.id}` },
          props: {
            post,
            words: postWords(chain, post),
            timeline: timeline(chain),
          },
        })),
    ),
  ]
}

type Props = {
  post?: CollectionEntry<"blog">
  words?: number
  timeline: TimelineCell[]
}

export const GET: APIRoute<Props> = async ({ props, site, url }) => {
  const hostname = (site ?? url).hostname
  const { post, words = 0, timeline } = props
  const png = post
    ? await renderPostCard({
        title: post.data.title,
        description: post.data.description,
        date: post.data.date,
        words,
        tags: post.data.tags,
        hostname,
        timeline,
      })
    : await renderSiteCard(hostname, timeline)
  return new Response(new Uint8Array(png), {
    headers: { "Content-Type": "image/png" },
  })
}
