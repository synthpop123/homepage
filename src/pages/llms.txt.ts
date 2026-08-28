import { NAVIGATION, SITE } from "@/consts"
import { getPosts, getSubposts } from "@/lib/content"
import type { APIRoute } from "astro"
import type { CollectionEntry } from "astro:content"

export const GET: APIRoute = async ({ site, url }) => {
  const origin = site ?? url
  const posts = await getPosts()
  const series = await getSubposts()
  const link = (post: CollectionEntry<"blog">, indent = "") =>
    `${indent}- [${post.data.title}](${new URL(`/blog/${post.id}.md`, origin)}): ${post.data.description}`

  const body = [
    `# ${SITE.title}`,
    "",
    `> ${SITE.description}`,
    "",
    "## Blog",
    "",
    ...posts.flatMap((post) => [
      link(post),
      ...(series.get(post.id) ?? []).map((subpost) => link(subpost, "  ")),
    ]),
    "",
    "## Pages",
    "",
    ...NAVIGATION.map(
      ({ href, label }) => `- [${label}](${new URL(href, origin)})`,
    ),
    "",
    "## Optional",
    "",
    `- [Full text](${new URL("/llms-full.txt", origin)}): every post above, concatenated.`,
    `- [RSS](${new URL("/rss.xml", origin)}): new posts as they publish.`,
    "",
  ]
  return new Response(body.join("\n"), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  })
}
