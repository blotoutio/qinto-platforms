CREATE TABLE `oauth_states` (
	`state` text PRIMARY KEY NOT NULL,
	`registration_id` text NOT NULL,
	`code_verifier` text NOT NULL,
	`wp_nonce` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`registration_id`) REFERENCES `registrations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `oauth_states_created_at` ON `oauth_states` (`created_at`);--> statement-breakpoint
CREATE TABLE `qinto_connections` (
	`registration_id` text PRIMARY KEY NOT NULL,
	`qinto_user_id` text,
	`qinto_user_email` text,
	`access_token_enc` text NOT NULL,
	`access_token_expires_at` integer NOT NULL,
	`refresh_token_enc` text,
	`scope` text NOT NULL,
	`connected_at` integer NOT NULL,
	`revoked_at` integer,
	`refresh_lease_until` integer,
	FOREIGN KEY (`registration_id`) REFERENCES `registrations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `registrations` (
	`id` text PRIMARY KEY NOT NULL,
	`site_secret_enc` text NOT NULL,
	`shop_id` text NOT NULL,
	`return_url` text NOT NULL,
	`verified_at` integer,
	`created_at` integer NOT NULL,
	`last_seen_at` integer
);
--> statement-breakpoint
CREATE INDEX `registrations_created_at` ON `registrations` (`created_at`);--> statement-breakpoint
CREATE TABLE `site_selections` (
	`registration_id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`domain_id` text NOT NULL,
	`site_name` text,
	`delivery_host` text NOT NULL,
	`using_development_url` integer NOT NULL,
	`app_installed_at` integer NOT NULL,
	`selected_at` integer NOT NULL,
	FOREIGN KEY (`registration_id`) REFERENCES `registrations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `used_nonces` (
	`registration_id` text NOT NULL,
	`nonce` text NOT NULL,
	`expires_at` integer NOT NULL,
	PRIMARY KEY(`registration_id`, `nonce`)
);
--> statement-breakpoint
CREATE INDEX `used_nonces_expires_at` ON `used_nonces` (`expires_at`);