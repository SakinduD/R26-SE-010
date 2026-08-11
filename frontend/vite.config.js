import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  optimizeDeps: {
    // TalkingHead loads its lip-sync language modules via a runtime-computed
    // dynamic import() (e.g. "./lipsync-en.mjs"). Vite's dep pre-bundling
    // can't statically resolve that specifier and rewrites it into
    // .vite/deps/ where the file doesn't exist, breaking lip sync at
    // runtime. Excluding the package serves it as native ESM instead, so
    // its own relative imports resolve correctly.
    exclude: ["@met4citizen/talkinghead"],
  },
})
