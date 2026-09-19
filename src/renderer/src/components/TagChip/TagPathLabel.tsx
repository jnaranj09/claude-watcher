// Tags (D-13) — a tag's name drawn as a PATH: `acme/` muted, `prod` primary, indented by depth.
// Used by the Tags dialog rail and the TagPicker rows — the two places a tag stands in a LIST of
// its siblings, where the parent is visible right above it. Chips keep the full name: a chip
// reading `prod` alone would be ambiguous beside a `staging/prod`. The accessible name is the
// FULL name, so a screen reader and a test read `acme/prod`, not two fragments.
//
// `role="img"` (not the brief's `role="text"` — that token is a WebKit/VoiceOver-only convention,
// never adopted into the WAI-ARIA spec, so a `jsx-a11y/aria-role` lint would reject it). `img` IS a
// real ARIA role, it takes its name from `aria-label`, and per the ARIA-in-HTML mapping a UA treats
// its descendants as opaque — exactly the "read the whole thing as one string" contract this needs.
// The `aria-hidden` on both child spans is a belt-and-suspenders backstop for that pruning.
import type { CSSProperties, JSX } from 'react'
import { splitTagPath } from '../../../../shared/tags/tagPath'
import type { TagChipTag } from './TagChip'
import styles from './TagChip.module.css'

export function TagPathLabel({ tag }: { tag: TagChipTag }): JSX.Element {
  const { parent, leaf, depth } = splitTagPath(tag.name)
  const style: CSSProperties | undefined =
    depth > 0 ? { paddingLeft: `calc(${depth} * var(--space-3))` } : undefined
  return (
    <span
      className={styles.path}
      data-testid="tag-path"
      data-tag-id={tag.id}
      role="img"
      aria-label={tag.name}
      title={tag.name}
      style={style}
    >
      {parent !== null && (
        <span className={styles.pathParent} data-testid="tag-path-parent" aria-hidden="true">
          {parent}/
        </span>
      )}
      <span className={styles.pathLeaf} data-testid="tag-path-leaf" aria-hidden="true">
        {leaf}
      </span>
    </span>
  )
}
