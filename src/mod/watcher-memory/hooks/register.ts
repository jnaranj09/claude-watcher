// The memory mod (memory phase 3, addendum §1). The rule, as both mod headers say it:
//
// `watcher-bridge` reads and reports. It never changes what claude does or shows.
// `watcher-memory` is the one mod that changes what claude reads, and only in a session the app
// started with `Memory` and `Memory recall` on, on claude 2.1.323 or newer. It does four things:
// (1) adds one `session` section, the memory index, last in the system prompt; (2) adds one
// context block beside an operator's prompt; (3) adds one context block after a Read, Edit, Write
// or NotebookEdit result in the main conversation; (4) serves `/remember`.
// It never rewrites or drops a prompt, a tool call, a tool result or another section. It never
// denies anything. It never breaks the prompt cache. It draws nothing (no pane, band, status line
// or toast) and registers no tool. When main is slow, down or says no, every hook hands on exactly
// what `next` gave.
//
// Today it hooks no event: the app ships and installs it, and no spawn passes it to claude yet.
import type { Register } from 'claude-code'

export const register: Register = () => undefined
