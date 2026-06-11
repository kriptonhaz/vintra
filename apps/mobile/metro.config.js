/**
 * Metro config for the Bun monorepo.
 *
 * Two things Metro doesn't know by default in a workspace setup:
 *
 *   1. **Watch the repo root**, not just `apps/mobile/`. Without this, edits
 *      to `packages/shared/` don't trigger a Metro rebuild.
 *
 *   2. **Resolve modules from the root `node_modules`** in addition to the
 *      app-local one. Workspace deps get hoisted to the root by Bun, so a
 *      lookup for `react` from inside `@vintra/shared` needs to fall
 *      back to the root.
 *
 * We also enable Tamagui's CSS extraction via `unstable_enablePackageExports`
 * so the Tamagui babel plugin can flatten styles at build time.
 */
const { getDefaultConfig } = require('expo/metro-config')
const path = require('node:path')

const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, '../..')

const config = getDefaultConfig(projectRoot)

// 1. Watch all files in the workspace
config.watchFolders = [workspaceRoot]

// 2. Resolve modules from both the app + workspace root
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
]

// 3. Force a single React copy across the monorepo to avoid
//    "Invalid hook call — duplicate React instances" runtime errors
//    when @vintra/shared (or any other workspace pkg) gets bundled.
config.resolver.disableHierarchicalLookup = true

// 4. Tamagui needs package exports for proper tree-shaking
config.resolver.unstable_enablePackageExports = true

module.exports = config
