import { SITE } from "@/consts"
import { getSeries, postBody } from "@/lib/content"
import { feedCallouts, feedHtml } from "@/lib/markdown/feed-html"
import { temmlMath } from "@/lib/markdown/math"
import { unhandledDirectives } from "@/lib/markdown/unhandled-directives"
import rss from "@astrojs/rss"
import type { APIContext } from "astro"
import type { CollectionEntry } from "astro:content"
import { markdownToHtml } from "satteri"

// Full text, not a teaser, so a reader never has to leave the feed to
// read a post. Rendered from the same Markdown as /blog/<id>.md (assets
// already published URLs) with only the plugins whose output a feed
// reader can show: callouts as blockquotes, and MathML. Code stays plain <pre><code>,
// since highlighting is inline styles a reader strips anyway, and would
// multiply the feed's size.
//
// A series is one item, as it is one page: the parent's body, then each
// subpost under its title. The item links to the series page, so a
// subpost item of its own would only send the reader to the same place.
const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"]/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]!,
  )

export async function GET(context: APIContext) {
  const site = context.site!
  const render = async (entry: CollectionEntry<"blog">) =>
    markdownToHtml(await postBody(entry, site), {
      features: { directive: true, math: true },
      mdastPlugins: [feedCallouts, temmlMath, unhandledDirectives],
    }).html
  const items = await Promise.all(
    (await getSeries()).map(async ([post, ...subposts]) => {
      const html = [
        await render(post),
        ...(await Promise.all(
          subposts.map(
            async (subpost) =>
              `<h2>${escapeHtml(subpost.data.title)}</h2>\n${await render(subpost)}`,
          ),
        )),
      ].join("\n")
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
