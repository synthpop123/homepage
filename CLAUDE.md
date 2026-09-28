# CLAUDE.md

Guidance for coding agents in this repository (`AGENTS.md` is a symlink to this file).

## Overview

Personal homepage/blog (lkwplus.com) on the `astro-erudite` v2 template: Astro 7, **no UI framework and no CSS framework** — native CSS with autonomous custom elements and Utopia fluid scales. Package manager is **bun**; Node >= 22.12.0.

## Commands

```bash
bun dev              # Dev server at http://localhost:4321
bun run build        # astro check + build to dist/
bun run preview      # Preview the production build
bun test             # Unit tests (src/lib/**/*.test.ts, bun:test)
bun run check:links  # Internal-link check over dist/ (build first)
bun run format       # Biome format (writes); format:check to verify
bun run astro ...    # Astro CLI (e.g. `bun run astro check`)
```

`bun dev`/`bun run build` first run `scripts/prebuild.ts`: it syncs the self-hosted Umami tracker into `public/headache.js` and downloads a random cat to `src/assets/cat.jpg` (both gitignored, non-fatal offline: they fall back to `src/assets/headache-fallback.js` / `cat-fallback.jpg`).

**Checks.** No linter — Biome is format-only (double quotes, semicolons as-needed, 2-space indent, 80 cols). CI (`.github/workflows/ci.yml`, actions pinned to SHAs) runs format:check, `bun test`, build (`astro check` with the strict tsconfig, then the build) and `check:links` (which also flags `[](…)` targets in the `.md` artifacts that still point into the source tree). `bun run build` runs `astro check`, which skips the vendored tracker (`public/`, `headache-fallback.js`). `.githooks/pre-commit` formats staged files (installed by `prepare` on `bun install`). `@astrojs/check` needs TypeScript 6 — don't bump `typescript@^6` to 7 until the native compiler exposes the programmatic API.

**Deploy.** A static-assets-only Cloudflare Worker (`wrangler.jsonc`, custom domain `lkwplus.com`) via Workers Builds, so **pushing to `main` is the deploy**. `trailingSlash: "never"` + `html_handling: "drop-trailing-slash"`: links, canonicals and the sitemap all name `/about`. `public/_headers` sets baseline security headers (HSTS without subdomains, nosniff, Referrer-/Permissions-Policy, a CSP of `frame-ancestors`/`base-uri`/`object-src` only) and marks `/_astro/*` immutable; `public/_redirects` holds the old URLs and turns the 307 of a trailing slash into a 301. Neither runs under `bun dev`: the `worker` config in `.claude/launch.json` (`wrangler dev`, port 8787) serves `dist/` the way Cloudflare does.

**Fonts are subset.** `src/assets/fonts/Geist*-Variable.woff2` cover Latin through Latin Extended-A, punctuation, arrows, maths, box drawing (mono) and every character in content and source — no Cyrillic/Greek/Vietnamese. The `wght` axis is cut to **400–600** (Geist) and **400–700** (Geist Mono); the `@font-face` ranges in `fonts.css` match, so a weight outside them clamps. To widen weights or add a script, change both and re-run `bun scripts/subset-fonts.ts` (re-subsets from the full fonts pinned in git history). `STIXTwoMath-Regular.woff2` (MathML) is cut by range — Latin, Greek, operators, arrows, delimiters and the italic/bold/double-struck/script/sans/mono alphabets — by the same script. Likewise `src/assets/fonts/og/` (Noto Sans SC for OG images: GB2312 + kana + every content character): a title with a new character needs `bun scripts/subset-og-fonts.ts`.

## Architecture

- **`src/consts.ts`** is the personalization surface: `SITE`, `NAVIGATION`, `SOCIALS`, feed endpoints (`API`, `MISC`, `NOW`, `MEMOS`, `TOKENS`, …), `FLIGHTS`, `USES`. Edit there before touching components.
- Path alias `@/*` → `./src/*`.
- One shared layout, `src/layouts/Layout.astro`, which imports every stylesheet in cascade order.

### Markdown pipeline

No remark/rehype. Markdown goes through **Sätteri** (Rust) configured in `astro.config.ts` with `syntaxHighlight: false`. Add a feature as a `defineMdastPlugin`/`defineHastPlugin` in `src/lib/` and register it in `astro.config.ts`:

- mdast: `callout.ts` (`:::note[Title]`), `math.ts` (`$…$`/`$$…$$` → MathML via **Temml**), `expressive-code/inline.ts` (`` `code{:lang}` ``), `mermaid.ts`.
- hast: `external-links.ts`, `asides.ts`, expressive-code blocks, `heading-namespace.ts` (subpost-scoped ids), `heading-anchors.ts`.

Astro caches rendered posts in `node_modules/.astro/data-store.json`, invalidated only when a post or `astro.config.ts` changes — **after editing a plugin's own file, delete that cache before building** (with the dev server stopped: it empties the collections under a running one) or old HTML ships.

- **Asides** (`asides.ts`, pure half `wrapAsides` tested): wraps each outermost balanced `( … )`/`（ … ）` in prose in `span[data-aside]`, dimmed to `--prose-aside`. Skips pairs split across element boundaries, unbalanced ones, a half-width `(` right after a letter/digit (`f(x)`), and code/`pre`/`kbd`/maths/SVG/headings.
- **External links** get a trailing `span[data-site-icon]`: the host's Simple Icons logo (`SITE_ICONS` in `site-icons.ts`, matching subdomains too; SVGs in `src/assets/icons/sites/` with `<title>` stripped) or a generic arrow, drawn by CSS `mask` in `site-icons.css`, glued to the link's last word with `span[data-glue]`. Each slug needs both the SVG and a CSS rule — the build fails on a missing file and `site-icons.test.ts` checks both.
- **Code blocks**: Expressive Code via `satteri-expressive-code`, with its page-wide CSS/JS stripped from the blocks and served instead by the `expressiveCodeAssets` Vite plugin as `virtual:expressive-code.css`/`.js`, which `[...id].astro` imports (one hashed, cached file for every post).
- **Mermaid** only with `mermaid: true` frontmatter: the plugin turns fences into `<pre class="mermaid">` and `[...id].astro` loads `Mermaid.astro` (any post in a series opting in loads it for the page); otherwise fences stay code. The renderer is imported only when a diagram nears the viewport.

### Content

Collections in `src/content.config.ts`: `blog`, `authors`, `friends`, globbed with `**/[^_]*.md` — **a `_` prefix hides a file or folder**.

- A post is `src/content/blog/<slug>/index.md` with colocated `assets/`. Sibling `.md` files are **subposts** (`isSubpost(id)` = id contains `/`), rendered with the parent as one continuous series page with one table of contents (`src/pages/blog/[...id].astro`). `src/lib/content.ts`: `getPosts()` (top-level, drafts filtered), `getSubposts()` (ordered by `order`, then date), `getTags()`. The sitemap excludes subposts and tag pages.
- Frontmatter: `title`, `description`, `date`, `authors` required; `updatedDate`, `order`, `tags`, `image`, `draft`, `mermaid`, `ai`, `lang` optional.
- **`lang`** (BCP 47): when absent, `postLang()` infers it with `detectLang()` (`src/lib/lang.ts`, tested) — mostly-Han prose is `zh-CN`, else `SITE.locale`. A post page's `<html lang>` is its parent's; English chrome on it (skip link, nav, footer, byline, tags) carries `lang` back to `SITE.locale`. On English pages post titles carry `titleLang()`.
- **`/blog/<id>.md`** (`[...id].md.ts`, `postMarkdown`) serves each entry's reconstructed frontmatter + body, with `./assets/…` rewritten to published URLs through a **lazy** `import.meta.glob` + `getImage()` with no options (the same transform the page requests, so no duplicate asset; eager would ship every colocated image). `CopyMarkdown.astro` copies it (prefetched on hover/focus so the clipboard write stays inside the click's activation); `MetaPost.astro` links it as `rel="alternate"`; `/llms.txt` indexes these, `/llms-full.txt` concatenates them, and `/rss.xml` renders the same body (`postBody`) to full-text HTML with only feed-safe plugins (`feedCallouts`, Temml; no Expressive Code) through `feedHtml()` (`src/lib/feed-html.ts`, tested), which absolutizes URLs.
- **`ai: true`** puts a Claude-mark co-author in the byline (`Byline.astro`): a `title` tooltip in lists, a `popover="auto"` note in the post header, anchored with CSS anchor positioning (`id`/`anchor-name` unique per article, since a series renders several). Write `popover="auto"`, never bare `popover` — Astro renders it as `popover="true"`, an invalid value that falls back to manual (no light-dismiss).
- The post header: byline row (author, `PostDates.astro`, Copy Markdown chip), then tags on a row of their own (`PostTags.astro`).
- `TableOfContents.astro`: one `--progress` property drives both the desktop and mobile progress rings; several entries may carry `data-active`, only the first gets `aria-current="location"`. It drops entries whose target section is `hidden`.

### Styling

Hand-written CSS in `src/styles/*.css`.

- **Radix Colors** scales as `light-dark()` pairs behind semantic tokens (`--background`, `--foreground`, …) in `color.css`; derived tints via `color-mix(in oklab, …)`. Text never fades below `--faint-foreground` (4.5:1 in both schemes); lighter mixes are for decoration only. `--ring` is gray-10 for 3:1.
- **Utopia** `--step-*` (type) and `--space-*` (space) tokens — use them, not raw px/rem.
- **Autonomous custom elements** (`<page-grid>`, `<post-meta>`, `<movies-feed>`, …) styled by element selector. Component styles live in the `.astro` `<style>`; anything that reaches runtime-built DOM needs `:global()` or an `is:global` block nested under the element.
- Index pages open with `PageTitle.astro` (the h1); compact post lists are `PostList.astro` (home, 404).
- Theme: `ThemeToggle.astro` switches with transitions off for one style pass (a transitioning `light-dark()` colour otherwise keeps the old scheme), and landing on the system's scheme clears the stored choice. `MetaHead.astro` keeps `theme-color` in step.
- Images use `image.layout: "constrained"` (Markdown ones too) with `responsiveStyles: false`: srcsets everywhere, layout CSS ours.
- 12-column grid (sidebar / content / TOC) collapsing to one column below `64rem`, where the sidebar becomes a top bar showing only the logo and nav.
- `reset.css` blockifies `svg`, so anything mixing an icon and text on one line must be `inline-flex`.
- Page transitions are CSS-only cross-document view transitions (`layout.css`, under `prefers-reduced-motion: no-preference`); no `ClientRouter`, so every navigation is a full load. The sidebar (`view-transition-name: sidebar`) swaps without animating.
- Container queries are used only where the column's width diverges from the viewport's (sidebar and TOC eat into it between 64rem and 76rem): Uses, the Movies wall, the home Now bento.

## Live data

Every live section reads **cf-workers-api** (sibling repo `../cf-workers-api`), one Worker at `https://api.lkwplus.com` (`API`). Each service serves a precomposed snapshot at `/<service>/site` (open CORS, `no-cache` + ETag → cheap 304s). None of it is build-time data.

- **`/misc` loads its four feeds from one `GET /misc`** → `{flights, movies, music, switch}`, each a service's `/site` body or `null`. `miscSection()` (`src/lib/client/misc.ts`) memoizes the fetch; each component still decodes and caches its own section, and a `null` fails only that section. Pages preload their endpoint (`<link rel="preload" as="fetch" crossorigin>`).
- **`swr()`** (`src/lib/client/feed.ts`) is the one load path: paint any cached copy from **localStorage** (any age), always refetch, deliver both to the same idempotent renderer. Payloads are validated before caching and before use (a bad one goes to the fallback). Cache keys carry the schema version (`tokens:site:v15:…`) and a write sweeps other versions of the same feed. `feed.ts` also holds the day/time helpers every feed shares — `dayInstant()` (a calendar day as noon UTC), `shiftDays`, `daysBetween`, `monthDay`, and `relativeTime()`, the one "3m ago" (whole units rounded down) — the decoder primitives (`isRecord`, `isCount`, `isCalendarDay`), `fetchJson` with timeout, `safeHttpUrl()` — the trust boundary for every remote href/image URL — and `calendarDay()` (today in Asia/Shanghai).
- **`keepFresh({ tick, reload })`** (`feed.ts`) is the one clock: `tick` every minute while visible and on tab return, for anything relative to now ("3m ago", Online, countdowns); `reload` every 5 min and at midnight. Nothing else runs `setInterval`. A cached payload can be days old, so text that says "today" compares against `calendarDay()`, never the payload's `today` alone.
- **Versioned contracts.** Every payload carries `schemaVersion`; each decoder (`isSite`) accepts only its `SITE_SCHEMA_VERSION` and is pinned by a captured `*.site-fixture.json` + test, mirrored producer-side in cf-workers-api (`SITE_VERSION`). On a shape change, bump both and refresh the fixture from the live endpoint: **the worker ships first**, and the page shows its fallback for the minutes in between.
- **Layering** (every feed): the `.astro` component owns markup, skeletons and styles; `src/lib/client/<feed>.ts` (or `tokens/`) is the pure, DOM-free, unit-tested data layer where every render *decision* and every printed string lives; `src/lib/client/<feed>-feed/` (`tokens-dashboard/` for Tokens) is the runtime — `index.ts` mounts and loads via `swr`, `render.ts` etc. build DOM with `el()` (`src/lib/client/dom.ts`). Renderers are `replaceChildren`-idempotent.
- **Readouts** (`dl.readout`, `feed.css`) are the shared summary grid (Music, Switch, Flights, Tokens): two or four cells across, never three. Set figures with `setReadout()` (`readout.ts`), never `textContent` — it splits number/unit runs, counts up, and is a no-op for an unchanged figure, which keeps SWR repaints still.
- **Heatmap**: `Heatmap.astro` owns markup, palette and the `--heat-cell`/`--heat-gap` geometry; `heatmap.ts` (`mountHeatmap`) renders to fit width. Its `days` must be dense and chronological — the caller's job (`heatmapWindow()` pads Switch). `<Heatmap selectable />` makes cells a picker (Tokens): `stepDay()` maps arrows to the grid's axes (up/down a day, left/right a week) and the pick is announced through a hidden `role="status"`.
- **Skeletons** reserve the loaded height exactly (one per row the list will fill), since anything shorter shifts the page when data lands. `SKELETON_ROWS` (`src/lib/utils.ts`) is only for feeds of unknown length (Memos, Tokens devices).
- **Lightbox** (`Lightbox.astro`, `lightbox.ts`): PhotoSwipe, code-split and loaded on first click (its CSS too, as a `?url` link: a dynamic CSS import would be hoisted into a blocking stylesheet); zooms bare `prose-content` images, `post-banner` and `.memo-shot` (a multi-image memo is one gallery). The mount makes bare images keyboard buttons (Enter/Space); PhotoSwipe traps and returns focus. Used on post pages and `/memos`.

### Pages and sections

- **Home** (`index.astro`): Profile, Writing (three latest posts, build-time) and **Now** (`Now.astro`, `/now/site`, logic in `now.ts`): a bento of the latest listen (record half out of its `.sleeve`, shared with Music; `vinyl.ts` pauses it off screen), the latest film (poster behind a background-coloured veil so it doesn't dominate; lifts on hover), tokens today and the last flight. The listen and tokens tiles carry faint cropped Spotify and Claude marks as backdrops. Tile sizes come from the grid, never from content; a failed load with nothing cached hides the section.
- **`/misc`**: each `h2` is a `SectionHead.astro` with its one source link (`.section-link`, no underline — the owner's call). Sections:
  - **Flights** (`Flights.astro`, `flights.ts`, `flights-feed/`): the payload is the map, not the log (airports, merged routes, airline/aircraft tallies, totals, and `last` for the home tile — never a flight number or time). **Flat SVG, not a globe**: d3-geo conic conformal fitted to the airports, redrawn on resize; basemaps in `src/assets/flights/` (`asia.json` preloaded, `world-110m.json` fetched only when a frame leaves the region) are written by `bun scripts/flights-basemap.ts` — re-run it when a flight lands somewhere new. Lists show `FLIGHTS.routes`/`FLIGHTS.named` rows and fold the rest (`fold()`).
  - **Movies**: Letterboxd diary as a poster wall (posters mirrored to `img.lkwplus.com`).
  - **Music**: Koito stats, heatmap and last listens; `/misc` asks for 11 (a lead + two even columns of ten), matching `LISTENS` in cf-workers-api.
  - **Switch**: catalog ranked by lifetime play time, each row a bar with the recent share in the heatmap's green. Playtime is time in games (the worker's `daily_games`), not console time. Prices/titles come from the worker.
  - **Uses** (`Uses.astro`): static `USES` from `consts.ts`, grouped by where things live; icons are a `Record<UsesIcon, …>` of vendored Lucide SVGs, so a missing icon fails the build.
- **`/memos`** (`Memos.astro`, `memos.ts`, `memos-feed/`): latest Mastodon statuses from `/memos/site` as a year-grouped thread. Status HTML is Mastodon's own, so `memos-feed/sanitize.ts` (allow-list, needs `DOMParser`) is the security boundary; every URL goes through `safeHttpUrl`.
- **`/tokens`** (`Tokens.astro`, `tokens/`, `tokens-dashboard/`, styles in `src/styles/tokens/`): AI token-usage dashboard — Quota, Activity (heatmap doubles as day picker for the day panel), overview/trend/breakdowns, Patterns, Devices.
  - The service owns model/provider id mapping; the page never guesses a vendor from a model name (it reads `byModel[].providers`).
  - Quota cards are *reported* data and must admit their age: per-card `capturedAt`, stale reset windows show `awaiting report` rather than a stale percentage, times shown in **Asia/Shanghai** (the collector's zone, which buckets every calendar day). The section re-renders every minute.
  - `PLACEHOLDER_IDS` (`unknown`, `<synthetic>`) are dropped everywhere, so shares may not sum to 100%.
  - Device kinds (backdrop icons) come from `TOKENS.devices` in `consts.ts`; the payload has no hardware info.
  - Decoded but deliberately not drawn: `extraUsage`, `mcpServers`.
  - Styles: one file per renderer module, all nested under `tokens-dashboard` (runtime DOM), **import order matters** — `shared.css` last, since its skeleton rules must win ties. Skeletons here are sized to the real payload (the quota card is above the fold).
  - AI brand icons are Lobe Icons mono SVGs in `src/assets/icons/ai/` (`aiIcon()`), `<title>` stripped — a nested `<title>` would shadow the row's own tooltip.
- **`/about`**: build-time blog stats (CJK-aware word count) in `about.astro`'s frontmatter.
