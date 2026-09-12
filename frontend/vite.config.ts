import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // The MD5 library is imported by the upload worker only after a file is
  // selected. Without pre-bundling it, Vite discovers the dependency during
  // the first upload and reloads the development page, abandoning that upload.
  optimizeDeps: {
    include: ['spark-md5'],
  },
  server: {
    host: true,
    port: 5173,
  },
  worker: {
    format: 'es',
  },
});
