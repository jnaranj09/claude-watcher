// The ManageDialog compound object — the ONE import a Manage dialog needs:
//   import { ManageDialog, useManageDialog } from '../ManageDialog/ManageDialog'
//   <ManageDialog.Provider {...dialog}><ManageDialog.Frame>…</ManageDialog.Frame></ManageDialog.Provider>
// Parts live in ManageDialogParts.tsx, the state contract in manageDialogState.ts. A `.ts` file on
// purpose: an object export beside components would trip react-refresh/only-export-components.
import {
  ManageDialogDelete,
  ManageDialogError,
  ManageDialogFooter,
  ManageDialogForm,
  ManageDialogFrame,
  ManageDialogGhostButton,
  ManageDialogHeader,
  ManageDialogHint,
  ManageDialogLabel,
  ManageDialogProvider,
  ManageDialogSave
} from './ManageDialogParts'

export const ManageDialog = {
  Provider: ManageDialogProvider,
  Frame: ManageDialogFrame,
  Header: ManageDialogHeader,
  Form: ManageDialogForm,
  Footer: ManageDialogFooter,
  Delete: ManageDialogDelete,
  Save: ManageDialogSave,
  Error: ManageDialogError,
  Label: ManageDialogLabel,
  Hint: ManageDialogHint,
  GhostButton: ManageDialogGhostButton
}

export { useManageDialog, useManageDialogContext } from './manageDialogState'
export type {
  ManageDialogActions,
  ManageDialogContextValue,
  ManageDialogMeta,
  ManageDialogState,
  UseManageDialogOptions
} from './manageDialogState'
