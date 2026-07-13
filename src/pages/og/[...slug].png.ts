import { renderPostCard, renderSiteCard } from "@/lib/og"
import type { APIRoute } from "astro"
import { getCollection, type CollectionEntry } from "astro:content"

// Build-time OG cards: /og/site.png for pages, /og/blog/<id>.png for posts
// without a hand-made frontmatter image (those keep their own banner).
export async function getStaticPaths() {
  const posts = await getCollection(
    "blog",
    ({ data }) => !data.draft && !data.image,
  )
  return [
    { params: { slug: "site" }, props: {} },
    ...posts.map((post) => ({
      params: { slug: `blog/${post.id}` },
      props: { post },
    })),
  ]
}

type Props = { post?: CollectionEntry<"blog"> }

export const GET: APIRoute<Props> = async ({ props, site, url }) => {
  const hostname = (site ?? url).hostname
  const { post } = props
  const png = post
    ? await renderPostCard({
        title: post.data.title,
        description: post.data.description,
        date: post.data.date,
        tags: post.data.tags,
        hostname,
      })
    : await renderSiteCard(hostname)
  return new Response(new Uint8Array(png), {
    headers: { "Content-Type": "image/png" },
  })
}
