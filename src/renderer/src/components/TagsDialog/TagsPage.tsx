// Tags — the Tags PAGE of the Tags dialog (spec §4.4; pages Tags · Rules, spec 2026-10-03 C): a header
// scope filter (`All tags` · Global · each workspace), a FLAT list of TagChips, a form (name /
// colour / workspace) and a [Delete] [Save] footer. UX-DR14: App.tsx guards it against the other
// modals (isModalOpen) and closes it on the quit guard.
import { selectIncludeGlobal, useSettings } from '../../stores/settingsStore'
import { IncludeGlobal } from '../ScopeFilter/IncludeGlobal'
import { useEffect, useState, type FormEvent, type JSX } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { Tag, TagSaveRequest } from '../../../../shared/ipc/contract'
import { TAG_COLORS, TAG_NAME_MAX_LENGTH, type TagColor } from '../../../../shared/schemas/tag'
import { ManageDialog, useManageDialogContext } from '../ManageDialog/ManageDialog'
import type { DialogPageProps } from '../ManageDialog/dialogPage'
import { ScopeMarker } from '../ScopeFilter/ScopeMarker'
import { ScopeFilter } from '../ScopeFilter/ScopeFilter'
import {
  filterByScope,
  workspaceRowsFirst,
  hasOrphans,
  knownWorkspaceIds,
  scopeOf,
  type ScopeFilterValue
} from '../ScopeFilter/scope'
import { Select } from '../Select/Select'
import { TagChip } from '../TagChip/TagChip'
import { TagPathLabel } from '../TagChip/TagPathLabel'
import { TextInput } from '../TextInput/TextInput'
import { WorkspaceLabel } from '../WorkspaceLabel/WorkspaceLabel'
import {
  removeTag,
  saveTag,
  selectTags,
  selectTagsLoadFailed,
  useTags
} from '../../stores/tagsStore'
import { rulesStore, rulesUsingTag } from '../../stores/rulesStore'
import { selectWorkspaces, useWorkspaces } from '../../stores/workspacesStore'
import { TAG_COLOR_LABELS, tagErrorMessage } from './tagForm'
import styles from './TagsDialog.module.css'

/** The Workspace dropdown's stand-in for "no workspace" — a WORD, never '' (it ends up in the
 *  option's testid). Cannot collide with a workspace id (uuids, or `default`). */
const GLOBAL_SCOPE = 'global'

export function TagsPage({ scope, setScope, pages }: DialogPageProps): JSX.Element {
  const dialog = useManageDialogContext()
  const { closeRef } = dialog.meta
  const tags = useTags(selectTags)
  const loadFailed = useTags(selectTagsLoadFailed)
  const workspaces = useWorkspaces(useShallow(selectWorkspaces))
  const known = knownWorkspaceIds(workspaces)
  const includeGlobal = useSettings(selectIncludeGlobal)
  const listed = workspaceRowsFirst(filterByScope(tags, scope, known, includeGlobal), scope)
  const selected = tags.find((t) => t.id === dialog.state.selectedId) ?? null
  const formOpen = dialog.state.creating || selected !== null

  // An aria-modal dialog must take focus on mount (WorkspacesDialog's reasoning): the ✕ is the
  // mount-stable target — there is no search box here.
  useEffect(() => {
    closeRef.current?.focus()
  }, [closeRef])

  function changeScope(next: ScopeFilterValue): void {
    setScope(next)
    // design.md — changing the scope closes whatever was open.
    dialog.actions.select(null)
  }

  /** design.md — a save that moves a row to another scope follows it: a row that vanishes on save
   *  reads as a save that failed. */
  function revealSaved(tag: Tag): void {
    dialog.actions.select(tag.id)
    if (filterByScope([tag], scope, known, includeGlobal).length === 0)
      setScope(scopeOf(tag.workspaceId, known))
    dialog.actions.showSuccess('Tag saved.')
  }

  // Different nothings, different sentences (design.md). No search box here, so only two apply.
  const emptyCopy = loadFailed
    ? 'Could not load tags.'
    : tags.length === 0
      ? 'No tags yet'
      : 'No tags in this workspace'

  return (
    <>
      <ManageDialog.Header>
        <ScopeFilter
          value={scope}
          workspaces={workspaces}
          showOrphans={hasOrphans(tags, known)}
          onChange={changeScope}
          allLabel="All tags"
          testId="tag-scope-filter"
          ariaLabel="Filter tags by workspace"
        />
        <IncludeGlobal scope={scope} testId="tag-include-global" />
      </ManageDialog.Header>
      <ManageDialog.Columns>
        {pages}
        <ManageDialog.List size="wide">
          <ManageDialog.Rows>
            {listed.map((t) => (
              <ManageDialog.Row
                key={t.id}
                id={t.id}
                testId="tag-row"
                selectTestId={`tag-select-${t.id}`}
              >
                <TagPathLabel tag={t} />
                <ScopeMarker workspaceId={t.workspaceId} workspaces={workspaces} />
              </ManageDialog.Row>
            ))}
            {listed.length === 0 && (
              <p className={styles.empty} data-testid="tags-empty">
                {emptyCopy}
              </p>
            )}
          </ManageDialog.Rows>
          <ManageDialog.New testId="tag-new" />
        </ManageDialog.List>
        {formOpen ? (
          <TagForm key={selected?.id ?? 'new'} tag={selected} onSaved={revealSaved} />
        ) : (
          <ManageDialog.Placeholder testId="tag-placeholder">
            Select a tag on the left, or create a new one.
          </ManageDialog.Placeholder>
        )}
      </ManageDialog.Columns>
      <ManageDialog.Message testId="tag-error" />
    </>
  )
}

interface TagFormProps {
  tag: Tag | null
  onSaved: (saved: Tag) => void
}

/** Keyed by the selected id in TagsDialog, so a selection change remounts it with a fresh draft —
 *  no effect-based syncing (TemplateForm's rule). */
function TagForm({ tag, onSaved }: TagFormProps): JSX.Element {
  const { actions } = useManageDialogContext()
  const workspaces = useWorkspaces(useShallow(selectWorkspaces))
  const [name, setName] = useState(tag?.name ?? '')
  const [color, setColor] = useState<TagColor>(tag?.color ?? 'slate')
  // A NEW tag is Global — the non-surprising default, the same as a new template.
  const [workspaceId, setWorkspaceId] = useState<string | null>(tag?.workspaceId ?? null)
  const [busy, setBusy] = useState(false)

  const trimmed = name.trim()
  const dirty =
    tag === null
      ? trimmed.length > 0
      : trimmed !== tag.name || color !== tag.color || workspaceId !== tag.workspaceId
  const canSave = trimmed.length > 0 && dirty && !busy
  // The colour options preview the chip with the name being typed.
  const preview = trimmed.length > 0 ? trimmed : 'tag'

  async function submit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault()
    if (!canSave) return
    setBusy(true)
    try {
      const req: TagSaveRequest =
        tag === null
          ? { name: trimmed, color, workspaceId }
          : { id: tag.id, name: trimmed, color, workspaceId }
      onSaved(await saveTag(req))
    } catch (err) {
      actions.setError(tagErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function confirmDelete(): Promise<void> {
    if (tag === null) return
    setBusy(true)
    try {
      await removeTag(tag.id)
      // Nothing open: the placeholder. `select` also clears the error line and the armed Delete; the form
      // remounts (its key changes), so there is no busy flag left to reset.
      actions.select(null)
      actions.showSuccess('Tag deleted.')
    } catch (err) {
      actions.setError(tagErrorMessage(err, rulesUsingTag(rulesStore.getState().rules, tag.id)))
      setBusy(false)
    }
  }

  return (
    <ManageDialog.Form testId="tag-form" onSubmit={(e) => void submit(e)}>
      <ManageDialog.Label htmlFor="tag-name">Name</ManageDialog.Label>
      <TextInput
        id="tag-name"
        testId="tag-name"
        maxLength={TAG_NAME_MAX_LENGTH}
        value={name}
        onChange={(next) => {
          setName(next)
          actions.setError(null)
        }}
      />

      <ManageDialog.Label>Color</ManageDialog.Label>
      <Select
        value={color}
        options={TAG_COLORS.map((c) => ({
          value: c,
          label: TAG_COLOR_LABELS[c],
          adornment: <TagChip tag={{ id: `color-${c}`, name: preview, color: c }} />
        }))}
        onChange={(next) => {
          setColor(next)
          actions.setError(null)
        }}
        ariaLabel="Color"
        testId="tag-color"
      />

      <ManageDialog.Label>Workspace</ManageDialog.Label>
      <Select
        value={workspaceId ?? GLOBAL_SCOPE}
        options={[
          {
            value: GLOBAL_SCOPE,
            label: 'Global',
            display: <WorkspaceLabel name="Global" tone="global" />
          },
          ...workspaces.map((w) => ({
            value: w.id,
            label: w.name,
            display: <WorkspaceLabel name={w.name} tone={w.color} />
          }))
        ]}
        onChange={(next) => {
          setWorkspaceId(next === GLOBAL_SCOPE ? null : next)
          actions.setError(null)
        }}
        ariaLabel="Workspace"
        testId="tag-scope"
      />

      <ManageDialog.Footer>
        {tag !== null && (
          <ManageDialog.Delete
            testId="tag-delete"
            disabled={busy}
            onConfirm={() => void confirmDelete()}
          />
        )}
        <ManageDialog.Save testId="tag-save" disabled={!canSave} />
      </ManageDialog.Footer>
    </ManageDialog.Form>
  )
}
