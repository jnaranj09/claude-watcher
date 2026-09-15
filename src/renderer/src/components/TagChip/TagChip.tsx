// Tags — the ONE drawing of a tag name (spec T-7, §4.2). See TagChip.module.css for why a tag is a
// label pill and never a dot. Every root is a <span>, so a chip may sit inside a <button>.
import type { JSX, ReactNode } from 'react'
import type { Tag } from '../../../../shared/ipc/contract'
import styles from './TagChip.module.css'

/** What a chip needs to draw — never the scope. */
export type TagChipTag = Pick<Tag, 'id' | 'name' | 'color'>

export interface TagChipProps {
  tag: TagChipTag
}

export function TagChip({ tag }: TagChipProps): JSX.Element {
  // `noUncheckedIndexedAccess`: the CSS module is an index signature.
  const color = styles[tag.color] ?? ''
  return (
    <span
      className={`${styles.chip} ${color}`}
      data-testid="tag-chip"
      data-tag-id={tag.id}
      title={tag.name}
    >
      <span className={styles.name}>{tag.name}</span>
    </span>
  )
}

export interface TagChipWrapProps {
  tags: readonly TagChipTag[]
  testId: string
  /** Drawn after the last chip, in the same wrapping flow (the rail peek's `+ tag` placeholder). */
  trailing?: ReactNode
}

/** Every chip, wrapping onto as many lines as it takes (the rail peek), in the order given. */
export function TagChipWrap({ tags, testId, trailing }: TagChipWrapProps): JSX.Element {
  return (
    <span className={styles.wrap} data-testid={testId}>
      {tags.map((t) => (
        <TagChip key={t.id} tag={t} />
      ))}
      {trailing}
    </span>
  )
}
