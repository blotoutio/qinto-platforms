CREATE TABLE `qinto_connections` (
	`handle` text PRIMARY KEY NOT NULL,
	`qinto_user_id` text,
	`qinto_user_email` text,
	`app_name` text,
	`access_token_enc` text NOT NULL,
	`access_token_expires_at` integer NOT NULL,
	`refresh_token_enc` text,
	`scope` text NOT NULL,
	`connected_at` integer NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`handle`) REFERENCES `stores`(`handle`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `qinto_oauth_states` (
	`state` text PRIMARY KEY NOT NULL,
	`handle` text NOT NULL,
	`code_verifier` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `qinto_oauth_states_created_at` ON `qinto_oauth_states` (`created_at`);--> statement-breakpoint
CREATE TABLE `onboarding` (
	`handle` text PRIMARY KEY NOT NULL,
	`step` text NOT NULL,
	`team_id` text,
	`domain_id` text,
	`root_domain` text,
	`subdomain` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`handle`) REFERENCES `stores`(`handle`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "onboarding_step" CHECK("onboarding"."step" in ('connect','choose','site','dns','deploy','done'))
);
--> statement-breakpoint
CREATE TABLE `pixel_state` (
	`handle` text PRIMARY KEY NOT NULL,
	`tracking_enabled` integer DEFAULT true NOT NULL,
	`pushed_enabled` integer,
	`destination` text,
	`settings_pushed_at` integer,
	`last_push_error` text,
	`last_push_reason` text,
	`disabled_at` integer,
	`disabled_by` text,
	FOREIGN KEY (`handle`) REFERENCES `stores`(`handle`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `shopline_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`handle` text NOT NULL,
	`scope` text,
	`expires` integer,
	`access_token_enc` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `shopline_sessions_handle` ON `shopline_sessions` (`handle`);--> statement-breakpoint
CREATE TABLE `site_selections` (
	`handle` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`team_name` text,
	`domain_id` text NOT NULL,
	`site_name` text,
	`delivery_host` text NOT NULL,
	`using_development_url` integer NOT NULL,
	`qinto_user_id` text,
	`selected_at` integer NOT NULL,
	FOREIGN KEY (`handle`) REFERENCES `stores`(`handle`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `stores` (
	`handle` text PRIMARY KEY NOT NULL,
	`shop_id` text,
	`shop_name` text,
	`primary_domain` text,
	`currency` text,
	`iana_timezone` text,
	`installed_at` integer NOT NULL,
	`uninstalled_at` integer
);
