import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],

  build: {
    target: 'es2015',
    cssCodeSplit: true,
    reportCompressedSize: false, // faster CI builds

    rollupOptions: {
      output: {
        manualChunks(id) {
          if (
            id.includes('node_modules/react/') ||
            id.includes('node_modules/react-dom/') ||
            id.includes('node_modules/scheduler/')
          ) return 'react-vendor';

          if (id.includes('node_modules/react-router')) return 'router';

          if (
            id.includes('@firebase/auth') ||
            id.includes('firebase/auth')
          ) return 'firebase-auth';

          if (
            id.includes('@firebase/firestore') ||
            id.includes('firebase/firestore')
          ) return 'firebase-db';

          if (
            id.includes('@firebase/app') ||
            id.includes('firebase/app') ||
            id.includes('@firebase/util') ||
            id.includes('@firebase/component') ||
            id.includes('@firebase/logger')
          ) return 'firebase-core';

          if (id.includes('node_modules/xlsx')) return 'xlsx-lib';

          if (id.includes('node_modules/react-helmet')) return 'helmet';
        },

        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },

    chunkSizeWarningLimit: 600,
  },

  esbuild: {
    drop: process.env.NODE_ENV === 'production' ? ['console', 'debugger'] : [],
    legalComments: 'none',
  },
})
