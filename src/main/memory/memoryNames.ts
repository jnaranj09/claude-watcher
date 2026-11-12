// A memory filter names tags and goals (`tags`, `goal`); items store their ids. These lookups turn
// a name into the ids a workspace can see: its own tags and global ones, and its own goals. As the
// filter fields describe them (`shared/memory/filterFields.ts`), a tag matches by its whole name and
// a goal by part of its name; both ignore case and surrounding spaces, and a blank name matches
// nothing (never every goal). The stores are read late (index.ts passes getters), so this never
// holds a stale catalog.

/** What a memory search needs to resolve the names in its filters, per workspace. */
export interface MemoryNames {
  tagIdsByName(workspaceId: string, name: string): string[]
  goalIdsByName(workspaceId: string, name: string): string[]
}

type Named = { id: string; name: string; workspaceId: string | null }
type Matches = (rowName: string, wanted: string) => boolean

const wholeName: Matches = (rowName, wanted) => rowName === wanted
const partOfName: Matches = (rowName, wanted) => rowName.includes(wanted)

function idsNamed(
  rows: readonly Named[],
  visible: (row: Named) => boolean,
  name: string,
  matches: Matches
): string[] {
  const wanted = name.trim().toLowerCase()
  if (wanted === '') return []
  return rows
    .filter((row) => visible(row) && matches(row.name.toLowerCase(), wanted))
    .map((row) => row.id)
}

export function memoryNameLookups(source: {
  tags: () => readonly Named[]
  goals: () => readonly Named[]
}): MemoryNames {
  return {
    tagIdsByName: (workspaceId, name) =>
      idsNamed(
        source.tags(),
        (tag) => tag.workspaceId === null || tag.workspaceId === workspaceId,
        name,
        wholeName
      ),
    goalIdsByName: (workspaceId, name) =>
      idsNamed(source.goals(), (goal) => goal.workspaceId === workspaceId, name, partOfName)
  }
}
