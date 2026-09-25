import { defineConfig } from 'vite'

export default defineConfig({
  publicDir: false,
  build: {
    emptyOutDir: false,
    outDir: 'dist',
    lib: {
      entry: 'src/dropin/index.ts',
      name: 'PixelProvenance',
      formats: ['iife'],
      fileName: () => 'pixelprovenance-dropin.js',
    },
  },
})
