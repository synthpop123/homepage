import type { SvgComponent } from "astro/types"
import Email from "@/assets/icons/email.svg"
import GitHub from "@/assets/icons/github.svg"
import RSS from "@/assets/icons/rss.svg"
import Twitter from "@/assets/icons/twitter.svg"
import type { CodeTab } from "@/lib/expressive-code/render"

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

export const NAVIGATION: { href: string; label: string; wideOnly?: boolean }[] =
  [
    { href: "/blog", label: "Blog" },
    { href: "/tags", label: "Tags", wideOnly: true },
    { href: "/memos", label: "Memos", wideOnly: true },
    { href: "/tokens", label: "Tokens" },
    { href: "/misc", label: "Misc" },
    { href: "/about", label: "About" },
  ]

export const SOCIALS: { href: string; label: string; icon: SvgComponent }[] = [
  { href: "https://github.com/synthpop123", label: "GitHub", icon: GitHub },
  { href: "https://x.com/whoamamamiii", label: "Twitter", icon: Twitter },
  { href: "mailto:hi@lkwplus.com", label: "Email", icon: Email },
  { href: "/rss.xml", label: "RSS", icon: RSS },
]

export const MASTODON = {
  instance: "https://mastodon.lkwplus.com",
  username: "lkw123",
  accountId: "114671030739656846",
  limit: 20,
} as const

export const KOITO = {
  instance: "https://music.lkwplus.com",
  limit: 8,
} as const

export const LETTERBOXD = {
  username: "lkw123",
  embedUrl: "https://letterboxd-embed.lkwplus.com",
  limit: 8,
} as const

export const TOKENS = {
  endpoint: "https://tokens.lkwplus.com",
} as const

export const SWITCH = {
  endpoint: "https://switch.lkwplus.com",
  limit: 8,
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
        name: "NuPhy BH65",
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
        note: "Open-ear clips — music without sealing the room out.",
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

export const GLOBE_LOCATIONS: { location: [number, number]; size: number }[] = [
  { location: [39.904989, 116.405285], size: 0.02 }, // 北京
  { location: [22.547, 114.085947], size: 0.02 }, // 深圳
  { location: [22.28552, 114.15769], size: 0.02 }, // 香港
  { location: [28.19409, 112.982279], size: 0.02 }, // 长沙
  { location: [30.584355, 114.298572], size: 0.02 }, // 武汉
  { location: [31.230393, 121.473702], size: 0.02 }, // 上海
  { location: [30.659462, 104.065735], size: 0.02 }, // 成都
  { location: [31.863945, 117.281127], size: 0.02 }, // 合肥
  { location: [34.263161, 108.948024], size: 0.02 }, // 西安
  { location: [37.550978, 126.849565], size: 0.02 }, // 首尔
  { location: [35.18146, 129.07854], size: 0.02 }, // 釜山
  { location: [8.006098, 98.237611], size: 0.02 }, // 普吉
  { location: [1.352083, 103.819839], size: 0.02 }, // 新加坡
]

export const PROFILE_TABS: CodeTab[] = [
  {
    label: "JSON",
    lang: "json",
    title: "/home/lkw123/profile.json",
    code: `{
  "pronouns": ["He", "Him"],
  "motto": "Be creative & keep learning.",
  "mbti": "INTP (introverted, intuitive, thinking and perceiving)",
  "homepageURL": "https://lkwplus.com",
  "statuspageURL": "https://status.lkwplus.com",
  "contactInfo": {
    "email": "mailto:hi@lkwplus.com",
    "telegram": "https://t.me/lkw123",
    "twitter": "https://x.com/whoamamamiii"
  }
}`,
  },
  {
    label: "YAML",
    lang: "yaml",
    title: "/home/lkw123/profile.yaml",
    code: `pronouns:
  - He
  - Him
motto: Be creative & keep learning.
mbti: INTP (introverted, intuitive, thinking and perceiving)
homepageURL: https://lkwplus.com
statuspageURL: https://status.lkwplus.com
contactInfo:
  email: mailto:hi@lkwplus.com
  telegram: https://t.me/lkw123
  twitter: https://x.com/whoamamamiii`,
  },
  {
    label: "TOML",
    lang: "toml",
    title: "/home/lkw123/profile.toml",
    code: `pronouns = ["He", "Him"]
motto = "Be creative & keep learning."
mbti = "INTP (introverted, intuitive, thinking and perceiving)"
homepageURL = "https://lkwplus.com"
statuspageURL = "https://status.lkwplus.com"

[contactInfo]
email = "mailto:hi@lkwplus.com"
telegram = "https://t.me/lkw123"
twitter = "https://x.com/whoamamamiii"`,
  },
  {
    label: "TypeScript",
    lang: "ts",
    title: "/home/lkw123/profile.ts",
    code: `const lkw123 = {
  pronouns: ["He", "Him"],
  motto: "Be creative & keep learning.",
  mbti: "INTP (introverted, intuitive, thinking and perceiving)",
  homepageURL: "https://lkwplus.com",
  statuspageURL: "https://status.lkwplus.com",
  contactInfo: {
    email: "mailto:hi@lkwplus.com",
    telegram: "https://t.me/lkw123",
    twitter: "https://x.com/whoamamamiii",
  },
}`,
  },
  {
    label: "Python",
    lang: "python",
    title: "/home/lkw123/profile.py",
    code: `lkw123 = {
    "pronouns": ["He", "Him"],
    "motto": "Be creative & keep learning.",
    "mbti": "INTP (introverted, intuitive, thinking and perceiving)",
    "homepageURL": "https://lkwplus.com",
    "statuspageURL": "https://status.lkwplus.com",
    "contactInfo": {
        "email": "mailto:hi@lkwplus.com",
        "telegram": "https://t.me/lkw123",
        "twitter": "https://x.com/whoamamamiii",
    },
}`,
  },
  {
    label: "Go",
    lang: "go",
    title: "/home/lkw123/profile.go",
    code: `lkw123 := Profile{
    Pronouns:      []string{"He", "Him"},
    Motto:         "Be creative & keep learning.",
    MBTI:          "INTP (introverted, intuitive, thinking and perceiving)",
    HomepageURL:   "https://lkwplus.com",
    StatuspageURL: "https://status.lkwplus.com",
    ContactInfo: ContactInfo{
        Email:    "mailto:hi@lkwplus.com",
        Telegram: "https://t.me/lkw123",
        Twitter:  "https://x.com/whoamamamiii",
    },
}`,
  },
  {
    label: "Rust",
    lang: "rust",
    title: "/home/lkw123/profile.rs",
    code: `let lkw123 = Profile {
    pronouns: vec!["He", "Him"],
    motto: "Be creative & keep learning.",
    mbti: "INTP (introverted, intuitive, thinking and perceiving)",
    homepage_url: "https://lkwplus.com",
    statuspage_url: "https://status.lkwplus.com",
    contact_info: ContactInfo {
        email: "mailto:hi@lkwplus.com",
        telegram: "https://t.me/lkw123",
        twitter: "https://x.com/whoamamamiii",
    },
};`,
  },
  {
    label: "Ruby",
    lang: "ruby",
    title: "/home/lkw123/profile.rb",
    code: `lkw123 = {
  pronouns: ["He", "Him"],
  motto: "Be creative & keep learning.",
  mbti: "INTP (introverted, intuitive, thinking and perceiving)",
  homepage_url: "https://lkwplus.com",
  statuspage_url: "https://status.lkwplus.com",
  contact_info: {
    email: "mailto:hi@lkwplus.com",
    telegram: "https://t.me/lkw123",
    twitter: "https://x.com/whoamamamiii"
  }
}`,
  },
  {
    label: "Lua",
    lang: "lua",
    title: "/home/lkw123/profile.lua",
    code: `local lkw123 = {
  pronouns = { "He", "Him" },
  motto = "Be creative & keep learning.",
  mbti = "INTP (introverted, intuitive, thinking and perceiving)",
  homepageURL = "https://lkwplus.com",
  statuspageURL = "https://status.lkwplus.com",
  contactInfo = {
    email = "mailto:hi@lkwplus.com",
    telegram = "https://t.me/lkw123",
    twitter = "https://x.com/whoamamamiii",
  },
}`,
  },
  {
    label: "Kotlin",
    lang: "kotlin",
    title: "/home/lkw123/profile.kt",
    code: `val lkw123 = Profile(
    pronouns = listOf("He", "Him"),
    motto = "Be creative & keep learning.",
    mbti = "INTP (introverted, intuitive, thinking and perceiving)",
    homepageURL = "https://lkwplus.com",
    statuspageURL = "https://status.lkwplus.com",
    contactInfo = ContactInfo(
        email = "mailto:hi@lkwplus.com",
        telegram = "https://t.me/lkw123",
        twitter = "https://x.com/whoamamamiii",
    ),
)`,
  },
]
