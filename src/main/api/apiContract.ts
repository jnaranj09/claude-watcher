// Programmatic API — the wire constants, in ONE place so the server, the router, the OpenAPI
// document and the tests cannot drift from each other.
//
// These are deliberately not settings: a port or a body cap the operator can change is a support
// surface, and the host is a security posture, not a preference.
// [.claude/rules/zod-boundaries.md; src/main/hooks/hookServer.ts (the :9279 precedent)]

/** Loopback ONLY. NEVER `0.0.0.0` — binding a wildcard would put a session-launching API on
 *  every interface the machine has, behind a token the operator never chose to share. */
export const API_HOST = '127.0.0.1'

/** The API's default port, near the hook ingest's 9279. It skips 9280 on purpose: that one is
 *  held by an unrelated daemon (`kubectl-radar`) on the operator's own machine, and a default
 *  that is taken on day one reads as a broken feature. */
export const API_DEFAULT_PORT = 9281

/** Hard cap on a request body. A create body is a template id, a name and a few args; anything
 *  larger is a mistake or an attack, and is refused (`body_too_large`) without being buffered. */
export const API_MAX_BODY_BYTES = 64 * 1024

/** How many SSE streams may be open at once. Each one holds a socket and a hub subscription;
 *  past this the API answers `too_many_streams` rather than leaking file descriptors. */
export const API_SSE_MAX_STREAMS = 32

/** SSE keep-alive comment interval. Without it an idle stream dies to an intermediary's timeout
 *  and the client never learns it stopped receiving. */
export const API_SSE_PING_MS = 15_000

/** How long a create waits for the renderer to open the terminal and mint the session id before
 *  answering `spawn_timeout`. The card still exists — the caller just did not get its id. */
export const API_SPAWN_TIMEOUT_MS = 5_000
