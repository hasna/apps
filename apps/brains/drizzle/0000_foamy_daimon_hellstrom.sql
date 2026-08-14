CREATE TABLE `fine_tuned_models` (
	`id` text PRIMARY KEY NOT NULL,
	`base_model` text NOT NULL,
	`name` text NOT NULL,
	`provider` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`fine_tune_job_id` text,
	`display_name` text,
	`description` text,
	`collection` text,
	`tags` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `training_datasets` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`file_path` text NOT NULL,
	`example_count` integer NOT NULL,
	`created_at` integer NOT NULL,
	`used_in_job_id` text,
	FOREIGN KEY (`used_in_job_id`) REFERENCES `training_jobs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `training_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`model_id` text NOT NULL,
	`provider` text NOT NULL,
	`status` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`metrics` text,
	`error` text,
	FOREIGN KEY (`model_id`) REFERENCES `fine_tuned_models`(`id`) ON UPDATE no action ON DELETE no action
);
