import { defineConfig } from 'vitest/config';

export default defineConfig({
  build: {
    lib: {
      entry: 'src/main.ts',
      formats: ['es'],
      fileName: () => 'scadbridge.js',
    },
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    target: 'es2022',

  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
