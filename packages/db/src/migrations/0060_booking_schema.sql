CREATE TABLE IF NOT EXISTS booking_settings (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  mode text NOT NULL DEFAULT 'slot',
  industry_template text,
  slot_duration_min integer,
  working_hours jsonb,
  blackout_dates jsonb DEFAULT '[]',
  buffer_min_between_slots integer,
  setup_completed boolean NOT NULL DEFAULT false,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT booking_settings_mode_chk CHECK (mode IN ('slot', 'queue', 'stay'))
);

CREATE TABLE IF NOT EXISTS booking_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  kind text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT booking_resources_kind_chk CHECK (kind IN ('staff', 'station', 'room')),
  CONSTRAINT booking_resources_tenant_name_uniq UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS booking_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  duration_min integer NOT NULL,
  price numeric(15,2) NOT NULL DEFAULT '0',
  requires_resource_kind text,
  color text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT booking_services_resource_kind_chk CHECK (requires_resource_kind IS NULL OR requires_resource_kind IN ('staff', 'station', 'room')),
  CONSTRAINT booking_services_tenant_name_uniq UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  public_name text,
  public_phone text,
  mode text NOT NULL,
  start_at timestamp NOT NULL,
  end_at timestamp,
  status text NOT NULL DEFAULT 'pending',
  resource_id uuid REFERENCES booking_resources(id) ON DELETE SET NULL,
  service_ids text[] NOT NULL DEFAULT '{}',
  note text,
  source text NOT NULL DEFAULT 'manual',
  created_by_user_id uuid NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT bookings_mode_chk CHECK (mode IN ('slot', 'queue', 'stay')),
  CONSTRAINT bookings_status_chk CHECK (status IN ('pending', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show')),
  CONSTRAINT bookings_source_chk CHECK (source IN ('walk_in', 'public_page', 'wa', 'manual'))
);

CREATE INDEX IF NOT EXISTS bookings_resource_start_idx ON bookings (resource_id, start_at);
CREATE INDEX IF NOT EXISTS bookings_tenant_start_idx ON bookings (tenant_id, start_at);
