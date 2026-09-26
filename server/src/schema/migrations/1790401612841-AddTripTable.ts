import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE TABLE "trip" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "ownerId" uuid NOT NULL,
  "albumId" uuid,
  "startAt" timestamp with time zone NOT NULL,
  "endAt" timestamp with time zone NOT NULL,
  "generatedName" character varying NOT NULL,
  "lastSyncedAt" timestamp with time zone NOT NULL,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updateId" uuid NOT NULL DEFAULT immich_uuid_v7(),
  CONSTRAINT "trip_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "trip_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "album" ("id") ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT "trip_pkey" PRIMARY KEY ("id")
);`.execute(db);
  await sql`CREATE INDEX "trip_ownerId_idx" ON "trip" ("ownerId");`.execute(db);
  await sql`CREATE INDEX "trip_albumId_idx" ON "trip" ("albumId");`.execute(db);
  await sql`CREATE INDEX "trip_updateId_idx" ON "trip" ("updateId");`.execute(db);
  await sql`CREATE OR REPLACE TRIGGER "trip_updatedAt"
  BEFORE UPDATE ON "trip"
  FOR EACH ROW
  EXECUTE FUNCTION updated_at();`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_trip_updatedAt', '{"type":"trigger","name":"trip_updatedAt","sql":"CREATE OR REPLACE TRIGGER \\"trip_updatedAt\\"\\n  BEFORE UPDATE ON \\"trip\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();"}'::jsonb);`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TRIGGER "trip_updatedAt" ON "trip";`.execute(db);
  await sql`DROP TABLE "trip";`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'trigger_trip_updatedAt';`.execute(db);
}
