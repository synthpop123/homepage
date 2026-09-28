import { SITE } from "@/consts"
import { getPosts, postBody } from "@/lib/content"
import { feedCallouts, feedHtml } from "@/lib/feed-html"
import { temmlMath } from "@/lib/math"
import rss from "@astrojs/rss"
import type { APIContext } from "astro"
import { markdownToHtml } from "satteri"

// Full text, not a teaser, so a reader never has to leave the feed to
// read a post. Rendered from the same Markdown as /blog/<id>.md (assets
// already published URLs) with only the plugins whose output a feed
// reader can show: callouts as blockquotes, and MathML. Code stays plain <pre><code>,
// since highlighting is inline styles a reader strips anyway, and would
// multiply the feed's size.
export async function GET(context: APIContext) {
  const site = context.site!
  const posts = await getPosts()
  const items = await Promise.all(
    posts.map(async (post) => {
      const { html } = await markdownToHtml(await postBody(post, site), {
        features: { directive: true, math: true },
        mdastPlugins: [feedCallouts, temmlMath],
      })
      return {
        title: post.data.title,
        description: post.data.description,
        pubDate: post.data.date,
        link: `/blog/${post.id}`,
        categories: post.data.tags,
        content: feedHtml(html, site),
      }
    }),
  )
  return rss({
    title: SITE.title,
    description: SITE.description,
    site,
    items,
  })
}
