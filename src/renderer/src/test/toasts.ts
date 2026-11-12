// Reads a Manage dialog's ONE result toast (spec 2026-10-26 dialog toasts): every action result a
// dialog reports is a toast keyed `dialog:<testIdPrefix>` in the toast store, not a line in the
// dialog. A test asserts its `kind` and `title`.
import { dialogToastKey, toastStore, type Toast } from '../stores/toastStore'

/** The live (not fading) toast keyed `dialog:<prefix>`, or undefined. */
export function dialogToast(prefix: string): Toast | undefined {
  return toastStore.getState().toasts.find((t) => !t.leaving && t.key === dialogToastKey(prefix))
}
