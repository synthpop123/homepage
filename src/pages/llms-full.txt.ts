import { getPosts, getSubposts, postMarkdown } from "@/lib/content"
import type { APIRoute } from "astro"

export const GET: APIRoute = async ({ site, url }) => {
  const origin = site ?? url
  const posts = await getPosts()
  const series = await getSubposts()
  const chain = posts.flatMap((post) => [post, ...(series.get(post.id) ?? [])])
  const body = await Promise.all(
    chain.map((post) =>
      postMarkdown(post, new URL(`/blog/${post.id}`, origin)),
    ),
  )
  return new Response(body.join("\n"), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  })
}
