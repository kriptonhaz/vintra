import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import viteTsConfigPaths from 'vite-tsconfig-paths'

// Standalone Node server build, deployed to Lightsail via PM2 + nginx.
// Build output:
//   - `dist/server/server.js` → Web-Fetch handler (wrapped by server-entry.mjs)
//   - `dist/client/`          → static assets served by nginx
// PM2 entry is `apps/web/server-entry.mjs`, which adapts the Fetch handler
// to a Node HTTP server via @hono/node-server.
export default defineConfig({
  plugins: [
    viteTsConfigPaths({
      projects: ['./tsconfig.json'],
    }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
})
