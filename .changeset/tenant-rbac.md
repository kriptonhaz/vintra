---
"@vintra/web": minor
"@vintra/db": minor
---

Tenant-owner RBAC. Owners (anyone with `settings.manage`) can now curate their own pool of custom roles from a new **Peran & Akses** page under Settings, in addition to the 6 built-in system roles (owner / admin / outlet_owner / supervisor / staff / cashier).

The editor groups every permission by module (HPP, POS, Inventaris, Absensi, Keuangan, WhatsApp, Booking, Pengaturan, Anggota) with "Pilih Semua / Hapus Semua" toggles per block, and ships five starter templates — **Kosong**, **Kasir** (POS read+transact only, no void), **Pegawai Absensi**, **Manajer Stok**, **Supervisor Outlet** — so an owner can spin up the common merchants roles in two clicks. Roles still in use can't be deleted; they have to be reassigned first.

Schema-wise this adds a nullable `roles.tenant_id` with two partial unique indexes — `(key) WHERE tenant_id IS NULL` for system rows, `(tenant_id, key) WHERE tenant_id IS NOT NULL` per tenant — so each tenant owns its own key namespace without colliding with the system rows. The member-form role dropdown automatically surfaces the new custom roles alongside the system ones; outlet owners pick from the pool but can't curate it.
