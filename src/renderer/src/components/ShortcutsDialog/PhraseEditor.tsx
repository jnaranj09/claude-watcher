// The phrase editor: the Phrase field full size, laid over the whole Shortcuts panel (the panel is
// its containing block). Not a second dialog — it edits the SAME draft as the form's field, so
// there is nothing to save or cancel here: Done (or Escape) only goes back to the form.
import { useEffect, useRef, type JSX, type KeyboardEvent } from 'react'
import { SHORTCUT_TEXT_MAX_LENGTH } from '../../../../shared/schemas/shortcut'
import { Button } from '../Button/Button'
import { TextArea } from '../TextArea/TextArea'
import { PlaceholderHelp } from './PlaceholderHelp'
import styles from './ShortcutsDialog.module.css'

export interface PhraseEditorProps {
  value: string
  onChange: (next: string) => void
  /** Done or Escape. The caller puts focus back on the button that opened the editor. */
  onClose: () => void
}

export function PhraseEditor({ value, onChange, onClose }: PhraseEditorProps): JSX.Element {
  const textRef = useRef<HTMLTextAreaElement | null>(null)

  // Whoever opens the surface owns the focus (design.md).
  useEffect(() => {
    textRef.current?.focus()
  }, [])

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    if (e.key !== 'Escape') return
    // Peel ONE layer: the dialog's Frame must not also see this Escape and close.
    e.preventDefault()
    e.stopPropagation()
    onClose()
  }

  return (
    <div
      className={styles.phraseEditor}
      role="group"
      aria-labelledby="phrase-editor-title"
      data-testid="phrase-editor"
      onKeyDown={handleKeyDown}
    >
      <h3 id="phrase-editor-title" className={styles.phraseEditorTitle}>
        Phrase
      </h3>
      <TextArea
        testId="phrase-editor-text"
        ariaLabel="Phrase"
        value={value}
        onChange={onChange}
        maxLength={SHORTCUT_TEXT_MAX_LENGTH}
        textAreaRef={textRef}
        fill
      />
      <PlaceholderHelp testId="phrase-editor-placeholders" />
      <div className={styles.phraseEditorFooter}>
        <Button variant="primary" testId="phrase-editor-done" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  )
}
