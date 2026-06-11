CREATE TABLE "wa_subscription_plans" (
	"plan_key" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"price_idr" numeric(15, 0) NOT NULL,
	"max_instances" integer NOT NULL,
	"max_monthly_replies" integer NOT NULL,
	"rag_scope" text DEFAULT 'stock' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wa_settings" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"tier" text DEFAULT 'free' NOT NULL,
	"subscription_active" boolean DEFAULT false NOT NULL,
	"subscription_expires_at" timestamp,
	"trial_ends_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wa_settings" ADD CONSTRAINT "wa_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
INSERT INTO "wa_subscription_plans" ("plan_key", "display_name", "price_idr", "max_instances", "max_monthly_replies", "rag_scope")
VALUES
  ('basic',      'Basic',       99000,  1,     1000, 'stock'),
  ('komplit',    'Komplit',    299000,  3,     5000, 'full'),
  ('enterprise', 'Enterprise', 800000, 10,   50000, 'full')
ON CONFLICT ("plan_key") DO NOTHING;
