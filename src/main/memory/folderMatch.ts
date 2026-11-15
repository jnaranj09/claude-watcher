// Memory phase 2: when a folder counts as "this folder" for a session (the index's open tasks), and
// the folder the dialog stores for an item (`memoryIpc.ts`).
// Pure string work on absolute paths; it never touches the disk.

/** The path without its trailing slashes (the root stays `/`). */
export function trimmedFolder(path: string): string {
  const out = path.replace(/\/+$/, '')
  return out === '' ? '/' : out
}

/** `child` is `parent` itself or sits below it on a path boundary. */
function within(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent === '/' ? '/' : `${parent}/`)
}

/** The same folder, or one inside the other on a path boundary (`/a/b` and `/a/b/c`; not `/a/bc`). */
export function foldersRelated(a: string, b: string): boolean {
  const x = trimmedFolder(a)
  const y = trimmedFolder(b)
  return within(x, y) || within(y, x)
}
