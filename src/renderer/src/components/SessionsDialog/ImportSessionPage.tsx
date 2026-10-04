// Import (spec 2026-10-03 E) — the Sessions dialog's one-off page: bring in a claude session the
// app did not launch, by its id, into a workspace you pick. No list, so `pages | form`. No
// explaining text: the page name and the two fields say what it does (the owner: "the UI has to
// read [that]"). It is the old Past sessions Resume-by-id row: the paste is trimmed and
// lower-cased (claude writes ids lower case; main compares them exactly), and `already_open` takes
// the view to the live card.
import { useEffect, useRef, useState, type JSX } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAsyncAction } from '../../hooks/useAsyncAction'
import { focusLiveSession, resumeSessionById } from '../../stores/pastSessionsStore'
import {
  selectActiveWorkspaceId,
  selectWorkspaces,
  useWorkspaces
} from '../../stores/workspacesStore'
import { ManageDialog, useManageDialogContext } from '../ManageDialog/ManageDialog'
import type { DialogPageProps } from '../ManageDialog/dialogPage'
import { isAlreadyOpenError, resumeByIdErrorMessage } from '../PastSessionsDialog/pastSessionsView'
import { Select } from '../Select/Select'
import { TextInput } from '../TextInput/TextInput'
import { WorkspaceLabel } from '../WorkspaceLabel/WorkspaceLabel'

export function ImportSessionPage({ pages }: Pick<DialogPageProps, 'pages'>): JSX.Element {
  const { actions } = useManageDialogContext()
  const activeWorkspaceId = useWorkspaces(selectActiveWorkspaceId)
  const workspaces = useWorkspaces(useShallow(selectWorkspaces))
  const [sessionId, setSessionId] = useState('')
  // Opens on the ACTIVE workspace, where the operator is working; the first workspace when that id
  // is unknown (a dropdown never sits on a value it does not offer).
  const [workspaceId, setWorkspaceId] = useState(() =>
    workspaces.some((w) => w.id === activeWorkspaceId)
      ? activeWorkspaceId
      : (workspaces[0]?.id ?? activeWorkspaceId)
  )
  const idRef = useRef<HTMLInputElement | null>(null)

  // An aria-modal dialog takes focus on mount: the id field is the one thing to do here.
  useEffect(() => {
    idRef.current?.focus()
  }, [])

  const importing = useAsyncAction(async (): Promise<void> => {
    const id = sessionId.trim().toLowerCase()
    if (id.length === 0) return
    actions.setError(null)
    try {
      await resumeSessionById(id, workspaceId)
      actions.close()
    } catch (err) {
      if (isAlreadyOpenError(err) && (await focusLiveSession(id))) {
        actions.close()
        return
      }
      actions.setError(resumeByIdErrorMessage(err))
    }
  })

  return (
    <>
      <ManageDialog.Header />
      <ManageDialog.Columns>
        {pages}
        <ManageDialog.Form
          testId="import-form"
          onSubmit={(e) => {
            e.preventDefault()
            void importing.run()
          }}
        >
          <ManageDialog.Label htmlFor="import-session-id">Claude session id</ManageDialog.Label>
          <TextInput
            id="import-session-id"
            inputRef={idRef}
            testId="import-session-id"
            placeholder="Paste a claude session id"
            value={sessionId}
            onChange={(next) => {
              setSessionId(next)
              actions.setError(null)
            }}
          />
          <ManageDialog.Label>Workspace</ManageDialog.Label>
          <Select
            value={workspaceId}
            options={workspaces.map((w) => ({
              value: w.id,
              label: w.name,
              display: <WorkspaceLabel name={w.name} tone={w.color} />
            }))}
            onChange={(next) => {
              setWorkspaceId(next)
              actions.setError(null)
            }}
            ariaLabel="Workspace"
            testId="import-workspace"
          />
          <ManageDialog.Footer>
            <ManageDialog.Save
              testId="import-submit"
              disabled={sessionId.trim().length === 0}
              busy={importing.busy}
            >
              Import
            </ManageDialog.Save>
          </ManageDialog.Footer>
        </ManageDialog.Form>
      </ManageDialog.Columns>
      <ManageDialog.Message testId="import-error" />
    </>
  )
}
