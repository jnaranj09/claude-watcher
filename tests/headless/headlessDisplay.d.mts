export function startHeadlessDisplay(): Promise<{
  env: (base: NodeJS.ProcessEnv) => NodeJS.ProcessEnv
  stop: () => void
}>
