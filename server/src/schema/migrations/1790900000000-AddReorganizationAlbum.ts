import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE "reorganization" ADD "albumId" uuid;`.execute(db);
  await sql`ALTER TABLE "reorganization_item" ADD "addedToAlbum" boolean NOT NULL DEFAULT false;`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE "reorganization" DROP COLUMN "albumId";`.execute(db);
  await sql`ALTER TABLE "reorganization_item" DROP COLUMN "addedToAlbum";`.execute(db);
}
