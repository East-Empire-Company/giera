import { defineConfig } from "vite";

const backendOrigin = process.env.GIERA_TEST_BACKEND_ORIGIN ?? "http://127.0.0.1:8080";

export default defineConfig({
  define: {
    __GIERA_TEST_WS_URL__: JSON.stringify(process.env.GIERA_TEST_WS ?? ""),
  },
  server: {
    host: "0.0.0.0",
    proxy: {
      "/npc": backendOrigin,
      "/speech": backendOrigin,
      "/concierge": backendOrigin,
    },
    watch: { ignored: ["**/.ai/**", "**/.ohno/**", "**/coverage/**", "**/test-results/**"] },
  },
  build: { target: "es2022" },
});
