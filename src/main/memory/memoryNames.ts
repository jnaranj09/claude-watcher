// A memory filter names tags and goals (`tags`, `goal`); items store their ids. These lookups turn
// a name into the ids a workspace can see: its own tags and global ones, and its own goals. A
// match is the whole name, ignoring case. The stores are read late (index.ts passes getters), so
// this never holds a stale catalog.

/** What a memory search needs to resolve the names in its filters, per workspace. */
export interface MemoryNames {
  tagIdsByName(workspaceId: string, name: string): string[]
  goalIdsByName(workspaceId: string, name: string): string[]
}

type Named = { id: string; name: string; workspaceId: string | null }

function idsNamed(
  rows: readonly Named[],
  visible: (row: Named) => boolean,
  name: string
): string[] {
  const wanted = name.toLowerCase()
  return rows
    .filter((row) => visible(row) && row.name.toLowerCase() === wanted)
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
        name
      ),
    goalIdsByName: (workspaceId, name) =>
      idsNamed(source.goals(), (goal) => goal.workspaceId === workspaceId, name)
  }
}
