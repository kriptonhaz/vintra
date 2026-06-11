# Vintra Mobile

React Native app via Expo SDK 52 + Expo Dev Client. Lives inside the Bun workspace alongside `apps/web`.

**Build philosophy: local-only, no EAS subscription.** Dev Client builds run on your Mac via Xcode (iOS) or Android Studio (Android). Distribution to testers happens via TestFlight + Play Store directly. EAS Build + EAS Update are explicitly not used — fewer moving parts, no monthly bill, no cloud build queues.

## What's in Phase 0 + Phase 1 (current state)

- Expo Router file-based routing (`src/app/`)
- Tamagui UI library with v3 preset config
- TanStack Query + Supabase + Auth/Tenant providers wired
- Path aliases (`~/*` + `@vintra/shared`) matching the web app
- Metro config tuned for the Bun monorepo (watches workspace root, dedups React)
- Auth flow: login + forgot-password + tenant picker + bottom tab shell
- Talks to existing Vintra server functions at `https://vintra.my.id/_server/...` via Bearer + `X-Tenant-Id` headers

Phase 2 (attendance, camera + GPS) + Phase 3 (POS Lite) layer on top — see issues #211 + #212.

## Prerequisites

- **macOS** with Xcode (Apple Silicon or Intel) — for iOS builds
- **Android Studio** with at least one virtual device or a connected phone via USB debugging — for Android builds
- **Bun** at the repo root (already required for `apps/web`)

Xcode and Android Studio are both free.

## First-time setup

```bash
# From repo root — installs all workspace deps (already done if you've run bun install before)
bun install

# Generate the native iOS + Android folders (ios/ and android/)
# Run once per machine, and again any time you change app.json or add a config plugin.
cd apps/mobile
bunx expo prebuild --clean
```

`prebuild` regenerates `ios/` and `android/` from `app.json` + the installed Expo plugins. Both directories are git-ignored (regenerated on demand).

## Daily development

```bash
# From apps/mobile/

# Option 1: iOS simulator (fastest iteration on macOS)
bun run ios

# Option 2: Android emulator or connected device
bun run android

# Option 3: Boot Metro alone (when the Dev Client is already installed)
bun run start
```

What these do:

- `bun run ios` — compiles the Dev Client via Xcode, installs it on the simulator (or connected device if booted), launches Metro. ~2-5 min the first time, faster after.
- `bun run android` — same but via Gradle to an Android emulator or connected device.
- `bun run start` — just Metro. Use this when the Dev Client is already installed and you want to hot-reload JS without rebuilding native.

After the first build, JS changes hot-reload in seconds. You only need a full rebuild when:

- You change `app.json` or install a config plugin
- You add a new native module (anything `expo install` brings in that wasn't there before)
- You change anything under `ios/` or `android/` (rare)

## Talking to the Vintra API

Server functions are at `https://vintra.my.id/_server/<fn>`. Auth is via Bearer token in the `Authorization` header (existing `requireAuth` middleware in `apps/web/src/server/middleware/auth.ts` accepts both Bearer + cookie). Multi-tenant scoping rides on the `X-Tenant-Id` header (added during Phase 1).

Pointing at staging (default):

```bash
# No env needed — falls back to https://vintra.my.id
bun run ios
```

Pointing at a local web app on your Mac:

```bash
# In apps/mobile/.env
EXPO_PUBLIC_API_URL=http://192.168.x.x:3000
```

(Use your Mac's LAN IP, not `localhost` — the simulator/emulator needs a routable address.)

## Distributing builds to testers

No EAS. Two paths:

### iOS — TestFlight

```bash
cd apps/mobile
bun run prebuild       # if you haven't already
cd ios
xcodebuild -workspace Vintra.xcworkspace \
  -scheme Vintra \
  -configuration Release \
  -archivePath build/Vintra.xcarchive archive
xcodebuild -exportArchive \
  -archivePath build/Vintra.xcarchive \
  -exportPath build \
  -exportOptionsPlist exportOptions.plist
```

Then upload the resulting `.ipa` to App Store Connect via Transporter (free Apple app) → assign to internal testers via TestFlight.

Alternative: open `ios/Vintra.xcworkspace` in Xcode, hit `Product → Archive`, then "Distribute App" → "App Store Connect". Fully manual, no command line.

### Android — Play Store internal testing

```bash
cd apps/mobile/android
./gradlew :app:bundleRelease
# Produces app/build/outputs/bundle/release/app-release.aab
```

Upload the `.aab` to Play Console → Internal testing track → invite testers by email.

Or skip the Play Store entirely and hand around the APK directly:

```bash
cd apps/mobile/android
./gradlew :app:assembleRelease
# Produces app/build/outputs/apk/release/app-release.apk
```

Share the `.apk` via Drive / WhatsApp — testers install by enabling "Unknown sources" on their phone. Fastest path for early Indonesian beta testers who don't want to set up Play accounts.

## OTA updates (when you want them later)

Without EAS Update, your options are CodePush (Microsoft, free) or just shipping new binaries each time. For Phase 5 (polish + beta) we'll pick. For Phase 0-4 dev work, every change goes through a fresh local build, which is fast enough.

## Useful commands

| Task | Command |
|---|---|
| Run on iOS simulator | `bun run ios` |
| Run on Android emulator/device | `bun run android` |
| Start Metro (Dev Client already installed) | `bun run start` |
| Typecheck | `bun run typecheck` |
| Regenerate native dirs | `bun run prebuild` |
| Lint | `bun run lint` |

## Files / paths cheat sheet

| Path | What it is |
|---|---|
| `src/app/_layout.tsx` | Root provider tree — Tamagui + Query + Auth + Tenant, plus route guard |
| `src/app/auth/` | Login, forgot-password, register stub |
| `src/app/(tabs)/` | Bottom tab screens: Beranda / Absensi / POS / Lainnya |
| `src/app/tenant-picker.tsx` | Multi-tenant picker screen |
| `src/lib/supabase.ts` | Supabase client with expo-secure-store adapter |
| `src/lib/api.ts` | `callServerFn(name, body, { tenantId })` wrapper |
| `src/lib/auth-context.tsx` | AuthProvider — session + signIn/signOut/resetPassword |
| `src/lib/tenant-context.tsx` | TenantProvider — active tenant + state machine |
| `tamagui.config.ts` | Design tokens (currently v3 preset; brand colors land in Phase 2) |
| `metro.config.js` | Monorepo-aware bundler config |
| `app.json` | Expo runtime config (icons, splash, perms, plugins) |
| `babel.config.js` | Babel + Tamagui compiler plugin |
| `assets/` | Static images bundled into the app (icon, splash) |
| `ios/` / `android/` | Native code, generated by `expo prebuild` — git-ignored |

## Troubleshooting

**`Unable to resolve module '@vintra/shared'`**
→ Run `bun install` from the repo root, not from `apps/mobile/`. Workspace deps must be hoisted to the root.

**"Multiple versions of React" hook error**
→ Already mitigated by `disableHierarchicalLookup` in `metro.config.js` + the root-level React declaration in the workspace `package.json`. If it recurs, check that `react` lives in exactly one place: `find . -path "*/node_modules/react/package.json" -not -path "*/node_modules/*/node_modules/*"` should return one line.

**Tamagui babel plugin errors during dev**
→ Production builds run the extractor; dev disables it (`disableExtraction: true`). If you hit it in dev anyway, the plugin's `config` path is wrong — must be relative to the project root.

**Xcode build fails on first `bun run ios`**
→ Run `cd ios && pod install` once after `expo prebuild`. The `bun run ios` script does this automatically on subsequent runs but the first time can be racy.

**iPhone simulator runs but the app shows a white screen**
→ Metro might not be connected. Check the terminal where Metro is running — if it's not showing "Dev server ready", restart with `bun run start` in a separate terminal first, then `bun run ios`.

**Android Gradle build is slow**
→ First-time builds download the entire Android SDK + a bunch of Gradle deps (~1GB). Subsequent builds reuse the cache. Add `org.gradle.parallel=true` to `~/.gradle/gradle.properties` if your machine has the cores for it.
