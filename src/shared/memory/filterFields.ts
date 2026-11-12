// Memory filter fields — the ONE list of what a memory list or search can be narrowed by. The
// renderer's filter bar, the `memory_search` / `memory_browse` tool inputs and the IPC request all
// read this list; a field is added here and nowhere else (plus its key in `MemoryFiltersSchema`,
// which the test pins to this list). Never logs a value: issue path + code only.
import { z } from 'zod'

/** What the filter bar draws and how the value is typed: folder/text = a trimmed non-empty string,
 *  tags = an array of non-empty strings, date = `YYYY-MM-DD`, toggle = boolean. */
export type MemoryFilterControl = 'folder' | 'text' | 'tags' | 'date' | 'toggle'

export const MEMORY_FILTER_FIELDS = [
  {
    name: 'folder',
    control: 'folder',
    description:
      'A folder path, or "here" for this session\'s folder. Matches the folder and below.'
  },
  { name: 'session', control: 'text', description: 'Part of a session name.' },
  { name: 'tags', control: 'tags', description: 'Tag names; an item with any of them matches.' },
  { name: 'since', control: 'date', description: 'First day, YYYY-MM-DD.' },
  { name: 'until', control: 'date', description: 'Last day, YYYY-MM-DD.' },
  { name: 'goal', control: 'text', description: 'Part of a goal name.' },
  {
    name: 'sessionDeleted',
    control: 'toggle',
    description: 'true: only items whose session was deleted.'
  },
  { name: 'includeStale', control: 'toggle', description: 'true: also items marked stale.' }
] as const satisfies readonly {
  name: string
  control: MemoryFilterControl
  description: string
}[]

export type MemoryFilterName = (typeof MEMORY_FILTER_FIELDS)[number]['name']

const TextValue = z.string().trim().min(1)
const DateValue = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { error: 'must be YYYY-MM-DD' })
  .refine(
    (v) => {
      const day = new Date(`${v}T00:00:00Z`)
      return !Number.isNaN(day.getTime()) && day.toISOString().startsWith(v)
    },
    { error: 'must be a real day' }
  )

const CONTROL_SCHEMAS = {
  folder: TextValue,
  text: TextValue,
  tags: z.array(TextValue),
  date: DateValue,
  toggle: z.boolean()
} as const

/** One optional key per field of `MEMORY_FILTER_FIELDS`; `satisfies Record<MemoryFilterName, …>`
 *  makes the compiler refuse a name the list lacks or a list name left out, and
 *  `filterFields.test.ts` pins each key's type to its control. */
const FILTER_SHAPE = {
  folder: CONTROL_SCHEMAS.folder.optional(),
  session: CONTROL_SCHEMAS.text.optional(),
  tags: CONTROL_SCHEMAS.tags.optional(),
  since: CONTROL_SCHEMAS.date.optional(),
  until: CONTROL_SCHEMAS.date.optional(),
  goal: CONTROL_SCHEMAS.text.optional(),
  sessionDeleted: CONTROL_SCHEMAS.toggle.optional(),
  includeStale: CONTROL_SCHEMAS.toggle.optional()
} satisfies Record<MemoryFilterName, z.ZodType>

export const MemoryFiltersSchema = z.object(FILTER_SHAPE).strict()
export type MemoryFilters = z.infer<typeof MemoryFiltersSchema>

function jsonType(control: MemoryFilterControl): Record<string, unknown> {
  switch (control) {
    case 'tags':
      return { type: 'array', items: { type: 'string' } }
    case 'toggle':
      return { type: 'boolean' }
    case 'folder':
    case 'text':
    case 'date':
      return { type: 'string' }
  }
}

/** The JSON-schema `properties` for a tool's input, built from the list. */
export function memoryFilterJsonSchema(): Record<string, unknown> {
  return Object.fromEntries(
    MEMORY_FILTER_FIELDS.map((f) => [
      f.name,
      { ...jsonType(f.control), description: f.description }
    ])
  )
}
