---
"@vintra/web": minor
"@vintra/db": minor
---

Cashflow v2 — Akun Kas & Bank: multi-account + transfers (JUR-192).

Komplit tenants can now split their money across accounts — cash drawer, bank, e-wallet — and move funds between them.

- New `cashflow_accounts` and `cashflow_transfers` tables, migration `0080`; every `cashflow_entries` row now carries an `account_id`. Existing tenants get an auto-seeded default "Kas Utama" account and all existing entries back-fill to it, so single-account tenants are unaffected.
- New `/cashflow/akun` page: account cards with live balances, account CRUD, and a "Pindah Dana" transfer between accounts.
- A transfer is recorded in its own table — never as income/expense — so the P/L and dashboard KPIs are identical before and after a transfer.
- The entry sheet gains an account picker (shown only for multi-account tenants); the ledger gains an account filter + per-row account label; the dashboard gains a "Saldo per akun" panel.
- POS auto-import and AR/AP payments attribute to the tenant's default account (per-payment-method mapping is a follow-up).
