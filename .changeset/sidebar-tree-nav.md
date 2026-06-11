---
"@vintra/web": minor
"@vintra/db": patch
"@vintra/shared": patch
---

Sidebar: every module nests its sub-pages directly under it.

Until now each module had its own tab strip — `POSSubnav`, `AttendanceSubnav`, `InventorySubnav`, the inline `HppNav` — that the user had to click into the module first to even see. The owner couldn't jump straight from the home dashboard to "Absensi → Setting" or "POS Kasir → Promo"; they had to land on the module home, find the right tab, then click again.

Replace that pattern with an expandable sidebar tree. Modules with sub-pages get a chevron and auto-expand whenever the URL is anywhere under them; siblings stay collapsed so the sidebar doesn't sprawl. Click the parent and the row both navigates to the module home AND opens its children.

Single source of truth: `MODULE_NAV` carries `children: ChildNavItem[]` per module, with the same permission / feature / role gates the old subnavs ran. Pages keep a slim `<ModuleBreadcrumb />` at the top showing "Module → Page" — derived from the URL, no per-page wiring. Old subnav components deleted.
