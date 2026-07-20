# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Personal homepage/blog (lkwplus.com) built on the `astro-erudite` v2 template: Astro 7, **no UI framework and no CSS framework** — native CSS with autonomous custom elements and Utopia fluid scales. Package manager is **bun** (`bun.lock`); Node >= 22.12.0.

## Commands

```bash
bun dev              # Dev server at http://localhost:4321
bun run build        # Build static site to dist/
bun run preview      # Preview the production build
bun test             # Unit tests (src/lib/client/*.test.ts, bun:test)
bun run check:links  # Static internal-link check over dist/ (build first)
bun run format       # Format with Biome (writes)
bun run format:check # Check formatting without writing
bun run astro ...    # Astro CLI (e.g. `bun run astro check`)
```

`bun dev` and `bun run build` first run `scripts/prebuild.ts`, which syncs the self-hosted Umami tracker into `public/headache.js` and downloads a random cat photo to `src/assets/cat.jpg` (both gitignored; they fall back to the committed `src/assets/headache-fallback.js` / `src/assets/cat-fallback.jpg` when offline). Both steps are non-fatal on network failure.

`src/assets/fonts/og/` holds **subset** Noto Sans SC woffs for build-time OG rendering (all GB2312 hanzi + kana + punctuation + every character in current content). If a new post title needs a character outside that set, re-run `bun scripts/subset-og-fonts.ts` — it re-subsets from the pristine full fonts pinned in git history, so it is safe to run repeatedly.

There is **no linter** — Biome runs format-only (linter and assist disabled in `biome.json`). The automated checks are formatting (`bun run format:check`), type checking (`bun run astro check`, strict tsconfig), unit tests (`bun test`, covering the pure data helpers in `src/lib/client/`), and a post-build internal-link check (`bun run check:links`, `scripts/check-links.ts` — verifies every internal href/src/srcset and `#fragment` in `dist/`); CI (`.github/workflows/ci.yml`, actions pinned to SHAs, Dependabot keeps them and bun deps fresh) runs all of them. `@astrojs/check` requires TypeScript 6.x — the pinned `typescript@^6` devDependency must not be bumped to 7 until the native compiler exposes the programmatic API. A `.githooks/pre-commit` hook formats staged files via Biome on every commit (installed by the `prepare` script on `bun install`; bypass once with `git commit --no-verify`). Biome style: double quotes, semicolons as-needed, 2-space indent, 80 cols.

## Architecture

**Central config — `src/consts.ts`.** The personalization surface. Exports `SITE`, `NAVIGATION`, `SOCIALS`, `GLOBE_LOCATIONS` (Globe pins on `/misc`), and `PROFILE_TABS` (the multi-language code tabs on the homepage). Edit here before touching components.

**Path alias:** `@/*` → `./src/*`.

### Markdown pipeline (the non-obvious part)

This site does **not** use remark/rehype. Markdown is processed by **Sätteri** (a Rust processor) configured in `astro.config.ts` with `syntaxHighlight: false`. Custom transforms live in `src/lib/` and come in two kinds, both registered in `astro.config.ts`:

- **mdast plugins** (`defineMdastPlugin` from `satteri`) operate on the Markdown AST → `callout.ts` (`:::note` GitHub-style callouts), `math.ts` (`$…$`/`$$…$$` → MathML via **Temml**, not KaTeX), `expressive-code/inline.ts` (inline `` `code{:lang}` ``).
- **hast plugins** (`defineHastPlugin`) operate on the HTML AST → `external-links.ts`, `expressive-code` block rendering, `heading-namespace.ts` (subpost-scoped heading IDs), `heading-anchors.ts` (clickable `#` permalinks).

When adding a Markdown feature, write a `define{Mdast,Hast}Plugin` and add it to the corresponding array in `astro.config.ts` — do not reach for unified/remark packages.

**Code blocks** use Expressive Code via `satteri-expressive-code`. `src/lib/expressive-code/render.ts` exposes `renderCodeBlocks()` so code can be rendered **outside** Markdown (used by `CodeTabs.astro` and the homepage `PROFILE_TABS`), reusing the same theme/renderer as blog posts.

### Content collections (`src/content.config.ts`)

Three glob collections: `blog`, `authors`, `friends`. The glob pattern `**/[^_]*.md` means **any file or folder prefixed with `_` is ignored** (use for drafts/partials).

**Posts and subposts/series** is the key convention:
- A post is a folder under `src/content/blog/<slug>/` containing `index.md` (the parent), plus a colocated `assets/` dir for images (`image: ./assets/…`).
- Sibling `.md` files in that folder are **subposts**. `isSubpost(id)` (in `src/lib/utils.ts`) = the id contains a `/`.
- Subposts form a **series** rendered as one continuous scrollable document. `src/lib/content.ts` provides `getPosts()` (top-level only), `getSubposts()` (grouped by parent, ordered by `order` frontmatter then date), and `getTags()`.
- The route `src/pages/blog/[...id].astro` builds the parent + subpost chain into a single page with a unified table of contents. The sitemap filter in `astro.config.ts` excludes subpost URLs and tag pages.

Blog frontmatter: `title`, `description`, `date`, `authors` (refs into the `authors` collection) are required; `tags`, `image`, `order`, `draft`, `mermaid` optional. `draft: true` posts are filtered out by `getPosts`. `mermaid: true` opts a post into Mermaid diagrams: it makes the `mermaid.ts` mdast plugin turn ```` ```mermaid ```` fences into `<pre class="mermaid">` and gates the client-side `Mermaid.astro` script in `src/pages/blog/[...id].astro` (any post in a series chain opting in loads it for the whole page); without the flag, fences render as plain code blocks.

### Styling

All CSS is hand-written in `src/styles/*.css` and imported, in cascade order, at the top of `src/layouts/Layout.astro` (single shared layout). Conventions:
- **Radix Colors** hex scales in `color.css`, each step a `light-dark()` pair behind semantic tokens (`--background`, `--foreground`, …); derived tints elsewhere use `color-mix(in oklab, …)`.
- **Utopia** fluid type/space scales: `--step-*` (font sizes) and `--space-*` (spacing). Use these tokens rather than hardcoded px/rem.
- **Autonomous custom elements as layout primitives** — `<page-grid>`, `<page-nav>`, `<post-meta>`, `<dictionary-entry>`, `<movies-feed>`, etc. are styled by element selectors, not class names. Component-local styles go in the `.astro` file's `<style>` block.
- The layout is a 12-column grid (sidebar / content / TOC) that collapses to a single column below `64rem`.

### Notable runtime behavior

`Movies.astro` (on `/misc`) fetches recent Letterboxd films **client-side at runtime** from an external embed endpoint, with skeleton loading and a fallback — it is not build-time data. `Music.astro` (also on `/misc`) does the same against the self-hosted Koito instance (`https://music.lkwplus.com`, public read API): all-time stats, a listen-activity heatmap, and the last played tracks. `Tokens.astro` (on `/tokens`) renders an AI-token-usage dashboard the same way from a single precomposed endpoint (`https://tokens.lkwplus.com/api/site`, open CORS, edge-cached 5 min) served by the sibling `tokens-worker` repo — which also owns the canonical model/provider id mapping (per-effort model variants and subscription-auth provider spellings like pi's `openai-codex` → `openai` merged server-side): range (7/30/90 days/all time) and metric toggles, stat cards with period-over-period deltas (computed client-side from the daily series), a composition bar, a trend chart stackable **by provider or by client** (segmented toggle in the chart footer; the API's daily series carries both slicings), a Mon–Sun "weekly rhythm" SVG line chart (average consumption per weekday, redrawn to container width via ResizeObserver), a 12-month heatmap, eight all-time fact cards (streaks, medians, models tried, CLI-tracked active time), expandable model/client/provider breakdowns with proportional row fills and usage-span tooltips (each row's `days`/`firstDate`/`lastDate` come from the API), and a device list with liveness plus CLI metadata (version, sessions, active time, MCP server names in the tooltip). One `[data-p]` brand palette drives bar segments and chips (clients inherit their vendor's hue via a shared `--p` custom property).

The Tokens code is layered: `Tokens.astro` owns markup, styles and skeletons only; the runtime controller is `src/lib/client/tokens-dashboard/` (`index.ts` mounts, reads control state, and dispatches to one renderer module per section — `overview.ts`, `trend.ts` (trend bars + weekly rhythm, each owning its tooltip), `activity.ts` (heatmap + fact cards), `breakdown.ts` (expandable lists), `devices.ts`, with shared DOM helpers in `dom.ts`); the pure data layer is `src/lib/client/tokens.ts` (`weekdayProfile`, `windowTotals`, `computeFacts`, `stackFor`, `activeTotals`, the `isSite` payload decoder, formatters — DOM-free and covered by `src/lib/client/tokens.test.ts`). The AI brand icons on breakdown rows are mono SVGs from [Lobe Icons](https://lobehub.com/icons) vendored under `src/assets/icons/ai/` (slug mapping in `aiIcon()`).

`Memos.astro` (on `/memos`) renders the Mastodon statuses (`MASTODON` in `consts.ts`, boosts/replies excluded) as a single flat list the same way: each entry puts an uppercase date label in a left rail column (linking to the original status, full timestamp on hover, folds above the content below `40rem`), with the sanitized content and a 1/2/3/4-up media grid with `srcset` from the attachment metadata on the right — a single image renders at a fixed max height with its width following the image's own ratio, so one shot never fills the column. It follows the Tokens layering — the pure data layer is `src/lib/client/memos.ts` (status → memo normalization on top of `safeHttpUrl`, custom-emoji tokenization, image/srcset selection; covered by `src/lib/client/memos.test.ts`), while the component script owns the DOM: rendering plus the allow-list HTML sanitizer (needs `DOMParser`) that keeps remote status HTML down to inline tags and http(s) links.

All four feeds share `src/lib/client/feed.ts`: the sessionStorage TTL cache (`cached()` validates payloads **before caching and before use** — a bad payload rejects into the feed's fallback UI), the fetch timeout, and `safeHttpUrl()`, the trust boundary that keeps remote-payload hrefs/image URLs (Letterboxd, Mastodon) from injecting non-http(s) URLs into the DOM. The GitHub-style activity heatmap is shared too: `Heatmap.astro` owns the markup, the green palette, and the `--heat-cell`/`--heat-gap` geometry (single source of truth — `src/lib/client/heatmap.ts` reads the computed values), and `heatmap.ts` owns the fit-to-width renderer (`mountHeatmap`) that Music and Tokens feed with their own level scales. `/about` shows build-time blog stats (posts, CJK-aware word count, tags, first-post year) computed in `about.astro`'s frontmatter.
