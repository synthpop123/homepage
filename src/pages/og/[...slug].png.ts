import {
  getSeries,
  postWords,
  timeline,
  type TimelineCell,
} from "@/lib/content"
import { renderPostCard, renderSiteCard } from "@/lib/og"
import type { APIRoute } from "astro"
import type { CollectionEntry } from "astro:content"

// Build-time OG cards: /og/site.png for pages, /og/blog/<id>.png for posts
// without a hand-made frontmatter image (those keep their own banner).
// Every card carries the site's posts as a timeline, oldest first: on a
// post's card the post is lit, on the site's every post faintly.
export async function getStaticPaths() {
  const series = await getSeries()
  const cells = (lit: string[]) => timeline(series, lit).map(({ cell }) => cell)

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
            timeline: cells([chain[0].id]),
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
