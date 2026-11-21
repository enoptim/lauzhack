import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// /api goes to the engine (cd model && uvicorn server:app --port 8000) in development.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:8000' } },
});
