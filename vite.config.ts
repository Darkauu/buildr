// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import type { Plugin } from "vite";

// The dev-only devtools plugin annotates every JSX element with `data-tsd-source`.
// react-three-fiber cannot apply unknown dashed props to three.js objects
// ("R3F: Cannot set \"data-tsd-source\""), so strip the annotation from the 3D scene files.
function stripSourceAnnotationsFromThreeJsx(): Plugin {
  return {
    name: "strata:strip-tsd-source-in-three",
    enforce: "post",
    transform(code, id) {
      if (!id.includes("/components/three/")) return null;
      if (!code.includes("data-tsd-source")) return null;
      return {
        code: code
          .replace(/\s*"data-tsd-source":\s*"[^"]*",?/g, "")
          .replace(/\s*data-tsd-source="[^"]*"/g, ""),
        map: null,
      };
    },
  };
}

export default defineConfig({
  vite: {
    plugins: [stripSourceAnnotationsFromThreeJsx()],
  },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
