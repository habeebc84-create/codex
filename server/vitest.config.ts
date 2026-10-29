import { defineConfig } from 'vitest/config';

// node:sqlite is a Node 24 builtin. Vitest's Vite pipeline tries to resolve
// it as a file unless it is marked external for SSR.
export default defineConfig({
  ssr: {
    external: ['node:sqlite'],
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
