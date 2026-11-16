import { defineHastPlugin } from "satteri"

/**
 * An image a post links from another host (`![…](https://…)`) reaches
 * the page as a bare `<img>`: Astro optimizes only the colocated ones,
 * and gives those `loading="lazy"` and `decoding="async"` itself. The
 * same two here, so a remote screenshot far down a post is not fetched
 * and decoded with the first paint.
 */
export const remoteImages = defineHastPlugin({
  name: "remote-images",
  element: {
    filter: ["img"],
    visit(node, ctx) {
      const src = node.properties.src
      if (typeof src !== "string" || !/^https?:\/\//.test(src)) return
      if (node.properties.loading === undefined)
        ctx.setProperty(node, "loading", "lazy")
      if (node.properties.decoding === undefined)
        ctx.setProperty(node, "decoding", "async")
    },
  },
})
