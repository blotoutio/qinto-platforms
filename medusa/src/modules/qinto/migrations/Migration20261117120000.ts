import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * 0.2.0: one first-party domain and Tracking switch per sales channel, replacing 0.1.x's single
 * store-wide destination, and `qinto_purchase_claim`, one row per order whose Purchase was sent.
 *
 * Runs after Migration20260930120000 (0.1.x, unchanged), which created `qinto_connection`. This
 * creates `qinto_channel_connection` and drops `qinto_connection`. The old URL is not carried over:
 * after upgrading, each store sends nothing until its first-party domain is entered in Admin. See
 * CHANGELOG 0.2.0.
 *
 * `down` restores the 0.1.x table so a rollback to 0.1.x boots (its migration is recorded as run
 * and will not create it again), but not the old URL.
 */
export class Migration20261117120000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `create table if not exists "qinto_channel_connection" ("id" text not null, "sales_channel_id" text not null, "first_party_domain" text null, "enabled" boolean not null default true, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "qinto_channel_connection_pkey" primary key ("id"));`
    )
    this.addSql(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_qinto_channel_connection_sales_channel_id_unique" ON "qinto_channel_connection" ("sales_channel_id") WHERE deleted_at IS NULL;`
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_qinto_channel_connection_deleted_at" ON "qinto_channel_connection" ("deleted_at") WHERE deleted_at IS NULL;`
    )

    this.addSql(`drop table if exists "qinto_connection" cascade;`)

    this.addSql(
      `create table if not exists "qinto_purchase_claim" ("id" text not null, "order_id" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "qinto_purchase_claim_pkey" primary key ("id"));`
    )
    this.addSql(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_qinto_purchase_claim_order_id_unique" ON "qinto_purchase_claim" ("order_id") WHERE deleted_at IS NULL;`
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_qinto_purchase_claim_deleted_at" ON "qinto_purchase_claim" ("deleted_at") WHERE deleted_at IS NULL;`
    )
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "qinto_purchase_claim" cascade;`)
    this.addSql(`drop table if exists "qinto_channel_connection" cascade;`)

    this.addSql(
      `create table if not exists "qinto_connection" ("id" text not null, "qinto_url" text null, "enabled" boolean not null default true, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "qinto_connection_pkey" primary key ("id"));`
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_qinto_connection_deleted_at" ON "qinto_connection" ("deleted_at") WHERE deleted_at IS NULL;`
    )
  }
}
