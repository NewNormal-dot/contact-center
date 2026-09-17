import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import {defineConfig} from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    // NOTE: there is deliberately no `define` for GEMINI_API_KEY here.
    // `define` performs a literal text substitution into the FRONTEND
    // bundle, so if that variable were ever set at build time the key would
    // ship inside public JavaScript. No code in this app uses it (the
    // @google/genai dependency is imported by nothing) - it was left over
    // from the AI Studio scaffold. A server-side key must be read from
    // process.env in server code, never defined into the client.
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify - file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
