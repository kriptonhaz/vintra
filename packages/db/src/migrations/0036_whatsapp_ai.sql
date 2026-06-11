CREATE TABLE "wa_instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"label" text NOT NULL,
	"phone_number" text,
	"status" text DEFAULT 'disconnected' NOT NULL,
	"last_connected_at" timestamp,
	"last_disconnect_reason" text,
	"ai_enabled" boolean DEFAULT false NOT NULL,
	"ai_provider" text DEFAULT 'openai',
	"ai_model" text DEFAULT 'gpt-4o-mini',
	"ai_system_prompt" text,
	"ai_temperature" text DEFAULT '0.7',
	"ai_max_history" integer DEFAULT 10 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wa_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"instance_id" uuid NOT NULL,
	"remote_jid" text NOT NULL,
	"external_id" text,
	"from_me" boolean NOT NULL,
	"type" text NOT NULL,
	"body" text,
	"media_key" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"ai_generated" boolean DEFAULT false NOT NULL,
	"ai_usage_log_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wa_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"instance_id" uuid NOT NULL,
	"remote_jid" text NOT NULL,
	"name" text,
	"push_name" text,
	"last_message_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_usage_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"feature" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"latency_ms" integer,
	"status" text NOT NULL,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wa_instances" ADD CONSTRAINT "wa_instances_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wa_messages" ADD CONSTRAINT "wa_messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wa_messages" ADD CONSTRAINT "wa_messages_instance_id_wa_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."wa_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wa_contacts" ADD CONSTRAINT "wa_contacts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wa_contacts" ADD CONSTRAINT "wa_contacts_instance_id_wa_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."wa_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wa_instances_tenant_idx" ON "wa_instances" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "wa_messages_instance_jid_time_idx" ON "wa_messages" USING btree ("instance_id","remote_jid","created_at");--> statement-breakpoint
CREATE INDEX "wa_messages_tenant_time_idx" ON "wa_messages" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "wa_messages_external_idx" ON "wa_messages" USING btree ("external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wa_contacts_instance_jid_uniq" ON "wa_contacts" USING btree ("instance_id","remote_jid");--> statement-breakpoint
CREATE INDEX "ai_usage_logs_tenant_time_idx" ON "ai_usage_logs" USING btree ("tenant_id","created_at");
