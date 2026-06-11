---
"@vintra/web": minor
---

Add the global outlet (branch) switcher to the mobile app — mirroring the web topbar pattern so a supervisor or owner with multiple outlets can pick which one to operate from their phone.

- New `<OutletProvider>` (mobile-side) wraps the tabs and persists the selection to `expo-secure-store` (`jq.selected_outlet_id`), with the same self-heal on stale ids as the web `BranchProvider`.
- The picker surfaces as a chip in the Home tab header (next to the role pill), backed by a bottom-sheet outlet list. Visibility is data-driven and matches the web exactly: hidden for single-outlet tenants, locked label for staff pinned to one of many, tappable dropdown when >1 are accessible.
- The selected outlet flows through the existing branch-aware queries: POS catalog + Peti Kas (Kasir tab), inventory list, and the home dashboard widgets (sales chart, POS overview, inventory overview). All include `branchId` in their query keys so switching outlets re-fetches.
- POS now surfaces a "POS belum aktif di outlet ini" empty state when the chosen outlet has POS disabled (e.g. inventory-only branch), instead of silently falling back to `branches[0]`.
- Inventory tab's local "Pilih Cabang" picker now writes to the global outlet state and drops the legacy "Semua cabang" aggregate option (matching the web — selection is always pinned to one outlet).
- Server: exposed the existing `listAccessibleBranches` server fn via the mobile gateway. `getPOSOverview` now forwards an optional `branchId` from the mobile call (web behavior was already in place).
