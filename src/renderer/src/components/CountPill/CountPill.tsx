import styles from './CountPill.module.css'

/** Which count a pill draws. Its fill follows: `total` and `open-tasks` grey, `working` blue,
 *  `needs-you` yellow. Also the pill's `data-count`, the hook a theme targets. */
export type CountKind = 'total' | 'working' | 'needs-you' | 'open-tasks'

const FILL: Record<CountKind, string | undefined> = {
  total: styles.grey,
  'open-tasks': styles.grey,
  working: styles.working,
  'needs-you': styles.needsYou
}

/** The count pill: ONE shape for every count in the app (the workspace switcher, its tab and menu
 *  rows, the Goals button), differing only by fill, so they read as a set. */
export function CountPill({
  value,
  kind,
  testId,
  hidden
}: {
  value: number
  kind: CountKind
  testId?: string
  hidden?: boolean
}): React.JSX.Element {
  return (
    <span
      className={`${styles.pill} ${FILL[kind]}`}
      data-testid={testId}
      data-count={kind}
      aria-hidden={hidden ? true : undefined}
    >
      {value}
    </span>
  )
}
