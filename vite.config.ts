import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: "0.0.0.0",
    proxy: {
      "/npc": "http://127.0.0.1:8080",
    },
    watch: { ignored: ["**/.ai/**", "**/.ohno/**", "**/coverage/**", "**/test-results/**"] },
  },
  build: { target: "es2022" },
});
