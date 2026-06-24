import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      "/ask":         "http://localhost:8000",
      "/translate":   "http://localhost:8000",
      "/voice":       "http://localhost:8000",
      "/reset":       "http://localhost:8000",
      "/health":      "http://localhost:8000",
      "/upload-face": "http://localhost:8000",
      "/static":      "http://localhost:8000",
      "/voices":      "http://localhost:8000",
      "/culture":     "http://localhost:8000",
      "/analyze-file":"http://localhost:8000",
      "/meeting":     "http://localhost:8000",
      "/ws": {
        target: "http://localhost:8000",
        ws: true,
      },
    },
  },
  build: {
    outDir: "dist",
  },
});
