import { defineConfig } from 'vite';

export default defineConfig({
  build: { target: 'es2022' },
  optimizeDeps: { exclude: ['@dimforge/rapier3d-compat'] },
});
