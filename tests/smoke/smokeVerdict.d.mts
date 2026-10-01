export type WebglMode = 'strict' | 'optional'
export function webglMode(env: Record<string, string | undefined>): WebglMode
export function evaluateVerdict(
  report: unknown,
  mode: WebglMode
): { ok: boolean; warnings: string[] }
