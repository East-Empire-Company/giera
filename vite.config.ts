import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: "0.0.0.0",
    watch: { ignored: ["**/.ai/**", "**/.ohno/**", "**/coverage/**", "**/test-results/**"] },
  },
  build: { target: "es2022" },
});
