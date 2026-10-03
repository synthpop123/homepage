/**
 * Copy text from a click and say so: the button's `data-state` turns
 * `copied` (or `error`, with `failTitle` as its tooltip), the live
 * region announces it, and both clear two seconds later. Shared by Copy
 * Markdown and the link at a post's end. `text` may be a promise, which
 * is awaited inside the click so the write keeps its user activation
 * whenever the promise is already settled.
 */

const resets = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>()

export async function copyText(
  button: HTMLElement,
  status: Element,
  text: string | Promise<string>,
  failTitle?: string,
) {
  try {
    await navigator.clipboard.writeText(await text)
    button.dataset.state = "copied"
    status.textContent = "Copied"
  } catch {
    button.dataset.state = "error"
    if (failTitle) button.title = failTitle
    status.textContent = "Copy failed"
  }
  clearTimeout(resets.get(button))
  resets.set(
    button,
    setTimeout(() => {
      delete button.dataset.state
      if (failTitle) button.removeAttribute("title")
      status.textContent = ""
    }, 2000),
  )
}
