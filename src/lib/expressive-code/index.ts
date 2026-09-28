import expressiveCode from "satteri-expressive-code"
import { ecRenderer } from "./config"
import { inlineExpressiveCode } from "./inline"

/**
 * Code blocks without their page-wide extras: left to the plugin, the
 * first block on every page would carry ~29 KB of base and theme CSS
 * plus the copy-button and scroll-tabindex scripts, inline and so never
 * cached. `expressiveCodeAssets` (below) serves them once instead, as
 * hashed files the post page imports.
 */
export const blockExpressiveCode = expressiveCode({
  customCreateRenderer: async () => ({
    ...(await ecRenderer),
    baseStyles: "",
    themeStyles: "",
    jsModules: [],
  }),
})

const STYLES = "virtual:expressive-code.css"
const SCRIPTS = "virtual:expressive-code.js"

/**
 * A Vite plugin serving Expressive Code's page-wide CSS and JS as two
 * virtual modules, which the bundler then emits as content-hashed,
 * immutable files shared by every post.
 */
export const expressiveCodeAssets = () => ({
  name: "expressive-code-assets",
  resolveId: (id: string) =>
    id === STYLES || id === SCRIPTS ? `\0${id}` : undefined,
  async load(id: string) {
    if (id !== `\0${STYLES}` && id !== `\0${SCRIPTS}`) return undefined
    const { baseStyles, themeStyles, jsModules } = await ecRenderer
    return id === `\0${STYLES}`
      ? baseStyles + themeStyles
      : jsModules.join("\n")
  },
})

export { inlineExpressiveCode }
