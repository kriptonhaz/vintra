import { pgTable, uuid, text, boolean, timestamp } from 'drizzle-orm/pg-core'
import { roles } from './rbac'

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  businessName: text('business_name').notNull(),
  slug: text('slug').notNull().unique(),
  // One-tenant-per-owner enforced by UNIQUE constraint (migration
  // 0069). Multi-tenant-per-user support is on the roadmap — when
  // it lands the constraint gets dropped and a session-level
  // tenant picker takes over.
  ownerId: uuid('owner_id').notNull().unique(),
  plan: text('plan').notNull().default('free'),
  activeModules: text('active_modules').array().notNull().default(['hpp']),
  businessCategory: text('business_category'),
  employeeRange: text('employee_range'),
  /**
   * JUR-185: tenant-chosen vanity slug for the public subdomain
   * (`<public_slug>.vintra.my.id`). Distinct from `slug` which is an
   * auto-generated internal identifier. Nullable until claimed; partial
   * unique index (`public_slug IS NOT NULL`) enforces uniqueness only
   * across claimed slugs so the majority of tenants (who haven't
   * claimed yet) can coexist at NULL.
   */
  publicSlug: text('public_slug'),
  /**
   * Public-site (situs) topology:
   *   - `single` — one tenant-wide site owned by the main branch;
   *     its booking widget lets the customer pick an outlet.
   *   - `per_branch` — each branch publishes its own site + slug.
   */
  situsMode: text('situs_mode').notNull().default('single'),
  onboardingCompleted: boolean('onboarding_completed').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const tenantMembers = pgTable('tenant_members', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .references(() => tenants.id)
    .notNull(),
  userId: uuid('user_id').notNull(),
  role: text('role').notNull().default('member'),
  roleId: uuid('role_id').references(() => roles.id),
  /**
   * HR profile, populated by the owner from the Anggota Tim form.
   * All nullable so existing rows (pre-migration) stay valid; the
   * UI shows "—" for missing values and prompts an edit.
   * `email` lives on Supabase Auth — we read it via getUserById, not
   * stored here, so a single user can never have stale email copies.
   */
  firstName: text('first_name'),
  lastName: text('last_name'),
  phone: text('phone'),
  jobTitle: text('job_title'),
  photoKey: text('photo_key'),
  /**
   * WhatsApp OTP login (JUR-wa-login). When true, this member can sign in
   * by sending a "minta otp login" message to the tenant's WA instance.
   * Opt-in per member; owner toggles it from the Anggota Tim UI.
   */
  waLoginEnabled: boolean('wa_login_enabled').notNull().default(false),
  /**
   * Synthetic Supabase auth email for phone-only staff (no real email).
   * Format: `wa-{tenantSlug}-{e164Phone}@login.vintra.local`. NULL when
   * the member has a real email — the WA OTP flow uses Supabase's actual
   * user email in that case. Unique so the synthetic identifier never
   * collides between tenants.
   */
  waLoginEmail: text('wa_login_email').unique(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})
