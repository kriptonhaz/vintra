# Changesets

This folder is managed by `@changesets/cli` to track version bumps across the monorepo.

## How It Works

1. **Add a changeset** when you make a notable change (feature, fix, refactor)
2. **Changesets accumulate** on the `main` branch over time
3. **Version bump** consumes all pending changesets, updates `package.json` versions and generates `CHANGELOG.md`

## Commands

### Add a changeset

```bash
bunx changeset
```

Interactive prompt will ask:
- Which packages changed? (select with space, confirm with enter)
- Bump type? `patch` (bugfix), `minor` (feature), `major` (breaking change)
- Summary of the change

This creates a markdown file in `.changeset/`.

### Check pending changesets

```bash
bunx changeset status
```

### Bump versions (consume changesets)

```bash
bunx changeset version
```

This will:
- Read all pending `.changeset/*.md` files
- Update `package.json` versions for affected packages
- Append entries to each package's `CHANGELOG.md`
- Delete the consumed changeset files

After running, commit the version bumps:

```bash
git add .
git commit -m "chore: version packages"
```

### Publish (if needed)

```bash
bunx changeset publish
```

> **Note:** We don't publish to npm — this is only relevant if we ever do.

## Bump Type Guidelines

| Type | When to use | Example |
|---|---|---|
| `patch` | Bug fixes, tooling, refactors, deps | Fix HPP rounding error |
| `minor` | New features, enhancements | Add material CSV import |
| `major` | Breaking changes | Restructure DB schema |

## GitHub Actions

- **PR check**: Every PR is checked for a changeset. If missing, the CI will remind you.
- **Release workflow**: Merging to `main` triggers automatic version bumps via a "Version Packages" PR.
