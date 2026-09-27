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
| `bun run build`        | Type-check and build the production site to `dist/`    |
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
├── layouts/Layout.astro # Single shared layout, imports all styles, skip link
├── lib/                 # Markdown plugins, content helpers
│   └── client/          # Browser-side code for the live feeds
│       ├── feed.ts      # Web Storage cache (cached/swr), decoders, safeHttpUrl
│       ├── misc.ts      # One shared GET /misc request for the /misc sections
│       ├── heatmap.ts   # Shared fit-to-width activity heatmap renderer
│       ├── flights.ts, movies.ts, music.ts, switch.ts  # Decoders (tested)
│       ├── memos.ts     # Pure data layer for /memos (tested)
│       ├── memos-feed/  # /memos runtime controller + sanitizer
│       ├── tokens/      # Pure data layer for /tokens (tested)
│       └── tokens-dashboard/ # /tokens runtime controller + renderers
├── pages/               # Routes, incl. og image endpoint
└── styles/              # Cascade-ordered global CSS
scripts/                 # prebuild, OG font subsetting, link check
```

## Content

A post is either a bare `src/content/blog/your-post.md` or a folder with an `index.md`. Sibling `.md` files inside a post folder are **subposts**: the whole folder renders as one continuous series with a unified table of contents, while every part keeps its own URL. Prefix a file or folder with `_` to hide it from the loader.

Frontmatter: `title`, `description`, `date`, `authors` are required; `updatedDate`, `order`, `tags`, `image`, `draft`, `mermaid`, `ai` are optional. `mermaid: true` opts a post into client-side Mermaid rendering for its ```` ```mermaid ```` fences. `ai: true` marks a post as AI-assisted: the byline on the post and its list card adds an AI co-author ("lkw123 with AI"), and on the post it opens a short note.

Every post also serves its own source at `/blog/<id>.md` — reconstructed frontmatter plus the source body, with colocated asset URLs normalized to their published locations — which is what the post header's **Copy Markdown** control copies and links to. `/llms.txt` indexes those files, `/llms-full.txt` is all of them in one document.

Markdown extras: `:::note[Title]` GitHub-style callouts, `$…$`/`$$…$$` math rendered at build time, and inline code highlighting via `` `code{:lang}` `` annotations.

## Live pages

Several pages fetch their data **client-side at runtime**; none of it is build-time data.

- `/misc`: Flights (AirTrail routes on a globe), Movies (Letterboxd diary), Music (Koito listening stats) and Switch (Nintendo play time), all loaded from one `GET /misc` request, plus a static Uses section.
- `/tokens`: an AI token-usage dashboard with subscription quotas, a daily activity heatmap and breakdowns.
- `/memos`: Mastodon statuses, read from the Mastodon API directly.

Everything except `/memos` comes from [cf-workers-api](https://github.com/synthpop123/cf-workers-api), a single Cloudflare Worker at `api.lkwplus.com` that serves each feed as a precomposed, versioned snapshot (`/<service>/site`). Each payload carries a `schemaVersion` that the page's decoder checks strictly, pinned by a captured fixture and a contract test; on a shape change the Worker ships first and this repo follows.

Those feeds use stale-while-revalidate: any cached copy in localStorage paints immediately, the request always goes out, and the Worker answers `304` when nothing changed. `/memos` uses a 60-second sessionStorage cache instead. Every payload is validated before it is cached or rendered, and each section has sized skeletons and its own fallback.

## CI

Every push runs formatting, type checking, unit tests, the production build, and a static internal-link check over the output (`.github/workflows/ci.yml`, actions pinned to commit SHAs).

## License

[MIT](LICENSE). Based on [astro-erudite](https://github.com/jktrn/astro-erudite) by [enscribe](https://enscribe.dev).
