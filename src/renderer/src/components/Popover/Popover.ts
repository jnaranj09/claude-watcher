// The Popover compound object — the ONE import a popover needs:
//   import { Popover } from '../Popover/Popover'
// A `.ts` file on purpose (as ManageDialog.ts): an object export beside components would trip
// react-refresh/only-export-components.
import {
  PopoverCompactItem,
  PopoverDivider,
  PopoverItem,
  PopoverItemEnd,
  PopoverItemIcon,
  PopoverList,
  PopoverNote,
  PopoverQuietItem,
  PopoverSurface
} from './PopoverParts'
import { PopoverSubmenu } from './PopoverSubmenu'

export const Popover = {
  Surface: PopoverSurface,
  List: PopoverList,
  Item: PopoverItem,
  CompactItem: PopoverCompactItem,
  QuietItem: PopoverQuietItem,
  ItemIcon: PopoverItemIcon,
  ItemEnd: PopoverItemEnd,
  Divider: PopoverDivider,
  Note: PopoverNote,
  Submenu: PopoverSubmenu
}
export type { PopoverItemProps, PopoverListProps, PopoverSurfaceProps } from './PopoverParts'
export type { PopoverSubmenuProps } from './PopoverSubmenu'
