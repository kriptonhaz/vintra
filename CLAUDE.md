# CLAUDE.md — Vintra

## Project Overview

**Vintra** is a modular SaaS platform for Indonesian businesses. It provides tools for managing business operations including HPP (Harga Pokok Penjualan/COGS) calculation, Point of Sales, inventory management, employee attendance, and financial reporting.

### Business Model

- **Free module**: HPP Calculator (lead magnet to attract users)
- **Paid modules**: POS, Inventory, Attendance, Financial Reports (subscription-based, per-module pricing)
- **Target users**: Indonesian business owners — scaling F&B, retail, and service businesses

### Domain & Branding

- Domain: `vintra.my.id`
- Language: Indonesian (Bahasa Indonesia) for user-facing content, English for code and comments
- Tagline ideas: "Kelola usahamu, naik kelas!" or "Semua kebutuhan usaha dalam satu platform"

---

## Tech Stack

### Core

| Technology | Purpose |
| --- | --- |
| **TanStack Start** (latest RC, Vite-based, NOT Vinxi) | Full-stack React framework |
| **React 19** | UI library |
| **TypeScript** | Type safety across the entire stack |
| **Vite** | Build tool and dev server |
| **Bun** | Package manager and runtime |
| **Tailwind CSS v4** | Styling (use `@tailwindcss/vite` plugin) |

### Database & Auth

| Technology | Purpose |
| --- | --- |
| **Supabase** | PostgreSQL database + Auth + Storage |
| **Drizzle ORM** | Type-safe database queries and migrations |
| **postgres** (npm package) | PostgreSQL client for Drizzle |

### Deployment

Two apps, **same Lightsail VPS** in Jakarta, deployed independently. See
[`deploy/README.md`](./deploy/README.md) for the full guide.

| Concern | Web (apps/web) | API (apps/api) |
| --- | --- | --- |
| Host | AWS Lightsail (ap-southeast-3 / Jakarta) | same VPS |
| Runtime | Node 22 (TanStack Start SSR) | Go static binary (Fiber + whatsmeow) |
| Supervisor | PM2 (`ecosystem.config.cjs`) | systemd (`deploy/api/vintra-api.service`) |
| URL | `https://vintra.my.id` | `https://api.vintra.my.id` |
| Port (behind nginx) | 3000 | 4099 |
| Deploy command | `./deploy.sh web` | `./deploy.sh api` |
| Build location | Local (Vite) → rsync `dist/` | Local cross-compile (`GOOS=linux GOARCH=amd64 CGO_ENABLED=0`) → rsync binary |
| Env on server | `~/prod/Vintra/.env` (Node `--env-file`) | `~/prod/vintra-api/.env` (systemd `EnvironmentFile=`) |
| TLS | Let's Encrypt via certbot, auto-renewing | same |
| Reverse proxy | nginx (`deploy/nginx/vintra.conf`) | nginx (`deploy/nginx/api.vintra.my.id.conf`) |
| Redis | not used | required (asynq, locks, rate-limit buckets, dedupe sets) |

### Validation & Utilities

| Technology | Purpose |
| --- | --- |
| **Zod** | Schema validation (forms, server functions, API input) |
| **@tanstack/react-query** | Comes with TanStack Start for data fetching/caching |
| **lucide-react** | Icons |
| **date-fns** | Date utilities |

---

## Monorepo Structure

This is a **Bun workspace monorepo**. All related packages live in a single repository.

```
vintra/
├── CLAUDE.md                          # This file
├── bun.lock
├── package.json                       # Root workspace config
├── turbo.json                         # Turborepo config (optional, for build orchestration)
│
├── apps/
│   ├── web/                           # TanStack Start web app (vintra.my.id)
│   │   ├── vite.config.ts             # Vite + tanstackStart() + tailwindcss()
│   │   ├── server-entry.mjs           # Node entry for PM2 in prod
│   │   ├── drizzle.config.ts
│   │   ├── .env.example               # Template for env vars
│   │   └── src/
│   │       ├── router.tsx             # TanStack Router config
│   │       ├── routeTree.gen.ts       # Auto-generated (DO NOT EDIT)
│   │       ├── routes/                # File-based routing
│   │       │   ├── __root.tsx
│   │       │   ├── index.tsx          # Landing page
│   │       │   ├── auth/              # login / register / forgot-password
│   │       │   └── _authed/           # Protected layout
│   │       │       ├── dashboard.tsx
│   │       │       ├── hpp/           # Free module: HPP calculator
│   │       │       ├── pos/           # Paid: POS
│   │       │       ├── inventory/     # Paid: Inventory
│   │       │       ├── attendance/    # Paid: Attendance
│   │       │       ├── finance/       # Paid: Financial reports
│   │       │       └── whatsapp/      # WhatsApp inbox (uses api.vintra.my.id)
│   │       ├── server/
│   │       │   ├── functions/         # TanStack server functions per module
│   │       │   └── middleware/        # auth.ts, module-access.ts
│   │       ├── components/            # ui/, layout/, forms/, modules/
│   │       ├── hooks/                 # use-auth, use-tenant, use-module-access
│   │       ├── lib/                   # currency.ts, s3-storage.ts, hpp-calculator.ts
│   │       ├── types/
│   │       └── styles/app.css         # Tailwind v4 imports
│   │
│   └── api/                           # Go WhatsApp service (api.vintra.my.id)
│       ├── cmd/api/main.go            # Binary entry — Fiber + asynq + whatsmeow
│       ├── internal/
│       │   ├── whatsapp/              # whatsmeow provider + Registry + Store
│       │   ├── http/                  # Fiber routes + handlers + middleware
│       │   ├── queue/tasks/           # asynq workers (wa:send, ai:reply, etc)
│       │   ├── ai/                    # OpenAI/Gemini/DeepSeek provider adapters
│       │   ├── rag/                   # RAG retrieval (prices, stock, hours)
│       │   ├── handoff/               # AI→human handoff detection (JUR-74)
│       │   ├── storage/               # S3 wrapper (inbound media, outbound)
│       │   ├── ratelimit/             # Per-instance + per-JID token buckets
│       │   ├── db/queries/            # sqlc-generated query code
│       │   └── config/                # env-driven config (caarlos0/env)
│       ├── .env.example
│       └── data/                      # SQLite session DBs (gitignored)
│
├── packages/
│   ├── ui/                            # Shared UI component library (future)
│   │   ├── package.json
│   │   └── src/
│   │
│   ├── shared/                        # Shared utilities and types
│   │   ├── package.json
│   │   └── src/
│   │       ├── types/
│   │       ├── validators/            # Zod schemas shared across packages
│   │       └── constants/
│   │
│   └── db/                            # Database package (schema + client)
│       ├── package.json
│       ├── drizzle.config.ts
│       └── src/
│           ├── index.ts
│           ├── client.ts
│           ├── schema/
│           └── migrations/
│
├── tooling/                           # Shared configs
│   ├── typescript/
│   │   └── tsconfig.base.json
│   ├── tailwind/
│   │   └── tailwind.config.ts         # Shared Tailwind config (if needed)
│   └── eslint/
│       └── eslint.config.js
│
├── deploy.sh                          # ./deploy.sh [web|api] — see deploy/README.md
└── deploy/                            # Ops artifacts (version-controlled)
    ├── README.md                      # Umbrella deploy guide (web + api)
    ├── nginx/
    │   ├── vintra.conf             # nginx vhost for vintra.my.id (web)
    │   └── api.vintra.my.id.conf     # nginx vhost for api.vintra.my.id
    └── api/
        ├── README.md                  # API first-time VPS setup checklist
        └── vintra-api.service      # systemd unit for the Go binary
```

---

## Critical Configuration Details

### TanStack Start Vite Config

TanStack Start has migrated from Vinxi to Vite since v1.121.0. **ALWAYS use the Vite-based setup, NEVER use Vinxi or `app.config.ts`.**

```typescript
// apps/web/vite.config.ts
import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import viteTsConfigPaths from 'vite-tsconfig-paths'

// Standalone Node server build, deployed to Lightsail via PM2 + nginx.
// Build output:
//   - dist/server/server.js → Web-Fetch handler (wrapped by server-entry.mjs)
//   - dist/client/          → static assets served by nginx
export default defineConfig({
  plugins: [
    viteTsConfigPaths({ projects: ['./tsconfig.json'] }),
    tailwindcss(),
    tanstackStart(),  // Must come before viteReact()
    viteReact(),
  ],
})
```

The web app builds to a standalone Node bundle (no Netlify / Vercel
adapter). `apps/web/server-entry.mjs` wraps the Fetch handler from
`dist/server/server.js` via `@hono/node-server`, listens on `:3000`,
and PM2 keeps it alive in prod.

### Drizzle Config

```typescript
// packages/db/drizzle.config.ts
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/schema/index.ts',
  out: './src/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  schemaFilter: ['public'],
})
```

### Drizzle + Supabase Client

```typescript
// packages/db/src/client.ts
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

// Use connection pooling URL from Supabase
// Use { prepare: false } for Supabase Transaction pool mode
const client = postgres(process.env.DATABASE_URL!, { prepare: false })

export const db = drizzle({ client, schema })
```

### TypeScript Config

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "moduleResolution": "Bundler",
    "module": "ESNext",
    "target": "ES2022",
    "skipLibCheck": true,
    "strictNullChecks": true,
    "strict": true,
    "paths": {
      "~/*": ["./src/*"],
      "@vintra/db": ["../../packages/db/src"],
      "@vintra/db/*": ["../../packages/db/src/*"],
      "@vintra/shared": ["../../packages/shared/src"],
      "@vintra/shared/*": ["../../packages/shared/src/*"]
    }
  }
}
```

### Tailwind CSS v4

```css
/* apps/web/src/styles/app.css */
@import "tailwindcss";
```

### Root package.json (Bun Workspace)

```json
{
  "name": "vintra",
  "private": true,
  "workspaces": [
    "apps/*",
    "packages/*",
    "tooling/*"
  ],
  "scripts": {
    "dev": "bun run --filter apps/web dev",
    "build": "bun run --filter apps/web build",
    "db:generate": "bun run --filter @vintra/db generate",
    "db:migrate": "bun run --filter @vintra/db migrate",
    "db:migrate:baseline": "bun run --filter @vintra/db migrate:baseline",
    "db:studio": "bun run --filter @vintra/db studio"
  }
}
```

---

## Environment Variables

```bash
# apps/web/.env.example

# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Database (Supabase connection pooler URL - Transaction mode)
DATABASE_URL=postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres

# App
VITE_APP_URL=http://localhost:3000
VITE_APP_NAME=Vintra
```

**IMPORTANT:** Never expose `SUPABASE_SERVICE_ROLE_KEY` or `DATABASE_URL` to the client. Only use them in server functions.

---

## Multi-Tenancy Architecture

Every data table MUST include a `tenant_id` column. This is the foundation for isolating data between businesses.

```typescript
// packages/db/src/schema/auth.ts
import { pgTable, uuid, text, timestamp, boolean } from 'drizzle-orm/pg-core'

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),                          // Business name
  slug: text('slug').notNull().unique(),                  // URL-friendly identifier
  ownerId: uuid('owner_id').notNull(),                    // Supabase auth user ID
  plan: text('plan').notNull().default('free'),           // free | starter | pro | enterprise
  activeModules: text('active_modules').array().notNull().default(['hpp']),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const tenantMembers = pgTable('tenant_members', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id).notNull(),
  userId: uuid('user_id').notNull(),                      // Supabase auth user ID
  role: text('role').notNull().default('member'),          // owner | admin | cashier | employee
  createdAt: timestamp('created_at').defaultNow().notNull(),
})
```

### Module Access Control

```typescript
// src/lib/constants.ts
export const MODULES = {
  hpp: { name: 'HPP Calculator', free: true, price: 0 },
  pos: { name: 'Point of Sales', free: false, price: 79000 },
  inventory: { name: 'Inventaris', free: false, price: 49000 },
  attendance: { name: 'Absensi Karyawan', free: false, price: 29000 },
  finance: { name: 'Laporan Keuangan', free: false, price: 59000 },
} as const

export type ModuleKey = keyof typeof MODULES
```

---

## Phase 1: HPP Module (Build This First)

The HPP (Harga Pokok Penjualan / Cost of Goods Sold) calculator is the free module that serves as the primary user acquisition tool.

### HPP Database Schema

```typescript
// packages/db/src/schema/hpp.ts
import { pgTable, uuid, text, numeric, integer, timestamp, jsonb } from 'drizzle-orm/pg-core'
import { tenants } from './auth'

// Raw materials / bahan baku
export const materials = pgTable('materials', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id).notNull(),
  name: text('name').notNull(),                           // e.g., "Kopi Robusta"
  unit: text('unit').notNull(),                           // e.g., "gram", "ml", "pcs"
  pricePerUnit: numeric('price_per_unit', { precision: 15, scale: 2 }).notNull(),
  supplier: text('supplier'),                             // Optional supplier name
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// Products / produk yang dijual
export const products = pgTable('products', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id).notNull(),
  name: text('name').notNull(),                           // e.g., "Kopi Susu Gula Aren"
  sku: text('sku'),                                       // Optional SKU
  category: text('category'),                             // e.g., "Minuman", "Makanan"
  sellingPrice: numeric('selling_price', { precision: 15, scale: 2 }).notNull(),
  hpp: numeric('hpp', { precision: 15, scale: 2 }),       // Calculated HPP
  margin: numeric('margin', { precision: 5, scale: 2 }),  // Calculated margin percentage
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// BOM (Bill of Materials) / Resep - links materials to products
export const productMaterials = pgTable('product_materials', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id).notNull(),
  productId: uuid('product_id').references(() => products.id, { onDelete: 'cascade' }).notNull(),
  materialId: uuid('material_id').references(() => materials.id).notNull(),
  quantity: numeric('quantity', { precision: 15, scale: 4 }).notNull(),  // Amount used
  unit: text('unit').notNull(),                           // Unit for this usage
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// Overhead costs / Biaya overhead
export const overheadCosts = pgTable('overhead_costs', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id).notNull(),
  name: text('name').notNull(),                           // e.g., "Sewa tempat", "Listrik", "Gas"
  amount: numeric('amount', { precision: 15, scale: 2 }).notNull(),
  period: text('period').notNull().default('monthly'),    // monthly | weekly | daily
  allocationType: text('allocation_type').notNull().default('per_product'), // per_product | percentage
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})
```

### HPP Calculation Logic

```
HPP per product = Total Bahan Baku + (Overhead / Jumlah Produk per Periode)

Margin (%) = ((Harga Jual - HPP) / Harga Jual) * 100
Markup (%) = ((Harga Jual - HPP) / HPP) * 100
```

### HPP Features to Build

1. **Material Management (Kelola Bahan Baku)**
   - CRUD for raw materials with price per unit
   - Support various units (gram, kg, ml, liter, pcs, etc.)
   - Import from CSV/Excel (nice to have)

2. **Product Management (Kelola Produk)**
   - CRUD for products with selling price
   - Categories for organizing products

3. **Recipe/BOM Builder (Resep/Komposisi)**
   - Link materials to products with quantities
   - Visual recipe builder (drag & drop nice to have)
   - Auto-calculate HPP when materials or quantities change

4. **Overhead Management (Biaya Overhead)**
   - Monthly overhead costs (rent, electricity, gas, etc.)
   - Allocation method: evenly distributed or by percentage

5. **HPP Report (Laporan HPP)**
   - Per-product HPP breakdown
   - Margin analysis
   - Suggested selling price calculator
   - Export to PDF/Excel

6. **Dashboard**
   - Overview of all products with HPP vs selling price
   - Visual margin indicators (good/warning/danger)
   - Quick stats: average margin, lowest margin products

---

## Server Functions Pattern

Use TanStack Start's `createServerFn` for all data operations. These run on the server only and are type-safe.

```typescript
// src/server/functions/hpp.ts
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { db } from '@vintra/db'
import { materials } from '@vintra/db/schema'
import { eq, and } from 'drizzle-orm'
import { requireAuth } from '../middleware/auth'

// Schema validation
const createMaterialSchema = z.object({
  name: z.string().min(1, 'Nama bahan wajib diisi'),
  unit: z.string().min(1, 'Satuan wajib diisi'),
  pricePerUnit: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Harga tidak valid'),
  supplier: z.string().optional(),
  notes: z.string().optional(),
})

export const getMaterials = createServerFn()
  .handler(async () => {
    const { tenantId } = await requireAuth()
    return db.select().from(materials).where(eq(materials.tenantId, tenantId))
  })

export const createMaterial = createServerFn({ method: 'POST' })
  .validator(createMaterialSchema)
  .handler(async ({ data }) => {
    const { tenantId } = await requireAuth()
    const [material] = await db.insert(materials).values({
      ...data,
      tenantId,
    }).returning()
    return material
  })
```

---

## Auth Pattern

Use Supabase Auth via their JavaScript client. Integrate with TanStack Start middleware.

```typescript
// src/server/middleware/auth.ts
import { createServerFn } from '@tanstack/react-start'
import { createClient } from '@supabase/supabase-js'
import { getWebRequest } from '@tanstack/react-start/server'

function getSupabaseServer() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function requireAuth() {
  const request = getWebRequest()
  const authHeader = request.headers.get('authorization')
  // OR extract from cookie depending on auth flow

  if (!authHeader) {
    throw new Error('Unauthorized')
  }

  const supabase = getSupabaseServer()
  const { data: { user }, error } = await supabase.auth.getUser(
    authHeader.replace('Bearer ', '')
  )

  if (error || !user) {
    throw new Error('Unauthorized')
  }

  // Get tenant for this user
  // ... fetch tenant from DB

  return { userId: user.id, tenantId: '...' }
}
```

---

## UI/UX Guidelines

### Design System

- **Primary color**: Blue (#2563EB) — trustworthy, professional
- **Accent color**: Amber/Gold (#F59E0B) — represents prosperity, suitable for business app
- **Font**: Inter (via Google Fonts) or system font stack
- **Style**: Clean, minimal, professional. NOT overly playful. Business owners want to feel like they're using a serious business tool.
- **Mobile-first**: Many owners access from their phone. Every page must be responsive.

### Component Patterns

- Use **shadcn/ui-style** components built with Tailwind CSS
- All forms should show inline validation errors in Indonesian
- Use Indonesian Rupiah formatting: `Rp 25.000` (use dot as thousands separator)
- Date format: `DD/MM/YYYY` (Indonesian standard)
- Tables should be sortable, searchable, and paginated
- Use skeleton loading states, not spinners

### Sheet Forms (Slide-in Panels)

Forms inside `Sheet` components must use a **sticky footer** pattern. The form element itself becomes the flex container that fills the remaining sheet height, with a scrollable body and a fixed bottom footer for action buttons.

```tsx
// Form component — handles its own scroll area and sticky footer
<form className="flex min-h-0 flex-1 flex-col">
  <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
    {/* form fields */}
  </div>
  <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4">
    <Button type="button" variant="ghost" onClick={onCancel}>Batal</Button>
    <Button type="submit" variant="brand">Simpan</Button>
  </div>
</form>

// Page usage — place form directly inside Sheet, NOT inside SheetContent
<Sheet open={...} onClose={...}>
  <SheetHeader onClose={...}>
    <SheetTitle>...</SheetTitle>
    <SheetDescription>...</SheetDescription>
  </SheetHeader>
  <MyForm ... />        {/* NOT wrapped in <SheetContent> */}
</Sheet>
```

Key rules:
- Form uses `flex min-h-0 flex-1 flex-col` to fill remaining sheet height
- Scrollable area uses `flex-1 overflow-y-auto px-6 py-5`
- Footer uses `border-t border-gray-200 px-6 py-4` — sticks to bottom
- Do NOT wrap forms in `<SheetContent>` — the form handles its own padding and scroll
- `SheetContent` is only for non-form sheet content (e.g., read-only info panels)

### Indonesian Rupiah Formatting

```typescript
// src/lib/currency.ts
export function formatRupiah(amount: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

// Usage: formatRupiah(25000) → "Rp 25.000"
```

---

## Coding Conventions

### General Rules

- **Language**: All code, comments, variable names, and git commits in English
- **UI text**: All user-facing text in Bahasa Indonesia
- **File naming**: kebab-case for files, PascalCase for components
- **No `any` types**: Use proper TypeScript types everywhere
- **Zod for all validation**: Both client-side forms and server function inputs
- **Error handling**: Always handle errors gracefully with user-friendly Indonesian messages

### Forms

- Always use **React Hook Form** (`useForm`) with **Zod** validation via `@hookform/resolvers/zod`
- Define Zod schemas in `apps/web/src/lib/schemas/` (or `packages/shared/src/validators/` if shared)
- Use `register()` for native HTML inputs and `Input`, `Select`, `Textarea` components (they use `forwardRef`)
- Use `Controller` for custom components with non-standard value/onChange (e.g., `CurrencyInput`)
- Use `useFieldArray` for dynamic/repeating form fields
- Multi-step forms: single `useForm` + per-step `trigger()` validation
- Error messages in Bahasa Indonesia

### Server Functions

- Always use `createServerFn` from `@tanstack/react-start`
- Always validate input with `.validator()` using Zod schemas
- Always check auth and tenant access before any DB operation
- Always filter by `tenantId` — NEVER return data without tenant scoping
- Use `{ method: 'POST' }` for mutations, default GET for queries

### Database

- Always include `tenantId` on every data table
- Use `uuid` for all IDs with `.defaultRandom()`
- Always include `createdAt` and `updatedAt` timestamps
- Use `numeric` type for money/price fields, NEVER use `float`
- Use Drizzle's type-safe query builder, avoid raw SQL

### Routes

- Use TanStack Router file-based routing
- Protected routes go under `_authed/` layout
- Module routes go under `_authed/{module}/`
- Use route loaders for data fetching (SSR)

### Master Data

Global reference tables (no `tenant_id`) live in `packages/db/src/schema/master-data.ts`. Examples: `master_hpp_categories`, `master_hpp_units`.

- Schema convention: `masterXxx` table name, always include `value`, `label`, `sortOrder`, `isActive`, `createdAt`
- Server functions in `apps/web/src/server/functions/master-data.ts` — no auth required (global data)
- Select only `value` and `label` columns, filter by `isActive = true`, order by `sortOrder`
- Seed script: `packages/db/src/seed.ts` — run via `bun run seed` in the `packages/db` directory

### React Query

`QueryClientProvider` is set up in `apps/web/src/routes/__root.tsx` with a default `staleTime` of 5 minutes.

- Custom hooks live in `apps/web/src/hooks/`
- Query key convention: `['master', 'entity-name']` for master data, `['tenant', 'entity-name']` for tenant-scoped data
- Master data hooks use `staleTime: 10 * 60 * 1000` (10 min) since data rarely changes
- Always provide a fallback default (e.g., `const { data: items = [] } = useQuery(...)`)

### Git Commits

Use conventional commits:
- `feat: add material CRUD for HPP module`
- `fix: correct HPP calculation rounding`
- `chore: update dependencies`
- `style: improve mobile responsive layout`
- `refactor: extract shared form components`

### Changesets (Required for PRs)

Every PR **must** include a changeset file. The CI check "Changeset Check" will fail without one.

```bash
# Create a changeset file manually in .changeset/ directory:
```

```markdown
<!-- .changeset/short-description.md -->
---
"@vintra/web": minor
"@vintra/db": patch
"@vintra/shared": patch
---

Brief description of the change.
```

**Bump types:**
- `patch` — bug fixes, refactors, tooling
- `minor` — new features, enhancements
- `major` — breaking changes

**Rules:**
- Always include the packages that were modified
- All three packages (`@vintra/web`, `@vintra/db`, `@vintra/shared`) are version-locked together
- The changeset file name should be kebab-case describing the change (e.g., `add-tenant-categories.md`)
- When creating a PR, always add a changeset file alongside the code changes

---

## Important Gotchas & Rules

1. **DO NOT use Vinxi or `app.config.ts`** — TanStack Start uses `vite.config.ts` since v1.121.0
2. **DO NOT use `@tanstack/start`** — Use `@tanstack/react-start` (the new package name)
3. **DO NOT use `@tanstack/start-vite-plugin`** — Use `@tanstack/react-start/plugin/vite`
4. **DO NOT expose database credentials to client** — Only use in server functions
5. **DO NOT skip tenantId filtering** — Every DB query must be scoped to the tenant
6. **DO NOT use `float` for money** — Use `numeric` with precision
7. **DO NOT forget `{ prepare: false }`** in postgres client for Supabase pooling
8. **`tanstackStart()` plugin MUST come before `viteReact()`** in vite.config.ts
9. **DO NOT edit `routeTree.gen.ts`** — It's auto-generated by TanStack Router
10. **DO NOT use `verbatimModuleSyntax`** in tsconfig — It can leak server code to client bundles
11. **Bun is the package manager** — Use `bun add`, `bun install`, `bun run`, NOT npm/yarn/pnpm
12. **DO NOT use `drizzle-kit push`** — Crashes on Supabase (CHECK constraint bug). Use `bun run db:generate` + `bun run db:migrate` instead

---

## Development Workflow

```bash
# Install dependencies
bun install

# Start development server
bun run dev

# Generate Drizzle migrations after schema changes
bun run db:generate

# Apply pending migrations to database
bun run db:migrate

# Open Drizzle Studio (database browser)
bun run db:studio

# Build for production
bun run build
```

### Database Migration Workflow

**DO NOT use `drizzle-kit push`** — it crashes on Supabase databases due to a known
drizzle-kit bug parsing CHECK constraints from Supabase system schemas. Use the
generate-then-migrate workflow instead:

1. Edit schema files in `packages/db/src/schema/`
2. Run `bun run db:generate` to create a new SQL migration file
3. Run `bun run db:migrate` to apply pending migrations

The `db:migrate` command uses a custom migrator script (`packages/db/src/migrate.ts`)
that runs via `drizzle-orm`'s programmatic migration API, bypassing the broken
`drizzle-kit` introspection.

**First-time setup for new environments:** If the database already has tables created
via `drizzle-kit push` but no migration tracking, run `bun run db:migrate:baseline`
once to mark existing migrations as applied before running `bun run db:migrate`.

### Deploy Workflow

Two apps, deployed independently to the **same Lightsail VPS** in Jakarta.
From your local machine, at the repo root:

```bash
# Web (TanStack Start) — build, rsync, pm2 reload
./deploy.sh web
./deploy.sh                  # legacy default = web

# API (Go binary) — cross-compile, rsync, systemctl restart, probe /healthz
./deploy.sh api
```

Web takes ~30s, api takes ~10s. Each is independent — deploying one
doesn't touch the other. The api deploy fails fast if `/healthz` doesn't
return 200 after restart.

**When secrets change:**

- Web: edit `~/prod/Vintra/.env` on the server → `pm2 restart vintra-web --update-env`
- API: edit `~/prod/vintra-api/.env` on the server → `sudo systemctl restart vintra-api`

**Smoke tests:**

```bash
curl -sS https://vintra.my.id | head -3
curl -sS https://api.vintra.my.id/healthz   # → {"ok":true,"version":"<git-sha>",...}
curl -sS https://api.vintra.my.id/readyz    # → reports postgres + redis + activeInstances
```

**Reference:** [`deploy/README.md`](./deploy/README.md) (umbrella),
[`deploy/api/README.md`](./deploy/api/README.md) (api first-time VPS setup).

### Don't deploy without explicit instruction

Per the user's recorded preference: never run `./deploy.sh` (either
target) on your own. Wait for the explicit "deploy this" command — same
goes for `pm2 restart`, `systemctl restart`, and any SSH command that
modifies prod state.

---

## Phase Roadmap

### Phase 1 — Foundation + HPP Module (Current Priority)
- [x] Project setup (monorepo, TanStack Start, Supabase, Drizzle)
- [ ] Auth (login, register, tenant creation)
- [ ] Dashboard layout (sidebar, header, responsive)
- [ ] HPP: Material management
- [ ] HPP: Product management
- [ ] HPP: Recipe/BOM builder
- [ ] HPP: Overhead costs
- [ ] HPP: Calculation & reports
- [ ] Landing page for vintra.my.id
- [x] Deploy to AWS Lightsail VPS (web + api on the same Jakarta box)

### Phase 2 — POS Module (First Paid Module)
- [ ] Product catalog (reuse from HPP)
- [ ] Transaction/sale recording
- [ ] Payment methods
- [ ] Receipt printing/sharing (WhatsApp)
- [ ] Daily sales report
- [ ] Integration with HPP for margin tracking

### Phase 3 — Inventory Module
- [ ] Stock tracking
- [ ] Stock in/out recording
- [ ] Low stock alerts
- [ ] Purchase orders

### Phase 4 — Attendance & Finance
- [ ] Employee management
- [ ] Clock in/out
- [ ] Financial reports (profit/loss, cash flow)
- [ ] Revenue dashboard

### Phase 5 — Growth
- [ ] WhatsApp integration for notifications
- [ ] Multi-store/branch support
- [ ] Subscription & payment integration (Midtrans/Xendit)
- [ ] Mobile app (React Native or PWA)
