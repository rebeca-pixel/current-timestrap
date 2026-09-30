CREATE TABLE "departments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"leader" text,
	"parent_department_id" varchar,
	"organisation_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "departments_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_code" text NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"password" text NOT NULL,
	"role" text DEFAULT 'employee' NOT NULL,
	"department" text,
	"group_name" text,
	"line_manager_id" varchar,
	"organisation_id" varchar,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "employees_employee_code_unique" UNIQUE("employee_code")
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"parent_department" text NOT NULL,
	"group_leader" text,
	"organisation_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "managers" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"employee_code" text NOT NULL,
	"email" text,
	"department" text,
	CONSTRAINT "managers_employee_code_unique" UNIQUE("employee_code")
);
--> statement-breakpoint
CREATE TABLE "organisations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"gst_id" text NOT NULL,
	"main_address" text NOT NULL,
	"branch_address" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_entries" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" varchar NOT NULL,
	"employee_code" text NOT NULL,
	"employee_name" text NOT NULL,
	"date" text NOT NULL,
	"project_name" text NOT NULL,
	"task_description" text NOT NULL,
	"quantify" text,
	"achievements" text,
	"scope_of_improvements" text,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"total_hours" text NOT NULL,
	"percentage_complete" integer DEFAULT 0,
	"status" text DEFAULT 'pending' NOT NULL,
	"manager_approved" boolean DEFAULT false,
	"manager_approved_by" varchar,
	"manager_approved_at" timestamp,
	"submitted_at" timestamp DEFAULT now() NOT NULL,
	"approved_by" varchar,
	"approved_at" timestamp,
	"rejection_reason" text,
	"approval_comment" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"password" text NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
