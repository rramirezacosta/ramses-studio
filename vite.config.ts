import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron/simple'

export default defineConfig(({ mode }) => ({
  define: {
    __CPU_ONLY__: JSON.stringify(mode === 'cpu'),
  },
  plugins: [
    react(),
    electron({
      main: {
        entry: 'electron/main.ts',
        vite: {
          build: {
            rollupOptions: { external: ['onnxruntime-node'] },
          },
        },
      },
      preload: {
        input: 'electron/preload.ts',
        vite: {
          build: {
            rollupOptions: {
              output: {
                entryFileNames: 'preload/index.cjs',
                format: 'cjs',
              },
            },
          },
        },
      },
    }),
  ],
}))
