// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import type { Plugin } from "vite";

/**
 * The dev devtools inject a `data-tsd-source` JSX attribute into every element.
 * react-three-fiber throws on unknown dashed props ("Cannot set data-tsd-source"),
 * so strip the attribute from files that render three.js elements.
 */
function stripDevtoolsSourceFromThreeFiles(): Plugin {
  return {
    name: "lovable:strip-tsd-source-in-three-files",
    enforce: "post",
    apply: "serve",
    transform(code, id) {
      if (!/src[/\\]components[/\\]book[/\\].*\.tsx/.test(id)) return null;
      if (!code.includes("data-tsd-source")) return null;
      return {
        code: code.replace(/"data-tsd-source":\s*"[^"]*",?/g, ""),
        map: null,
      };
    },
  };
}

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    plugins: [stripDevtoolsSourceFromThreeFiles()],
  },
});
