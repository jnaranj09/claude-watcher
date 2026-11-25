// Types for crap.mjs (tests/unit/crap.test.ts imports it).
export type Coverage = Map<string, Map<number, boolean>>
export interface FnRow {
  file: string
  name: string
  start: number
  end: number
  cc: number
}
export interface AllowEntry {
  file: string
  name: string
  crap: number
  reason?: string
}
export interface ScoredRow {
  file: string
  name: string
  cc: number
  cov: number
  hasData: boolean
  crap: number
  error: string | null
}
export interface Io {
  out: (line: string) => void
  err: (line: string) => void
}
export function crap(cc: number, cov: number): number
export function parseLcov(text: string): Coverage
export function parseCoverageText(text: string): Coverage
export function findFile(cov: Coverage, name: string): string | null
export function fnCoverage(
  cov: Coverage,
  fn: Pick<FnRow, 'file' | 'start' | 'end'>
): { cov: number; hasData: boolean }
export function scoreAll(fns: FnRow[], cov: Coverage): ScoredRow[]
export function validate(fns: unknown, allow: unknown): void
export function checkShrink(allow: AllowEntry[], base: AllowEntry[]): string[]
export function check(
  rows: ScoredRow[],
  allow: AllowEntry[],
  limit: number,
  ccCap: number
): string[]
export function main(argv: string[], io: Io): number
