import styles from './CountPill.module.css'

/** Which count a pill draws. Its fill follows: `total` and `open-tasks` grey, `working` blue,
 *  `needs-you` yellow. Also the pill's `data-count` (and its fill as `data-fill`), the hooks a theme targets. */
export type CountKind = 'total' | 'working' | 'needs-you' | 'open-tasks'

/** The pill's fill, also its `data-fill`: the hook a lit button keys its grey-pill swap on, so no
 *  count kind is named outside this file. */
type Fill = 'grey' | 'working' | 'needs-you'

const FILL: Record<CountKind, Fill> = {
  total: 'grey',
  'open-tasks': 'grey',
  working: 'working',
  'needs-you': 'needs-you'
}

const FILL_CLASS: Record<Fill, string | undefined> = {
  grey: styles.grey,
  working: styles.working,
  'needs-you': styles.needsYou
}

/** The count pill: ONE shape for every count pill in the app (the workspace switcher, its tab and menu
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
      className={`${styles.pill} ${FILL_CLASS[FILL[kind]]}`}
      data-testid={testId}
      data-count={kind}
      data-fill={FILL[kind]}
      aria-hidden={hidden ? true : undefined}
    >
      {value}
    </span>
  )
}
