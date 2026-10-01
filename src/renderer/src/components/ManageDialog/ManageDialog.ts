// The ManageDialog compound object — the ONE import a Manage dialog needs:
//   import { ManageDialog, useManageDialog } from '../ManageDialog/ManageDialog'
//   <ManageDialog.Provider {...dialog}><ManageDialog.Frame>…</ManageDialog.Frame></ManageDialog.Provider>
// Parts live in ManageDialogParts.tsx, the state contract in manageDialogState.ts. A `.ts` file on
// purpose: an object export beside components would trip react-refresh/only-export-components.
import {
  ManageDialogColumns,
  ManageDialogDelete,
  ManageDialogFooter,
  ManageDialogForm,
  ManageDialogFrame,
  ManageDialogGhostButton,
  ManageDialogHeader,
  ManageDialogHint,
  ManageDialogLabel,
  ManageDialogList,
  ManageDialogMessage,
  ManageDialogNew,
  ManageDialogPane,
  ManageDialogPlaceholder,
  ManageDialogProvider,
  ManageDialogRow,
  ManageDialogRowActions,
  ManageDialogRows,
  ManageDialogSave
} from './ManageDialogParts'

export const ManageDialog = {
  Provider: ManageDialogProvider,
  Frame: ManageDialogFrame,
  Header: ManageDialogHeader,
  Columns: ManageDialogColumns,
  List: ManageDialogList,
  Rows: ManageDialogRows,
  Row: ManageDialogRow,
  RowActions: ManageDialogRowActions,
  New: ManageDialogNew,
  Form: ManageDialogForm,
  Pane: ManageDialogPane,
  Placeholder: ManageDialogPlaceholder,
  Footer: ManageDialogFooter,
  Delete: ManageDialogDelete,
  Save: ManageDialogSave,
  Message: ManageDialogMessage,
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
