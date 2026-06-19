import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    // externalizeDepsPlugin keeps `dependencies` (incl. the native node-pty)
    // OUT of the Vite bundle so the native .node binary is loaded at runtime
    // from node_modules (Guardrail #2 / AC-2). Belt-and-suspenders: also pin
    // node-pty as an explicit rollup external.
    //
    // Story 2.4 — electron-store@11 is ESM-ONLY (`"type":"module"`). The packaged
    // main bundle is CommonJS, so a runtime `require('electron-store')` would throw
    // ERR_REQUIRE_ESM. The fix: EXCLUDE electron-store (and its ESM-only transitive
    // deps) from externalization so electron-vite/rollup BUNDLES + transpiles it INTO
    // the CJS main output. node-pty stays externalized (it is a native .node module
    // that MUST load from node_modules at runtime — never bundle it; Guardrail #2).
    // This is the load-bearing packaging fix proven by `npm run smoke` after build:dir.
    plugins: [externalizeDepsPlugin({ exclude: ['electron-store'] })],
    build: {
      rollupOptions: {
        external: ['node-pty']
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react()]
  }
})
