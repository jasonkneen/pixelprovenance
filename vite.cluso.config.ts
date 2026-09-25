import { defineConfig } from 'vite'


export default defineConfig({
  publicDir: false,
  build: {
    emptyOutDir: false,
    outDir: 'dist',
    lib: {
      entry: 'src/cluso/auto.ts',
      name: 'PixelProvenanceCluso',
      formats: ['iife'],
      fileName: () => 'pixelprovenance-cluso.js',
    },
  },
})
