// The design tokens live in src/shared/theme/tokens.ts (custom themes: main validates token
// names against the same map). This path stays so every renderer import and tokens.test.ts
// keep working; tokens.css is still the sheet beside this file.
export { TOKENS, type TokenName } from '../../../shared/theme/tokens'
