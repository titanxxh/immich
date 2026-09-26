import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE "trip" ADD "source" character varying NOT NULL DEFAULT 'auto';`.execute(db);
  await sql`ALTER TABLE "trip" ADD "pointLatitude" double precision;`.execute(db);
  await sql`ALTER TABLE "trip" ADD "pointLongitude" double precision;`.execute(db);
  await sql`ALTER TABLE "trip" ADD "dayCount" integer NOT NULL DEFAULT 0;`.execute(db);
  await sql`ALTER TABLE "trip" ADD "assetCount" integer NOT NULL DEFAULT 0;`.execute(db);
  await sql`ALTER TABLE "trip" ADD "generatedThumbnailAssetId" uuid;`.execute(db);
  await sql`CREATE INDEX "trip_generatedThumbnailAssetId_idx" ON "trip" ("generatedThumbnailAssetId");`.execute(db);
  await sql`ALTER TABLE "trip" ADD CONSTRAINT "trip_generatedThumbnailAssetId_fkey" FOREIGN KEY ("generatedThumbnailAssetId") REFERENCES "asset" ("id") ON UPDATE CASCADE ON DELETE SET NULL;`.execute(db);
  // a trip reads from its first day on; later changes by the user are kept
  await sql`UPDATE "album" SET "order" = 'asc' WHERE "id" IN (SELECT "albumId" FROM "trip" WHERE "albumId" IS NOT NULL);`.execute(
    db,
  );
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE "trip" DROP CONSTRAINT "trip_generatedThumbnailAssetId_fkey";`.execute(db);
  await sql`DROP INDEX "trip_generatedThumbnailAssetId_idx";`.execute(db);
  await sql`ALTER TABLE "trip" DROP COLUMN "source";`.execute(db);
  await sql`ALTER TABLE "trip" DROP COLUMN "pointLatitude";`.execute(db);
  await sql`ALTER TABLE "trip" DROP COLUMN "pointLongitude";`.execute(db);
  await sql`ALTER TABLE "trip" DROP COLUMN "dayCount";`.execute(db);
  await sql`ALTER TABLE "trip" DROP COLUMN "assetCount";`.execute(db);
  await sql`ALTER TABLE "trip" DROP COLUMN "generatedThumbnailAssetId";`.execute(db);
}
