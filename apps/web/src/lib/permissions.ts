/** Returns true if `permissions` includes `key`. Trivial helper kept central so future wildcard logic (e.g., `hpp.*`) lives in one place. */
export function hasPermission(
  permissions: readonly string[] | undefined | null,
  key: string,
): boolean {
  if (!permissions) return false
  return permissions.includes(key)
}

/** Returns true if any of the keys are present. */
export function hasAnyPermission(
  permissions: readonly string[] | undefined | null,
  keys: readonly string[],
): boolean {
  if (!permissions) return false
  return keys.some((k) => permissions.includes(k))
}
