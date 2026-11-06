import { version } from './package.json'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'

export default defineConfig(() => ({
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util', '@ffmpeg/core'],
  },
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  plugins: [
    react(),
    electron([
      {
        entry: 'electron/main.ts',
        vite: {
          build: {
            rollupOptions: { external: ['onnxruntime-node'] },
          },
        },
      },
      {
        vite: {
          build: {
            rollupOptions: {
              external: ['onnxruntime-node'],
              input: { 'separation-worker': 'electron/separation-worker.ts' },
              output: {
                entryFileNames: 'separation-worker.cjs',
                format: 'cjs',
                inlineDynamicImports: true,
              },
            },
          },
        },
      },
      {
        onstart: ({ reload }) => reload(),
        vite: {
          build: {
            rollupOptions: {
              input: { 'preload/index': 'electron/preload.ts' },
              output: {
                entryFileNames: 'preload/index.cjs',
                format: 'cjs',
              },
            },
          },
        },
      },
    ]),
  ],
}))
