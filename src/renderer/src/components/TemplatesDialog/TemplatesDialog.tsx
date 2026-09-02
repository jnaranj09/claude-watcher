// Session templates — the Manage dialog (modal, z 60 like SessionNameDialog). Owns ONLY the
// selection; the list and the form are separate units. UX-DR14: App.tsx guards it against the
// other modals and closes it on the quit guard.
import { useState, type JSX, type KeyboardEvent } from 'react'
import { selectTemplates, useTemplates } from '../../stores/templatesStore'
import { TemplateForm } from './TemplateForm'
import { TemplateList } from './TemplateList'
import styles from './TemplatesDialog.module.css'

export interface TemplatesDialogProps {
  onClose: () => void
}

export function TemplatesDialog({ onClose }: TemplatesDialogProps): JSX.Element {
  const templates = useTemplates(selectTemplates)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = templates.find((t) => t.id === selectedId) ?? null

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
    }
  }

  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label="Templates"
      data-testid="templates-overlay"
      onKeyDown={handleKeyDown}
    >
      <div className={styles.panel} data-testid="templates-panel">
        <div className={styles.header}>
          <span className={styles.title}>Templates</span>
          <button
            type="button"
            className={styles.closeButton}
            data-testid="templates-close"
            aria-label="Close templates"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        <div className={styles.columns}>
          <TemplateList
            templates={templates}
            selectedId={selected?.id ?? null}
            onSelect={setSelectedId}
            onNew={() => setSelectedId(null)}
          />
          <TemplateForm
            key={selected?.id ?? 'new'}
            template={selected}
            onSaved={(t) => setSelectedId(t.id)}
            onRemoved={() => setSelectedId(null)}
          />
        </div>
      </div>
    </div>
  )
}
