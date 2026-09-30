import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * The plugin's entire database footprint: one table, two meaningful columns.
 *
 * > Note: `.snapshot-medusa-qinto.json` is not checked in alongside this.
 * > It is an input to `medusa plugin:db:generate` only, never read by
 * > `db:migrate`, and regenerating it needs a database connection. Run
 * > `medusa plugin:db:generate` once against any store to recreate it before
 * > authoring the next migration.
 */
export class Migration20260930120000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `create table if not exists "qinto_connection" ("id" text not null, "qinto_url" text null, "enabled" boolean not null default true, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "qinto_connection_pkey" primary key ("id"));`
    )

    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_qinto_connection_deleted_at" ON "qinto_connection" ("deleted_at") WHERE deleted_at IS NULL;`
    )
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "qinto_connection" cascade;`)
  }
}
