# Vintra

Platform SaaS modular untuk bisnis modern Indonesia.

Vintra provides tools for managing business operations including HPP (Harga Pokok Penjualan / COGS) calculation, Point of Sales, inventory management, employee attendance, and financial reporting.

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | [TanStack Start](https://tanstack.com/start) (Vite-based, React 19) |
| Language | TypeScript |
| Styling | Tailwind CSS v4 |
| Database | PostgreSQL via [Supabase](https://supabase.com) |
| ORM | [Drizzle ORM](https://orm.drizzle.team) |
| Auth | Supabase Auth |
| Validation | Zod |
| Icons | lucide-react |
| Dates | date-fns |
| Package Manager | [Bun](https://bun.sh) |
| Deployment | AWS Lightsail VPS (nginx + PM2) — see [`deploy/README.md`](./deploy/README.md) |

## Project Structure

This is a **Bun workspace monorepo** with the following packages:

```
vintra/
├── apps/
│   └── web/                  # Main TanStack Start application
│       ├── src/
│       │   ├── routes/       # File-based routing (TanStack Router)
│       │   ├── server/       # Server functions, middleware, DB access
│       │   ├── components/   # React components (ui/, layout/, modules/)
│       │   ├── hooks/        # Custom React hooks
│       │   ├── lib/          # Utilities (currency, HPP calc, constants)
│       │   ├── types/        # Shared TypeScript types
│       │   └── styles/       # Global styles + Tailwind
│       ├── vite.config.ts
│       └── server-entry.mjs     # Node entry for PM2 (prod)
│
├── packages/
│   ├── db/                   # @vintra/db — Drizzle schema, client, migrations
│   └── shared/               # @vintra/shared — Zod validators, constants
│
└── tooling/
    └── typescript/           # Shared tsconfig base
```

## Prerequisites

- [Bun](https://bun.sh) v1.0+
- A [Supabase](https://supabase.com) project (free tier works)

## Getting Started

### 1. Clone the repository

```bash
git clone git@github.com:kriptonhaz/vintra.git
cd Vintra
```

### 2. Install dependencies

```bash
bun install
```

### 3. Set up environment variables

Copy the example env file and fill in your Supabase credentials:

```bash
cp apps/web/.env.example apps/web/.env
```

Then edit `apps/web/.env` with your values:

```bash
# Supabase (VITE_ prefix = exposed to browser, no prefix = server only)
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your-key
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SECRET_KEY=sb_secret_your-key

# Database (Supabase connection pooler — Transaction mode)
DATABASE_URL=postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres

# App
VITE_APP_URL=http://localhost:3000
VITE_APP_NAME=Vintra
```

> **Important:** Never commit `.env` files. They are already in `.gitignore`.

### 4. Push database schema

Push the Drizzle schema to your Supabase database:

```bash
bun run db:push
```

### 5. Start the dev server

```bash
bun run dev
```

The app will be available at `http://localhost:5173`.

## Scripts

All scripts are run from the **project root**:

| Command | Description |
|---|---|
| `bun run dev` | Start the development server |
| `bun run build` | Build for production |
| `bun run db:generate` | Generate Drizzle migration files from schema changes |
| `bun run db:migrate` | Run pending migrations against the database |
| `bun run db:push` | Push schema directly to the database (dev only) |
| `bun run db:studio` | Open Drizzle Studio (visual database browser) |

## Database

### Schema

Database schemas are defined in `packages/db/src/schema/` using Drizzle ORM:

- `auth.ts` — Tenants and tenant members
- `hpp.ts` — Materials, products, product materials (BOM), overhead costs
- `index.ts` — Re-exports all schemas

### Making schema changes

1. Edit the schema files in `packages/db/src/schema/`
2. Generate a migration:
   ```bash
   bun run db:generate
   ```
3. Review the generated SQL in `packages/db/src/migrations/`
4. Apply the migration:
   ```bash
   bun run db:migrate
   ```

For quick iteration during development, you can skip migrations and push directly:

```bash
bun run db:push
```

> **Warning:** `db:push` can be destructive. Use `db:generate` + `db:migrate` for production databases.

### Browsing data

```bash
bun run db:studio
```

Opens [Drizzle Studio](https://orm.drizzle.team/drizzle-studio/overview) in your browser for inspecting and editing data.

## Multi-Tenancy

Every data table includes a `tenant_id` column. All database queries are scoped to the authenticated user's tenant — no data leaks between businesses. Tenant-scoping is enforced at the server function level via `requireAuth()` middleware.

## Modules

| Module | Status | Pricing |
|---|---|---|
| HPP Calculator (Harga Pokok Penjualan) | In progress | Free |
| Point of Sales | Planned | Rp 79.000/mo |
| Inventory | Planned | Rp 49.000/mo |
| Attendance | Planned | Rp 29.000/mo |
| Financial Reports | Planned | Rp 59.000/mo |

The HPP Calculator is the free module that serves as the lead magnet. Paid modules are subscription-based with per-module pricing.

## Deployment

Two apps, **same Lightsail VPS** in Jakarta, deployed independently:

```
                 Browser
                    │ HTTPS
        ┌───────────┴───────────┐
        ▼                       ▼
   vintra.my.id         api.vintra.my.id
        │                       │
  nginx :443                 nginx :443
        │ proxy_pass            │ proxy_pass
        ▼ 127.0.0.1:3000        ▼ 127.0.0.1:4099
   Node + PM2              Go binary + systemd
   apps/web                apps/api
        │                       │
        ├── Supabase (DB + Auth)
        ├── AWS S3 (media)
        ├── Redis (api only)
        └── DeepSeek / OpenAI (ai providers)
```

| | Web (apps/web) | API (apps/api) |
|---|---|---|
| **URL** | https://vintra.my.id | https://api.vintra.my.id |
| **Runtime** | Node 22 (TanStack Start SSR) | Go static binary (Fiber + whatsmeow) |
| **Supervisor** | PM2 | systemd |
| **Build** | `bun run build` locally → rsync `dist/` | `go build` cross-compile to linux/amd64 locally → rsync binary |
| **Port** | 3000 (behind nginx) | 4099 (behind nginx) |

### Deploy

From your local machine:

```bash
./deploy.sh web      # ~30s — build TanStack Start, rsync, pm2 reload
./deploy.sh api      # ~10s — cross-compile Go binary, rsync, systemctl restart
./deploy.sh          # → same as `web` (legacy default)
```

Each is independent — deploy one without touching the other. The api deploy
ends by probing `/healthz` over SSH; if the binary doesn't come back up
cleanly, the script fails fast.

### Full deployment docs

- **[`deploy/README.md`](./deploy/README.md)** — umbrella deploy doc: architecture,
  quick deploy commands, web first-time server setup, troubleshooting,
  useful server commands.
- **[`deploy/api/README.md`](./deploy/api/README.md)** — api first-time VPS setup
  checklist: Redis install + config, systemd unit + sudoers rule, `.env` layout,
  certbot for `api.vintra.my.id`, nginx vhost.

## Architecture Notes

- **Server functions** use `createServerFn` from `@tanstack/react-start`. All mutations use `{ method: 'POST' }`, queries use the default GET.
- **Validation** is handled with Zod schemas via `.inputValidator()` on server functions.
- **Routing** uses TanStack Router file-based routing. Protected routes live under `_authed/`, module routes under `_authed/{module}/`.
- **Styling** uses Tailwind CSS v4 with the `@tailwindcss/vite` plugin — no `tailwind.config.ts` needed.
- **Money fields** use `numeric` type in the database (never `float`) to avoid precision issues.
- **UI text** is in Bahasa Indonesia; code, comments, and commits are in English.

## License

Private — All rights reserved.
