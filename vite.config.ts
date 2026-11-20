import { defineConfig } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  build: {
    lib: {
      entry: {
        index: 'src/index.ts',
        cloudflare: 'src/edge/cloudflare.ts',
        deno: 'src/edge/deno.ts',
        vercel: 'src/edge/vercel.ts',
      },
      formats: ['es', 'cjs'],
    },
    rollupOptions: {
      external: [],
      output: {
        globals: {},
        entryFileNames: '[name].[format].js',
        chunkFileNames: '[name].[format].js',
      },
    },
    sourcemap: true,
    minify: 'terser',
    target: 'es2022',
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
});