# lkwplus.com

Source of my homepage and blog, [lkwplus.com](https://lkwplus.com). Built with [Astro](https://astro.build/) from a heavily reworked [astro-erudite](https://github.com/jktrn/astro-erudite) v2: no UI or CSS framework, just native CSS and custom elements.

- **Markdown** goes through [Sätteri](https://satteri.bruits.org/) (Rust) with its own plugins in `src/lib/markdown/`: callouts, steps, file trees, MathML math via Temml, Expressive Code, Mermaid. No remark/rehype.
- **Styles** are hand-written CSS in cascade layers, colours from [Radix Colors](https://www.radix-ui.com/colors), spacing from [Utopia](https://utopia.fyi/), fonts subset to what the site uses.
- **Live sections** (Now on the home page, `/misc`, `/tokens`, `/memos`) load at runtime from [cf-workers-api](https://github.com/synthpop123/cf-workers-api), one Cloudflare Worker that serves each feed as a versioned snapshot. Pages cache it in localStorage and revalidate on every visit.

## Development

Needs [bun](https://bun.sh/) and Node ≥ 22.12.

```bash
bun install
bun dev              # http://localhost:4321
bun run build        # astro check + build to dist/
bun test             # unit tests
bun run check:links  # internal-link check over dist/
bun run format       # Biome, format only
```

`bun dev` and `bun run build` first run `scripts/prebuild.ts` (analytics script and homepage cat), which works offline.

Pushing to `main` deploys to Cloudflare Workers. [`CLAUDE.md`](CLAUDE.md) documents the architecture in detail.

## Writing

A post is `src/content/blog/<slug>/index.md` with its images in `assets/`. Other `.md` files in that folder are parts of a series, rendered as one page. A leading `_` hides a file or folder.

Frontmatter needs `title`, `description`, `date` and `authors`; `updatedDate`, `order`, `tags`, `image`, `draft`, `mermaid`, `ai` and `lang` are optional. Every post is also served as Markdown at `/blog/<slug>.md`, indexed by `/llms.txt`.

## License

Code is [MIT](LICENSE), based on astro-erudite by [enscribe](https://enscribe.dev). Posts in `src/content/` are [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/).
