// Session templates — the popover under `+ New session`. Pure props (no store access) so it
// is trivially testable; NewSessionButton.tsx owns open/close and the outside-click.
import { useEffect, useRef, useState, type KeyboardEvent, type JSX } from 'react'
import type { Template } from '../../../../shared/ipc/contract'
import { describeTemplateFlags } from '../TemplatesDialog/templateForm'
import { filterTemplates } from './filterTemplates'
import { Popover } from '../Popover/Popover'
import { TextInput } from '../TextInput/TextInput'
import styles from './NewSessionMenu.module.css'

export interface NewSessionMenuProps {
  templates: Template[]
  onPickFolder: () => void
  onPickTemplate: (template: Template) => void
  onManage: () => void
  onClose: () => void
}

const ITEM = '[data-menu-item]'

export function NewSessionMenu({
  templates,
  onPickFolder,
  onPickTemplate,
  onManage,
  onClose
}: NewSessionMenuProps): JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const [query, setQuery] = useState('')
  const filtered = filterTemplates(templates, query)

  useEffect(() => {
    searchRef.current?.focus()
  }, [])

  function moveFocus(from: Element, delta: 1 | -1): void {
    const items = Array.from(rootRef.current?.querySelectorAll<HTMLElement>(ITEM) ?? [])
    const index = items.indexOf(from as HTMLElement)
    const next = items[index + delta]
    if (next !== undefined) next.focus()
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      moveFocus(e.target as Element, e.key === 'ArrowDown' ? 1 : -1)
      return
    }
    if (e.key === 'Enter' && e.target === searchRef.current) {
      e.preventDefault()
      const first = filtered[0]
      if (first !== undefined) onPickTemplate(first)
    }
  }

  return (
    <div className={styles.menu}>
      <Popover.Surface
        surfaceRef={rootRef}
        role="dialog"
        aria-label="New session"
        testId="new-session-menu"
        onKeyDown={handleKeyDown}
      >
        <Popover.Item data-menu-item testId="menu-pick-folder" onClick={onPickFolder}>
          <Popover.ItemIcon>
            {/* Inline SVG folder (same convention as the SessionCard pencil): no icon dependency,
                `currentColor` follows the text ramp. The label is the accessible name. */}
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M1.5 4a1 1 0 0 1 1-1h3.4l1.6 1.6h6a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z" />
            </svg>
          </Popover.ItemIcon>
          Pick a folder…
        </Popover.Item>
        <Popover.Divider />
        <TextInput
          inputRef={searchRef}
          menuItem
          testId="menu-search"
          ariaLabel="Search templates"
          placeholder="Search templates"
          value={query}
          onChange={setQuery}
        />
        <Popover.List>
          {filtered.length === 0 ? (
            <Popover.Note testId="menu-empty">
              {templates.length === 0 ? 'No templates yet' : 'No matches'}
            </Popover.Note>
          ) : (
            filtered.map((t) => (
              <Popover.Item
                key={t.id}
                data-menu-item
                data-template-id={t.id}
                testId="menu-template"
                onClick={() => onPickTemplate(t)}
              >
                <span className={styles.rowText}>
                  <span className={styles.rowName}>{t.name}</span>
                  <span className={styles.rowPath}>{t.cwd}</span>
                  <span className={styles.rowMeta}>{describeTemplateFlags(t)}</span>
                </span>
              </Popover.Item>
            ))
          )}
        </Popover.List>
        <Popover.Divider />
        <Popover.Item data-menu-item testId="menu-manage" onClick={onManage}>
          Manage templates…
        </Popover.Item>
      </Popover.Surface>
    </div>
  )
}
