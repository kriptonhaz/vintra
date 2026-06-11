CREATE TABLE "active_impersonations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_user_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "active_impersonations_admin_user_id_unique" UNIQUE("admin_user_id")
);
--> statement-breakpoint
CREATE TABLE "platform_admin_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_user_id" uuid NOT NULL,
	"action" text NOT NULL,
	"target_tenant_id" uuid,
	"target_user_id" uuid,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "active_impersonations" ADD CONSTRAINT "active_impersonations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;