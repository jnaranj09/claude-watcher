// The words the operator sees for a thing the app names in more than one place (technical-taste
// §4 "Same thing, same word"). Every control that names the thing reads it from here, so two
// controls can never drift apart, and a rename is one edit that every place follows.
// `copyTerms.guard.test.ts` fails when one of these strings is typed by hand in another file.

/** A plain `$SHELL` beside claude: the card's shell pane. */
export const SHELL_TERMS = {
  label: 'Shell',
  open: 'Open shell',
  hide: 'Hide shell',
  resize: 'Resize shell pane',
  openFailedSession: 'Could not open a shell for this session.'
} as const
