# lkwplus.com

Personal homepage and blog at [lkwplus.com](https://lkwplus.com) — built with [Astro](https://astro.build/) on a heavily customized [astro-erudite](https://github.com/jktrn/astro-erudite) v2 base: no UI framework, no CSS framework, hand-written native CSS with [Utopia](https://utopia.fyi/) fluid scales, and the Rust-based [Sätteri](https://satteri.bruits.org/) Markdown processor.

## Stack

- **Astro 7**, static output, package manager **bun** (Node ≥ 22.12.0)
- **Sätteri** Markdown pipeline with custom mdast/hast plugins in `src/lib/` (callouts, Temml math → MathML, Expressive Code, Mermaid, heading anchors) — no remark/rehype
- **Native CSS** in `src/styles/`: [Radix Colors](https://www.radix-ui.com/colors) hex scales as `light-dark()` pairs behind semantic tokens, Utopia `--step-*`/`--space-*` scales, autonomous custom elements as layout primitives
- **Biome** for formatting only (no linter), `bun:test` for unit tests

## Commands

| Command                | Description                                            |
| ---------------------- | ------------------------------------------------------ |
| `bun dev`              | Dev server at `http://localhost:4321`                  |
| `bun run build`        | Build the production site to `dist/`                   |
| `bun run preview`      | Preview the production build                           |
| `bun test`             | Unit tests for the pure data helpers                   |
| `bun run check:links`  | Verify internal links in `dist/` (run after a build)   |
| `bun run format`       | Format with Biome (writes)                             |
| `bun run format:check` | Check formatting without writing                       |
| `bun run astro check`  | Type checking (strict tsconfig)                        |

`bun dev` and `bun run build` first run `scripts/prebuild.ts`, which syncs the self-hosted Umami tracker and downloads a random cat photo for the homepage; both steps fall back to committed assets when offline.

## Layout of the repo

```
src/
├── consts.ts            # Central config: SITE, NAVIGATION, SOCIALS, feeds…
├── content/             # Collections: blog, authors, friends
│   └── blog/<slug>/     # index.md + sibling subposts + colocated assets/
├── components/          # .astro components (markup + scoped styles)
├── layouts/Layout.astro # Single shared layout, imports all styles
├── lib/                 # Markdown plugins, content helpers
│   └── client/          # Browser-side code for the live feeds
│       ├── feed.ts      # sessionStorage cache, fetch timeout, safeHttpUrl
│       ├── heatmap.ts   # Shared fit-to-width activity heatmap renderer
│       ├── tokens.ts    # Pure data layer for /tokens (tested)
│       └── tokens-dashboard/ # /tokens runtime controller + renderers
├── pages/               # Routes, incl. og image endpoint
└── styles/              # Cascade-ordered global CSS
scripts/                 # prebuild, OG font subsetting, link check
```

## Content

A post is either a bare `src/content/blog/your-post.md` or a folder with an `index.md`. Sibling `.md` files inside a post folder are **subposts**: the whole folder renders as one continuous series with a unified table of contents, while every part keeps its own URL. Prefix a file or folder with `_` to hide it from the loader.

Frontmatter: `title`, `description`, `date`, `authors` are required; `updatedDate`, `order`, `tags`, `image`, `draft`, `mermaid` are optional. `mermaid: true` opts a post into client-side Mermaid rendering for its ```` ```mermaid ```` fences.

Markdown extras: `:::note[Title]` GitHub-style callouts, `$…$`/`$$…$$` math rendered at build time, and inline code highlighting via `` `code{:lang}` `` annotations.

## Live pages

`/misc` (Letterboxd films, Koito listening stats), `/memos` (Mastodon), and `/tokens` (AI token-usage dashboard fed by a self-hosted collector) fetch their data **client-side at runtime** with skeleton loading, a shared sessionStorage cache, payload validation before caching, and graceful fallbacks.

## CI

Every push runs formatting, type checking, unit tests, the production build, and a static internal-link check over the output (`.github/workflows/ci.yml`, actions pinned to commit SHAs). Dependabot keeps the pinned actions and bun dependencies current.

## License

[MIT](LICENSE). Based on [astro-erudite](https://github.com/jktrn/astro-erudite) by [enscribe](https://enscribe.dev).
