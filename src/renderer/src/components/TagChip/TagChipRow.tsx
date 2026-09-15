// Tags — ONE line of chips, with a dashed `+N` chip for what does not fit (spec T-26: the board
// card footer; T-27: the rail's "Show all tags" view). Chips keep the order they are given
// (tag-list order), so a tag sits in the same place on every card.
//
// The fit is MEASURED: render every chip plus a `+N` probe, read their widths in a layout effect
// (before paint, so nothing flickers), then keep the leading chips that fit beside the `+N`.
import { useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react'
import { TagChip, type TagChipTag } from './TagChip'
import { fitCount } from './fitCount'
import styles from './TagChip.module.css'

export interface TagChipRowProps {
  /** Already in tag-list order. */
  tags: readonly TagChipTag[]
  testId: string
}

export function TagChipRow({ tags, testId }: TagChipRowProps): JSX.Element | null {
  const rowRef = useRef<HTMLSpanElement | null>(null)
  // Changes whenever what is drawn changes (a tag added, removed or renamed) — a stale fit is then
  // measured again. Joined with `\n` (never `''`) — the same separator the rail's own `tagKey`
  // uses — so two different id/name pairs can never collide into the same key.
  const key = tags.map((t) => `${t.id} ${t.name}`).join('\n')
  const [fit, setFit] = useState<{ key: string; count: number } | null>(null)
  const measuring = fit === null || fit.key !== key
  const hasTags = tags.length > 0

  useLayoutEffect(() => {
    if (!measuring || rowRef.current === null) return
    setFit({ key, count: fitCount(rowRef.current) })
  }, [measuring, key])

  // A width change (window resize, the rail collapsing) invalidates the fit. Observed target is
  // the PARENT SLOT (`.footerTags` in the card footer, `.rowTags` in the rail's show-all row),
  // never this row's own span: once fitted, the row is only as wide as the chips it kept, so its
  // own box does not change size when the card/rail gets WIDER — only the slot around it tracks
  // the space that is actually available (review finding A, T-26).
  useEffect(() => {
    const row = rowRef.current
    if (!hasTags || row === null || typeof ResizeObserver === 'undefined') return
    const target = row.parentElement ?? row
    let width = target.clientWidth
    const observer = new ResizeObserver(() => {
      if (target.clientWidth === width) return
      width = target.clientWidth
      setFit(null)
    })
    observer.observe(target)
    return () => observer.disconnect()
  }, [hasTags])

  if (!hasTags) return null
  const shown = fit === null || fit.key !== key ? tags : tags.slice(0, fit.count)
  const hidden = tags.slice(shown.length)
  return (
    <span ref={rowRef} className={styles.row} data-testid={testId}>
      {shown.map((t) => (
        <TagChip key={t.id} tag={t} />
      ))}
      {/* While measuring this is the probe (its widest label, so the reserve is honest); after, it
          is the real `+N`, whose title names the hidden tags. */}
      {(measuring || hidden.length > 0) && (
        <span
          className={`${styles.chip} ${styles.more}`}
          data-testid="tag-chip-more"
          title={hidden.map((t) => t.name).join(', ')}
        >
          +{measuring ? tags.length : hidden.length}
        </span>
      )}
    </span>
  )
}
