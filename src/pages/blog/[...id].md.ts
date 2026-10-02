import { getSeries, postMarkdown } from "@/lib/content"
import type { APIRoute } from "astro"
import type { CollectionEntry } from "astro:content"

export async function getStaticPaths() {
  return (await getSeries())
    .flat()
    .map((post) => ({ params: { id: post.id }, props: { post } }))
}

type Props = { post: CollectionEntry<"blog"> }

export const GET: APIRoute<Props> = async ({ props, site, url }) =>
  new Response(
    await postMarkdown(
      props.post,
      new URL(`/blog/${props.post.id}`, site ?? url),
    ),
    { headers: { "Content-Type": "text/markdown; charset=utf-8" } },
  )
