import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE "asset_job_status" ADD "sharpness" double precision;`.execute(db);
  await sql`ALTER TABLE "asset_job_status" ADD "sharpnessVersion" smallint;`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE "asset_job_status" DROP COLUMN "sharpness";`.execute(db);
  await sql`ALTER TABLE "asset_job_status" DROP COLUMN "sharpnessVersion";`.execute(db);
}
