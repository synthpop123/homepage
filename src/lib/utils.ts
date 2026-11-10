/* Post dates. Frontmatter dates are calendar days parsed as midnight UTC,
   so they are formatted in UTC, never in the build machine's zone. */

const fullDate = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
})

const monthDayDate = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
})

/** "Jun 16, 2023". */
export const formatDate = (date: Date) => fullDate.format(date)

/** "Jun 16". */
export const formatMonthDay = (date: Date) => monthDayDate.format(date)

/** "Jun 16" for a post from the build's year, "Jun 16, 2023" otherwise. */
export const formatPostDate = (date: Date) =>
  date.getUTCFullYear() === new Date().getUTCFullYear()
    ? formatMonthDay(date)
    : formatDate(date)

const compact = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
})

/** "3.4K", "36K": a count for a glance, not for adding up. */
export const formatCompact = (value: number) => compact.format(value)

/** The home cat's caption serial: four random digits, per cat. */
export const catSerial = () => String(1000 + Math.floor(Math.random() * 9000))

/** JSON for an inline `<script>`: `<` escaped, so no string in it can
 *  close the element (`</script>`) or open a comment. */
export const jsonForScript = (value: unknown) =>
  JSON.stringify(value).replaceAll("<", "\\u003c")

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
