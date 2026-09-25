import { defineConfig } from 'vite'


export default defineConfig({
  publicDir: false,
  build: {
    emptyOutDir: false,
    outDir: 'dist',
    lib: {
      entry: 'src/dropin/index.ts',
      // Not 'PixelProvenance': Vite's IIFE `var` would overwrite the window API mount() sets.
      name: 'PixelProvenanceDropin',
      formats: ['iife'],
      fileName: () => 'pixelprovenance-dropin.js',
    },
  },
})
