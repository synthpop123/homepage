export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date)
}

export const isSubpost = (id: string) => id.includes("/")

export const subpostSlug = (id: string) => id.split("/")[1]

export const normalizePath = (pathname: string) => {
  try {
    return decodeURIComponent(pathname).replace(/\/+$/, "")
  } catch {
    return pathname.replace(/\/+$/, "")
  }
}

export const hashId = (hash: string) => decodeURIComponent(hash.slice(1))

/**
 * How many placeholder rows a feed renders while it loads when it can't
 * know how many it will show (Memos, whose entries vary in height, and the
 * Tokens devices). The fixed-length /misc lists — Movies, Music, Switch —
 * render one per row they will fill instead, since their final height is
 * known and anything short of it shifts every section below on arrival.
 */
export const SKELETON_ROWS = 3
