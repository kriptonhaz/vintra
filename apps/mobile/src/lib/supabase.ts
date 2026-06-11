/**
 * Supabase client for React Native.
 *
 *   - Session is persisted via expo-secure-store (NOT AsyncStorage —
 *     refresh tokens are sensitive enough to deserve Keychain / EncryptedSharedPrefs).
 *   - autoRefreshToken stays on so background timers refresh the access
 *     token before it expires; we don't need to call refreshSession()
 *     manually.
 *   - detectSessionInUrl is disabled — no OAuth deep links yet.
 */
import 'react-native-url-polyfill/auto'
import { createClient } from '@supabase/supabase-js'
import * as SecureStore from 'expo-secure-store'
import Constants from 'expo-constants'

// expo-secure-store has a 2KB per-value cap on iOS, so the Supabase
// session (~1.5KB after JSON encoding) sneaks in. If we ever bump up
// against the limit we'll have to split the access + refresh tokens
// across two keys.
const SecureStorageAdapter = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
}

const extras = (Constants.expoConfig?.extra ?? {}) as Record<string, string>

// `EXPO_PUBLIC_*` env vars get inlined into the bundle at build time
// (no .env reads at runtime). Falling back to a hard-coded URL means a
// fresh Dev Client just works without anyone needing to set .env first.
const supabaseUrl =
  process.env.EXPO_PUBLIC_SUPABASE_URL ?? extras.SUPABASE_URL ?? ''
const supabaseAnonKey =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  extras.SUPABASE_PUBLISHABLE_KEY ??
  ''

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    '[supabase] Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY — auth will fail until set.',
  )
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: SecureStorageAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
})
