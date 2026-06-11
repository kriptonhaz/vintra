ALTER TABLE "attendance_settings" DROP COLUMN "active_mode";--> statement-breakpoint
ALTER TABLE "attendance_settings" ADD COLUMN "mode_gps_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance_settings" ADD COLUMN "mode_photo_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance_settings" ADD COLUMN "mode_qr_enabled" boolean DEFAULT false NOT NULL;
