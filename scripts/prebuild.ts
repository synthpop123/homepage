/**
 * Runs before `astro dev` / `astro build` (wired up in package.json).
 *
 * 1. Syncs the self-hosted Umami tracker script into public/headache.js
 *    (gitignored, like cat.jpg below).
 * 2. Writes the homepage cat to src/assets/cat.jpg (gitignored): the
 *    committed src/assets/cat-default.jpg, or the image named by the
 *    CAT_IMAGE env var (an http(s) URL or a local path) to override it
 *    for one build/deploy.
 *
 * Both steps degrade gracefully: on network failure the committed
 * fallback (src/assets/headache-fallback.js) or previous tracker is
 * used, and an unreadable CAT_IMAGE falls back to the default cat, so
 * offline builds and CI never break.
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import sharp from "sharp"
// Runs under bun, which resolves the tsconfig path alias and the svg
// imports inside consts.ts (file loader), so the tracker config has a
// single source of truth.
import { UMAMI } from "../src/consts"

const root = process.cwd()

const UMAMI_SCRIPT_URL = `${UMAMI.hostUrl}/script.js`
const UMAMI_DEST = path.join(root, "public", UMAMI.src)
const UMAMI_FALLBACK = path.join(root, "src/assets/headache-fallback.js")

const CAT_SOURCE = process.env.CAT_IMAGE?.trim()
const CAT_DEST = path.join(root, "src/assets/cat.jpg")
const CAT_DEFAULT = path.join(root, "src/assets/cat-default.jpg")

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
    if (existsSync(UMAMI_DEST)) {
      console.warn(`[prebuild] umami: sync failed (${error}), keeping previous`)
    } else {
      copyFileSync(UMAMI_FALLBACK, UMAMI_DEST)
      console.warn(`[prebuild] umami: sync failed (${error}), using fallback`)
    }
  }
}

async function readCatSource(source: string) {
  if (!/^https?:\/\//.test(source)) return readFileSync(path.resolve(source))
  const response = await fetchWithTimeout(source)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

async function syncCat() {
  if (CAT_SOURCE) {
    try {
      const raw = await readCatSource(CAT_SOURCE)
      // Normalize whatever the override is (jpeg/png/gif/webp) to a bounded jpeg.
      const jpeg = await sharp(raw, { animated: false })
        .rotate()
        .resize({ width: 1600, withoutEnlargement: true })
        .jpeg({ quality: 82 })
        .toBuffer()
      writeFileSync(CAT_DEST, jpeg)
      console.log(`[prebuild] cat: using CAT_IMAGE ${CAT_SOURCE}`)
      return
    } catch (error) {
      console.warn(`[prebuild] cat: CAT_IMAGE failed (${error}), using default`)
    }
  }
  copyFileSync(CAT_DEFAULT, CAT_DEST)
}

await Promise.all([syncUmami(), syncCat()])
