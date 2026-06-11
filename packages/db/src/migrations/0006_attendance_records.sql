CREATE TABLE "attendance_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"staff_profile_id" uuid NOT NULL,
	"branch_id" uuid,
	"date" date NOT NULL,
	"scheduled_in" time,
	"scheduled_out" time,
	"clock_in_at" timestamp,
	"clock_out_at" timestamp,
	"clock_in_modes" text[],
	"clock_out_modes" text[],
	"clock_in_lat" numeric(10, 7),
	"clock_in_lng" numeric(10, 7),
	"clock_out_lat" numeric(10, 7),
	"clock_out_lng" numeric(10, 7),
	"clock_in_photo_key" text,
	"clock_out_photo_key" text,
	"clock_in_status" text,
	"clock_out_status" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_records_staff_date_unique" UNIQUE("staff_profile_id","date")
);
--> statement-breakpoint
CREATE TABLE "qr_host_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"host_user_id" uuid NOT NULL,
	"last_token_issued_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "qr_host_sessions_host_user_id_unique" UNIQUE("host_user_id")
);
--> statement-breakpoint
CREATE TABLE "qr_consumed_nonces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nonce" text NOT NULL,
	"tenant_id" uuid NOT NULL,
	"staff_profile_id" uuid NOT NULL,
	"consumed_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "qr_consumed_nonces_nonce_unique" UNIQUE("nonce")
);
--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_staff_profile_id_staff_profiles_id_fk" FOREIGN KEY ("staff_profile_id") REFERENCES "public"."staff_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qr_host_sessions" ADD CONSTRAINT "qr_host_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qr_host_sessions" ADD CONSTRAINT "qr_host_sessions_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qr_consumed_nonces" ADD CONSTRAINT "qr_consumed_nonces_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qr_consumed_nonces" ADD CONSTRAINT "qr_consumed_nonces_staff_profile_id_staff_profiles_id_fk" FOREIGN KEY ("staff_profile_id") REFERENCES "public"."staff_profiles"("id") ON DELETE cascade ON UPDATE no action;
