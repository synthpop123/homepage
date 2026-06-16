import type { SvgComponent } from "astro/types";
import Email from "@/assets/icons/email.svg";
import GitHub from "@/assets/icons/github.svg";
import RSS from "@/assets/icons/rss.svg";
import Twitter from "@/assets/icons/twitter.svg";

export const SITE = {
  title: "lkw123",
  description: "Yet another salted fish.",
  locale: "en-US",
  dir: "ltr",
  defaultPageImage: "/static/opengraph-image.png",
  defaultPostImage: "/static/1200x630.png",
} as const;

export const NAVIGATION: { href: string; label: string; wideOnly?: boolean }[] = [
  { href: "/blog", label: "Blog" },
  { href: "/tags", label: "Tags", wideOnly: true },
  { href: "/misc", label: "Misc" },
  { href: "/about", label: "About" },
];

export const SOCIALS: { href: string; label: string; icon: SvgComponent }[] = [
  { href: "https://github.com/synthpop123", label: "GitHub", icon: GitHub },
  { href: "https://x.com/whoamamamiii", label: "Twitter", icon: Twitter },
  { href: "mailto:hi@lkwplus.com", label: "Email", icon: Email },
  { href: "/rss.xml", label: "RSS", icon: RSS },
];

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
];
