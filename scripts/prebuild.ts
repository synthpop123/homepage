/**
 * Runs before `astro dev` / `astro build` (wired up in package.json).
 *
 * 1. Syncs the self-hosted Umami tracker script into public/headache.js.
 * 2. Downloads a random cat from cataas.com into src/assets/cat.jpg
 *    (gitignored), so the homepage ships a build-time snapshot instead
 *    of hitting cataas on every visit.
 *
 * Both steps degrade gracefully: on network failure the previously
 * committed/downloaded file (or the committed fallback cat) is kept, so
 * offline builds and CI never break.
 */
import { copyFileSync, existsSync, writeFileSync } from "node:fs"
import path from "node:path"
import sharp from "sharp"

const root = process.cwd()

// Keep in sync with UMAMI.hostUrl in src/consts.ts.
const UMAMI_SCRIPT_URL = "https://umami.lkwplus.com/script.js"
const UMAMI_DEST = path.join(root, "public/headache.js")

const CAT_URL = "https://cataas.com/cat"
const CAT_DEST = path.join(root, "src/assets/cat.jpg")
const CAT_FALLBACK = path.join(root, "src/assets/cat-fallback.jpg")

const fetchWithTimeout = (url: string, ms = 15_000) =>
  fetch(url, { signal: AbortSignal.timeout(ms) })

async function syncUmami() {
  try {
    const response = await fetchWithTimeout(UMAMI_SCRIPT_URL)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const script = await response.text()
    if (!script.trim()) throw new Error("empty response")
    writeFileSync(UMAMI_DEST, script)
    console.log(`[prebuild] umami: synced ${UMAMI_SCRIPT_URL}`)
  } catch (error) {
    console.warn(`[prebuild] umami: sync failed (${error}), keeping existing`)
  }
}

async function syncCat() {
  try {
    const response = await fetchWithTimeout(CAT_URL)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const raw = Buffer.from(await response.arrayBuffer())
    // Normalize whatever cataas returns (jpeg/png/gif/webp) to a bounded jpeg.
    const jpeg = await sharp(raw, { animated: false })
      .rotate()
      .resize({ width: 1600, withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer()
    writeFileSync(CAT_DEST, jpeg)
    console.log(`[prebuild] cat: downloaded a fresh cat (${jpeg.length}B)`)
  } catch (error) {
    if (existsSync(CAT_DEST)) {
      console.warn(`[prebuild] cat: fetch failed (${error}), keeping previous`)
    } else {
      copyFileSync(CAT_FALLBACK, CAT_DEST)
      console.warn(`[prebuild] cat: fetch failed (${error}), using fallback`)
    }
  }
}

await Promise.all([syncUmami(), syncCat()])
