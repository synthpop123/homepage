# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Personal homepage/blog (lkwplus.com) built on the `astro-erudite` v2 template: Astro 6, **no UI framework and no CSS framework** — native CSS with autonomous custom elements and Utopia fluid scales. Package manager is **bun** (`bun.lock`); Node >= 22.12.0.

## Commands

```bash
bun dev              # Dev server at http://localhost:4321
bun run build        # Build static site to dist/
bun run preview      # Preview the production build
bun run format       # Format with Biome (writes)
bun run format:check # Check formatting without writing
bun run astro ...    # Astro CLI (e.g. `bun run astro check`)
```

There is **no test suite and no linter** — Biome runs format-only (linter and assist disabled in `biome.json`). The single automated check is formatting. A `.githooks/pre-commit` hook formats staged files via Biome on every commit (installed by the `prepare` script on `bun install`; bypass once with `git commit --no-verify`). Biome style: double quotes, semicolons as-needed, 2-space indent, 80 cols.

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
- **OKLCH** color tokens with light/dark theming in `color.css`.
- **Utopia** fluid type/space scales: `--step-*` (font sizes) and `--space-*` (spacing). Use these tokens rather than hardcoded px/rem.
- **Autonomous custom elements as layout primitives** — `<page-grid>`, `<page-nav>`, `<post-meta>`, `<dictionary-entry>`, `<movies-feed>`, etc. are styled by element selectors, not class names. Component-local styles go in the `.astro` file's `<style>` block.
- The layout is a 12-column grid (sidebar / content / TOC) that collapses to a single column below `64rem`.

### Notable runtime behavior

`Movies.astro` (on `/misc`) fetches recent Letterboxd films **client-side at runtime** from an external embed endpoint, with skeleton loading and a fallback — it is not build-time data.
