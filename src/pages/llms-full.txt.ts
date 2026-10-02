import { getSeries, postMarkdown } from "@/lib/content"
import type { APIRoute } from "astro"

export const GET: APIRoute = async ({ site, url }) => {
  const origin = site ?? url
  const body = await Promise.all(
    (await getSeries())
      .flat()
      .map((post) => postMarkdown(post, new URL(`/blog/${post.id}`, origin))),
  )
  return new Response(body.join("\n"), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  })
}
