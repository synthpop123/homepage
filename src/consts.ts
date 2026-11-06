import type { SvgComponent } from "astro/types"
import Email from "@/assets/icons/email.svg"
import GitHub from "@/assets/icons/github.svg"
import RSS from "@/assets/icons/rss.svg"
import X from "@/assets/icons/x.svg"

export const SITE = {
  title: "lkw123",
  description: "Yet another salted fish.",
  locale: "en-US",
  dir: "ltr",
  defaultPageImage: "/og/site.png",
} as const

export const UMAMI = {
  src: "/headache.js",
  websiteId: "624e8690-7c02-424c-80c0-3a3480d9701e",
  hostUrl: "https://umami.lkwplus.com",
  performance: true,
} as const

/** `also`: other paths filed under the entry (the tags under Blog). */
export const NAVIGATION: { href: string; label: string; also?: string[] }[] = [
  { href: "/blog", label: "Blog", also: ["/tags"] },
  { href: "/memos", label: "Memos" },
  { href: "/tokens", label: "Tokens" },
  { href: "/misc", label: "Misc" },
  { href: "/about", label: "About" },
]

/** What the writing here may be used under: About and every post's end. */
export const LICENSE = {
  label: "CC BY-NC-SA 4.0",
  href: "https://creativecommons.org/licenses/by-nc-sa/4.0",
} as const

export const SOCIALS: { href: string; label: string; icon: SvgComponent }[] = [
  { href: "https://github.com/synthpop123", label: "GitHub", icon: GitHub },
  { href: "https://x.com/whoamamamiii", label: "X", icon: X },
  { href: "mailto:hi@lkwplus.com", label: "Email", icon: Email },
  { href: "/rss.xml", label: "RSS", icon: RSS },
]

/** The Mastodon account /memos links to; its statuses come from MEMOS. */
export const MASTODON = {
  instance: "https://mastodon.lkwplus.com",
  username: "lkw123",
} as const

/**
 * Every backend the site reads is one Worker, synthpop123/cf-workers-api.
 * `/tokens` has a page to itself; the five live sections of /misc arrive
 * together from `/misc`, one request that misc.astro preloads.
 */
export const API = "https://api.lkwplus.com"

/** What each reporting device is, keyed by the name its CLI reports.
 *  The payload says nothing about hardware, so the device card's mark
 *  comes from here; a name missing from this table gets a generic chip. */
export type DeviceKind = "laptop" | "desktop" | "server"

export const TOKENS = {
  endpoint: `${API}/tokens/site`,
  devices: {
    MacbookPro: "laptop",
    UbuntuPC: "desktop",
    OracleARM: "server",
  } satisfies Record<string, DeviceKind>,
} as const

export const MISC = {
  endpoint: `${API}/misc`,
} as const

/** /memos: the latest statuses, photos copied as WebP by the Worker. */
export const MEMOS = {
  endpoint: `${API}/memos/site`,
} as const

/** The home page's Now tiles: the latest listen, film, today's tokens and
 *  memo, composed by the Worker from the views above. */
export const NOW = {
  endpoint: `${API}/now/site`,
} as const

/** The Koito instance the Music section links to (its data comes from
 *  MISC), and how many listens it shows. */
export const KOITO = {
  instance: "https://music.lkwplus.com",
  limit: 8,
} as const

export const LETTERBOXD = {
  username: "lkw123",
  limit: 8,
} as const

export const SWITCH = {
  limit: 8,
} as const

/**
 * Flights on /misc: how many routes the route list, and how many airlines
 * and aircraft types each composition bar, shows before folding the rest
 * behind "Show N more". The route skeleton reserves `routes` rows plus the
 * fold row.
 */
/**
 * /misc Portfolio: the funds counted as cash in the allocation map — with
 * cash itself they form the block its lens zooms past (BOXX is a box-spread
 * fund, T-bill money in all but name).
 */
export const PORTFOLIO = {
  cashLike: ["BOXX"],
} as const

export const FLIGHTS = {
  named: 4,
  routes: 10,
} as const

/**
 * The marks `Uses.astro` draws beside a thing — the union, not a free
 * string, so an icon this page has no SVG for fails the type check rather
 * than rendering an empty square.
 */
export type UsesIcon =
  | "laptop"
  | "monitor"
  | "keyboard"
  | "mouse"
  | "speaker"
  | "smartphone"
  | "watch"
  | "headphones"
  | "book-open"

/** The hardware on `/misc`, grouped by where each thing actually lives. */
export const USES: {
  group: string
  items: { name: string; note: string; icon: UsesIcon }[]
}[] = [
  {
    group: "Desk",
    items: [
      {
        name: "MacBook Pro",
        note: "14-inch M3 Pro, always ready.",
        icon: "laptop",
      },
      {
        name: "LG Ultrafine",
        note: "27-inch 4K, reverse charging.",
        icon: "monitor",
      },
      {
        name: "NuPhyX BH65",
        note: "65% and wireless, arrow keys kept, numpad dropped.",
        icon: "keyboard",
      },
      {
        name: "Logi MX Master 3S",
        note: "Quiet clicks, and a wheel that spins through a long diff.",
        icon: "mouse",
      },
      {
        name: "Marshall Acton III",
        note: "The speaker behind most of what shows up under Music.",
        icon: "speaker",
      },
    ],
  },
  {
    group: "Carry",
    items: [
      {
        name: "iPhone Air",
        note: "Thin enough that I stopped noticing the pocket.",
        icon: "smartphone",
      },
      {
        name: "Apple Watch Series 9",
        note: "Timers, rings, and the notifications worth a wrist buzz.",
        icon: "watch",
      },
      {
        name: "HUAWEI FreeClip 2",
        note: "Open-ear clips that play music without sealing the room out.",
        icon: "headphones",
      },
      {
        name: "Kindle Paperwhite 6",
        note: "Long-form reading, on the one screen that can't notify.",
        icon: "book-open",
      },
    ],
  },
]
