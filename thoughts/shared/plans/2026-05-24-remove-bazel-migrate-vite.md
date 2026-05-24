# Remove Bazel / Migrate to Vite Implementation Plan

## Overview

Replace Bazel + Bazelisk with Vite (dev + prod build), removing Electron and VSCode extension
scaffolding in the process. End state: standard pnpm + Vite project. Commands become
`pnpm dev`, `pnpm build`, `pnpm test`, `pnpm test:e2e`.

## Current State Analysis

- **Build system:** Bazel 8 via Bazelisk. 9 BUILD files across repo. All TS compilation,
  bundling, devserver, font downloading, and test running goes through Bazel.
- **Bundler:** esbuild via `aspect_rules_esbuild` (config already in `client/esbuild.config.mjs`).
- **Dev server:** `js_run_devserver` in `client/BUILD` — runs `http-server` on Bazel's output.
- **Fonts:** Downloaded at build time from Adobe GitHub CDN by Bazel (`http_file` rules in
  `MODULE.bazel`), SHA256-verified, copied to `client/public/fonts/`.
- **Mocha tests:** Bazel compiles `.spec.ts` → `.js` first, then runs `mocha` on compiled output.
  `bazel/resolve-extensions-loader.mjs` handles extensionless ESM imports.
- **Playwright e2e:** `bazel/playwright-runner.mjs` (200-line custom runner) starts a static
  file server and invokes Playwright.
- **Path alias:** `#asciiflow/*` → repo root. Handled three ways simultaneously:
  `tsconfig.json` paths, `package.json` `"imports"` map (Node-native), and
  `client/esbuild.config.mjs` plugin. Vite uses a fourth — `resolve.alias` in `vite.config.ts`.

## Desired End State

```
pnpm dev           # Vite dev server with HMR on http://localhost:5173
pnpm build         # Vite prod build → dist/
pnpm preview       # Serve dist/ locally (used by e2e tests)
pnpm test          # Mocha unit tests (tsx compiles TS on the fly)
pnpm test:e2e      # Playwright e2e (auto-starts vite preview)
```

No Bazel, no Bazelisk, no Electron, no VSCode extension. Node version managed by `.nvmrc`.

### Key Discoveries

- `package.json` already has `"imports": { "#asciiflow/*": "./*" }` — Node resolves the alias
  natively, so Mocha tests don't need a custom loader for it. `file:client/package.json`
- `client/index.html` loads `bundle.css` (link) and `bundle.js` (script). Both must be replaced
  with Vite's module script. `file:client/index.html:16,159`
- `@vitejs/plugin-react` needs `jsxRuntime: 'classic'` — project uses React 16 (no automatic
  JSX runtime). `file:package.json`
- `testing/test_setup.ts` shims `localStorage` and `window` for Node — must run before spec
  files. Uses `--file` in mocha (not `--require`, since the project is `"type": "module"`).
- `electron/index.js` is the only root-adjacent Electron file. `"main": "index.js"` and
  `"start": "electron ."` in `package.json` are Electron artefacts to remove.
- `bazel/resolve-extensions-loader.mjs` is still needed for Mocha (adds `.js` extension to
  extensionless ESM imports). Move to `testing/` before deleting `bazel/`.

## What We're NOT Doing

- Not migrating Mocha to Vitest
- Not changing any source files in `client/`, `common/`, or `e2e/`
- Not adding ESLint, Prettier, or any other tooling
- Not setting up CI (GitHub Actions, etc.)
- Not building a PWA (tracked separately as issue #346)

## BUILD File → New Workflow Mapping

| BUILD file | Bazel role | New equivalent |
|---|---|---|
| `BUILD` (root) | Links npm packages, exports tsconfig | Deleted — pnpm manages `node_modules` |
| `client/BUILD` | TS compile, esbuild bundle, devserver, font copy, site filegroup | `vite.config.ts` |
| `common/BUILD` | Compile `common/*.ts` | Nothing — Vite alias resolves it |
| `testing/BUILD` | Compile `test_setup.ts` | Nothing — `tsx` compiles on the fly |
| `e2e/BUILD` | Static server + Playwright runner | `webServer` in `playwright.config.mjs` |
| `electron/BUILD` | Electron desktop build | Deleted with `electron/` dir |
| `site/BUILD` | Copy client:site → `site/` dir | Deleted — Vite outputs to `dist/` |
| `bazel/BUILD` | Export runner + loader scripts | Deleted — runner dropped, loader moved |
| `vscode/BUILD` | VSCode extension compile | Deleted with `vscode/` dir |

---

## Phase 1: Vite Setup (dev + prod build)

### Overview
Install Vite, create `vite.config.ts`, patch `client/index.html`, and wire up `package.json`
scripts. After this phase the app builds and runs without Bazel.

### Changes Required

#### 1. Install new dev dependencies

```bash
pnpm add -D vite @vitejs/plugin-react tsx
```

- `vite` — dev server + prod bundler
- `@vitejs/plugin-react` — JSX transform + React Fast Refresh
- `tsx` — TypeScript ESM loader for Mocha (Phase 3)

#### 2. Create `vite.config.ts` (repo root)

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  root: "client",
  plugins: [
    react({ jsxRuntime: "classic" }),
  ],
  resolve: {
    alias: [
      {
        find: /^#asciiflow\/(.*)/,
        replacement: path.resolve(__dirname, "$1"),
      },
    ],
  },
  build: {
    outDir: path.resolve(__dirname, "dist"),
    emptyOutDir: true,
  },
});
```

Notes:
- `root: "client"` — Vite treats `client/` as the web root. `client/public/` becomes the
  static assets dir, served at `/`. Fonts at `/public/fonts/...` match existing `index.html`.
- `jsxRuntime: "classic"` — required for React 16 (no `react/jsx-runtime`).
- `build.outDir` absolute path required because root is `client/`.

#### 3. Patch `client/index.html`

Remove the pre-built asset references and add Vite's module entry point.

**Remove** this line (Vite injects CSS automatically in both dev and prod):
```html
<link rel="stylesheet" href="bundle.css" />
```

**Replace** the existing bundle script tag:
```html
<!-- remove this: -->
<script src="bundle.js"></script>

<!-- add this: -->
<script type="module" src="/app.tsx"></script>
```

#### 4. Update `package.json` scripts

Replace the Electron `start` script and add Vite scripts:

```json
"scripts": {
  "dev": "vite",
  "build": "vite build",
  "preview": "vite preview",
  "test": "node --loader tsx/esm --loader ./testing/resolve-extensions-loader.mjs node_modules/.bin/mocha --file testing/test_setup.ts 'client/**/*.spec.ts'",
  "test:e2e": "playwright test --config e2e/playwright.config.mjs"
}
```

Also remove Electron-specific top-level fields:
```json
// remove:
"main": "index.js",
"icon": "images/favicon.png",
```

### Success Criteria

#### Automated Verification:
- [ ] `pnpm build` exits 0, produces `dist/index.html`, `dist/assets/*.js`, `dist/assets/*.css`
- [ ] `pnpm preview` serves `dist/` on port 4173 without errors

#### Manual Verification:
- [ ] `pnpm dev` starts Vite dev server, app loads in browser at `http://localhost:5173`
- [ ] Drawing tools work, canvas renders, dark mode toggles correctly
- [ ] HMR: edit a source file, browser updates without full reload
- [ ] `pnpm build && pnpm preview` — prod build works identically to dev

**Pause here for manual confirmation before proceeding.**

---

## Phase 2: Commit Fonts

### Overview
Bazel currently downloads Source Code Pro from Adobe's GitHub CDN at build time.
Commit the two woff2 files directly to the repo so no download step is needed.

### Changes Required

#### 1. Download and commit font files

```bash
# From repo root
mkdir -p client/public/fonts
curl -o client/public/fonts/SourceCodePro-Regular.woff2 \
  https://raw.githubusercontent.com/adobe-fonts/source-code-pro/release/WOFF2/TTF/SourceCodePro-Regular.ttf.woff2

curl -o client/public/fonts/SourceCodePro-Medium.woff2 \
  https://raw.githubusercontent.com/adobe-fonts/source-code-pro/release/WOFF2/TTF/SourceCodePro-Medium.ttf.woff2
```

Verify SHA256 checksums (from `MODULE.bazel`):
- Regular: `714eee29b70d191f5bf4b3a06b68f2c50522b1303d31c7d44dcefdcc5f9defd0`
- Medium: `924641f3612b80982d2d32350d4bed27fad682d7220b3dcf2f3370c94b949c34`

`client/index.html` already references `/public/fonts/SourceCodePro-Regular.woff2` and
`/public/fonts/SourceCodePro-Medium.woff2` — **no HTML changes needed**.

With Vite `root: "client"`, files in `client/public/` are served at `/` in dev and copied
to `dist/` on build. Path `/public/fonts/x.woff2` maps to `client/public/fonts/x.woff2`. ✓

### Success Criteria

#### Automated Verification:
- [ ] Both `.woff2` files exist in `client/public/fonts/`
- [ ] SHA256 checksums match values above

#### Manual Verification:
- [ ] `pnpm dev` — font loads correctly (Source Code Pro renders in browser, not fallback monospace)
- [ ] Network tab shows font requests returning 200

**Pause here for manual confirmation before proceeding.**

---

## Phase 3: Mocha Unit Tests

### Overview
Wire up `pnpm test` without Bazel. Bazel previously compiled `.spec.ts` → `.js` before
running Mocha. `tsx` replaces this compilation step inline.

### Changes Required

#### 1. Move `resolve-extensions-loader.mjs`

```bash
mv bazel/resolve-extensions-loader.mjs testing/resolve-extensions-loader.mjs
```

(The `bazel/` directory is deleted in Phase 5; move the file now so it's available for tests.)

#### 2. `pnpm test` script (already added in Phase 1)

```
node --loader tsx/esm --loader ./testing/resolve-extensions-loader.mjs \
  node_modules/.bin/mocha \
  --file testing/test_setup.ts \
  'client/**/*.spec.ts'
```

How it works:
- `--loader tsx/esm` — Node hook that compiles `.ts` files to JS on the fly
- `--loader ./testing/resolve-extensions-loader.mjs` — adds `.js` to extensionless ESM imports
  (e.g. `import './foo'` → `import './foo.js'`)
- `package.json` `"imports"` handles `#asciiflow/*` natively — no custom loader needed
- `--file testing/test_setup.ts` — runs `localStorage`/`window` shim before all spec files

#### 3. Update `tsconfig.json` paths

Remove Bazel output dirs from paths (they won't exist):

```json
// Before:
"#asciiflow/*": ["*", "bazel-bin/*", "bazel-genfiles/*"]

// After:
"#asciiflow/*": ["*"]
```

Also update `exclude`:
```json
// Before:
"exclude": ["bazel-*", "node_modules"]

// After:
"exclude": ["dist", "node_modules"]
```

### Success Criteria

#### Automated Verification:
- [ ] `pnpm test` exits 0
- [ ] All 3 spec files run: `client/layer.spec.ts`, `client/store/store.spec.ts`,
  `client/store/drawing_stringifier.spec.ts`
- [ ] No test failures

**Pause here for manual confirmation before proceeding.**

---

## Phase 4: Playwright E2E Tests

### Overview
Replace `bazel/playwright-runner.mjs` (custom server + Playwright orchestrator) with
Playwright's built-in `webServer` config option.

### Changes Required

#### 1. Update `e2e/playwright.config.mjs`

Add a `webServer` block that starts `vite preview` before tests run:

```javascript
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.js",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "list",
  webServer: {
    command: "pnpm preview --port 8080",
    port: 8080,
    reuseExistingServer: !process.env.CI,
  },
  use: {
    baseURL: "http://127.0.0.1:8080",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        headless: true,
        launchOptions: {
          args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu",
          ],
        },
      },
    },
  ],
});
```

Note: `pnpm preview` requires a prior `pnpm build`. The `test:e2e` script should
build first:

```json
"test:e2e": "pnpm build && playwright test --config e2e/playwright.config.mjs"
```

### Success Criteria

#### Automated Verification:
- [ ] `pnpm test:e2e` exits 0
- [ ] All tests in `e2e/app.spec.js` pass

#### Manual Verification:
- [ ] Playwright opens Chromium, tests run against the preview server
- [ ] No server startup errors in output

**Pause here for manual confirmation before proceeding.**

---

## Phase 5: Delete Bazel + Electron + VSCode

### Overview
Remove all Bazel infrastructure, Electron desktop wrapper, VSCode extension scaffold,
and the `site/` intermediary directory.

### Files and Directories to Delete

```
# Bazel config files (root)
MODULE.bazel
WORKSPACE
.bazelversion
ts_library.bzl
copy_files.bzl
.bazelignore          # if present

# All BUILD files
BUILD
client/BUILD
common/BUILD
testing/BUILD
e2e/BUILD
electron/BUILD
site/BUILD
bazel/BUILD
vscode/BUILD

# Bazel directories
bazel/                # entire dir (playwright-runner.mjs, playwright.bzl — no longer needed)
                      # resolve-extensions-loader.mjs was moved to testing/ in Phase 3

# Electron
electron/             # entire dir (index.js + BUILD)

# Site intermediary
site/                 # entire dir (just a BUILD wrapping client:site)

# VSCode extension
vscode/               # entire dir (extension.ts + BUILD)
```

### Additional Cleanup

#### `package.json` — remove pnpm security overrides (obsolete)
```json
// remove the entire pnpm.overrides block:
"pnpm": {
  "onlyBuiltDependencies": [...],   // keep this
  "overrides": {                    // remove this entire block
    "postcss@<7.0.36": ">=7.0.36",
    ...
  }
}
```

#### `.gitignore` — update
```
# remove:
bazel-*

# add:
dist/
```

#### Add `.nvmrc` (repo root)
```
22
```
Replaces Bazel's pinned Node 22.12.0 toolchain. `nvm use` will pick this up.

#### Regenerate lock file
```bash
pnpm install
```
Picks up the new `vite`, `@vitejs/plugin-react`, `tsx` deps; drops nothing (no Bazel
deps were in `package.json` — they were managed purely by Bazel).

### Success Criteria

#### Automated Verification:
- [ ] No `bazel*` files or directories remain in repo root
- [ ] `pnpm dev` still starts (Vite config unaffected)
- [ ] `pnpm build` still succeeds
- [ ] `pnpm test` still passes
- [ ] `pnpm test:e2e` still passes
- [ ] `git status` shows only expected deletions — no missing source files

**Pause here for manual confirmation before proceeding.**

---

## Phase 6: Update Documentation

### Overview
Update `CLAUDE.md` to reflect the new toolchain. Remove all Bazel/Bazelisk references,
Electron references, and VSCode extension references.

### Changes Required

#### `CLAUDE.md` sections to update

**Stack section** — replace:
```markdown
- **Build:** Bazel 8 (via Bazelisk) + esbuild (via aspect_rules_esbuild)
- **Desktop:** Electron 29.0.1
```
with:
```markdown
- **Build:** Vite 6 (dev server + prod bundle via esbuild)
```

**Build & Dev section** — replace entire block:
```markdown
## Build & Dev

\`\`\`bash
pnpm dev            # Dev server with HMR (http://localhost:5173)
pnpm build          # Production build → dist/
pnpm preview        # Serve dist/ locally
pnpm test           # Mocha unit tests
pnpm test:e2e       # Playwright e2e tests
\`\`\`

Requires Node 22.x (use `.nvmrc`: `nvm use`). Uses pnpm.
```

**Project Structure section** — remove:
```
bazel/                 # Bazel build infrastructure
  playwright.bzl       # playwright_test() rule for e2e tests
  playwright-runner.mjs # Playwright test runner with static server
  resolve-extensions-loader.mjs # ESM loader for .ts extension resolution
```
Update `testing/` entry to note `resolve-extensions-loader.mjs` lives there now.
Remove `electron/` entry.

**Conventions section** — remove:
```markdown
- Bazel BUILD files per directory
```
Replace with:
```markdown
- Vite handles TS compilation, bundling, and dev server (`vite.config.ts` at repo root)
```

**Issue Priority List** — remove or update:
- Issue #346 (PWA — replaces Electron): update note from "replaces Electron" to "Electron removed"

### Success Criteria

#### Manual Verification:
- [ ] `CLAUDE.md` contains no references to `bazel`, `Bazel`, `bazelisk`, `Bazelisk`, `electron`,
  `Electron`, `BUILD` files, `.bzl` files, or `aspect_rules_*`
- [ ] All build commands in CLAUDE.md are correct and runnable
- [ ] Project structure section matches actual repo layout

---

## Testing Strategy

### Unit Tests (Mocha)
Three spec files, all testing core data structures:
- `client/layer.spec.ts` — sparse grid Layer operations
- `client/store/store.spec.ts` — Zustand store state and tool switching
- `client/store/drawing_stringifier.spec.ts` — drawing serialize/deserialize

### E2E Tests (Playwright)
`e2e/app.spec.js` — full app interaction tests against built + served app.

### Manual Testing Checklist
1. `pnpm dev` → draw a box, use text tool, undo/redo
2. `pnpm dev` → press 1-6 to switch tools (our keybinding change from earlier)
3. `pnpm build && pnpm preview` → verify prod build matches dev
4. Font renders as Source Code Pro (not fallback)
5. Dark mode toggle persists across reload
6. Share URL (`/share/...`) loads correctly

## Migration Notes

- Vite prod output goes to `dist/` with content-hashed filenames (e.g.
  `dist/assets/index-Abc123.js`). The old `bundle.js`/`bundle.css` naming is gone.
  If anything references those filenames externally, update accordingly.
- `dist/` is gitignored. Production deploy would serve `dist/` contents.
- The `site/` directory (previously an intermediary Bazel output) is deleted.
  It was never committed to the repo anyway.

## References

- `client/esbuild.config.mjs` — existing esbuild plugin (reference for the Vite alias)
- `MODULE.bazel` — font SHA256 checksums (use before deleting)
- `bazel/resolve-extensions-loader.mjs` — moved to `testing/` in Phase 3
- Related issue: #346 (PWA support — future work, Electron now removed)
