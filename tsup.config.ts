import { defineConfig } from "tsup"

export default defineConfig({
    entry: { "ocdcp-cli": "index.ts" },
    format: ["esm"],
    dts: false,
    clean: true,
    sourcemap: true,
    noExternal: ["jsonc-parser"], // Bundle this to fix its broken ESM imports
})
