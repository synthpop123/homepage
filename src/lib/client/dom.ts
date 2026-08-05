/**
 * The one element factory the client-side renderers share. Every feed
 * builds its DOM the same way — create, class, maybe text — so the
 * helper lives here rather than once per feed; Tokens re-exports it
 * from its own dom.ts alongside the dashboard-specific plumbing.
 */

export const el = (tag: string, className?: string, text?: string) => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}
