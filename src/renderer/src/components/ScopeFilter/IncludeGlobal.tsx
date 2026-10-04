// Include global (spec 2026-10-03 H) — beside a WORKSPACE scope in Templates, Shortcuts, Tags and
// Rules: also list the global rows, which apply in that workspace too. ONE remembered choice
// (`settings.includeGlobal`): unchecking it in Tags unchecks it in Templates, and it survives a
// restart. Saved on change like every Settings control; a refused write is rolled back by
// `persistSettingsPatch` and said in the dialog's message slot. Not rendered under All, Global or
// `(no workspace)`, where it would do nothing.
import type { JSX } from 'react'
import { persistSettingsPatch, selectIncludeGlobal, useSettings } from '../../stores/settingsStore'
import { useManageDialogContext } from '../ManageDialog/ManageDialog'
import { scopeWorkspaceId, type ScopeFilterValue } from './scope'
import styles from './IncludeGlobal.module.css'

const INCLUDE_GLOBAL_SAVE_FAILED = 'Could not save the Include global choice.'

export function IncludeGlobal({
  scope,
  testId
}: {
  scope: ScopeFilterValue
  testId: string
}): JSX.Element | null {
  const { actions } = useManageDialogContext()
  const includeGlobal = useSettings(selectIncludeGlobal)
  if (scopeWorkspaceId(scope) === null) return null
  return (
    <label className={styles.includeGlobal}>
      <input
        type="checkbox"
        data-testid={testId}
        checked={includeGlobal}
        onChange={(e) => {
          void persistSettingsPatch({ includeGlobal: e.target.checked }).catch(() =>
            actions.setError(INCLUDE_GLOBAL_SAVE_FAILED)
          )
        }}
      />
      Include global
    </label>
  )
}
