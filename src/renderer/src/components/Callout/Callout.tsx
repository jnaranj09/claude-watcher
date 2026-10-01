// The ONE in-page feedback message (spec 2026-10-01-feedback-callout-design.md): a tinted box with
// a coloured left bar, an icon disc and the words. Success is a polite status, danger an alert.
// The icon is drawn in CSS, so the element's text is exactly what it says (tests and screen
// readers read the words, never a glyph). No className: layout goes on a wrapper.
import type { JSX, ReactNode } from 'react'
import styles from './Callout.module.css'

export type CalloutTone = 'success' | 'danger'
export type CalloutSize = 'block' | 'compact'

export function Callout({
  tone,
  size = 'block',
  title,
  detail,
  action,
  announce = true,
  testId
}: {
  tone: CalloutTone
  /** `block`: full width, room for a detail line and an action. `compact`: one line, for a
   *  heading row or a tight popup; detail and action are not drawn. */
  size?: CalloutSize
  title: ReactNode
  detail?: ReactNode
  action?: ReactNode
  /** False drops the live role — for a callout inside something that is already an alert. */
  announce?: boolean
  testId?: string
}): JSX.Element {
  const role = !announce ? undefined : tone === 'danger' ? 'alert' : 'status'
  const block = size === 'block'
  return (
    <div
      className={`${styles.callout} ${block ? styles.block : styles.compact}`}
      data-callout=""
      data-callout-tone={tone}
      data-callout-size={size}
      role={role}
      data-testid={testId}
    >
      <span className={styles.icon} aria-hidden="true" />
      <div className={styles.body}>
        <div className={styles.title}>{title}</div>
        {block && detail !== undefined && <div className={styles.detail}>{detail}</div>}
      </div>
      {block && action !== undefined && <div className={styles.action}>{action}</div>}
    </div>
  )
}
