import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    // externalizeDepsPlugin keeps `dependencies` (incl. the native node-pty)
    // OUT of the Vite bundle so the native .node binary is loaded at runtime
    // from node_modules (Guardrail #2 / AC-2). Belt-and-suspenders: also pin
    // node-pty as an explicit rollup external.
    plugins: [externalizeDepsPlugin()],
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
