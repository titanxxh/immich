import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE TABLE "reorganization" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "ownerId" uuid NOT NULL,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updateId" uuid NOT NULL DEFAULT immich_uuid_v7(),
  "sourceType" character varying NOT NULL,
  "sourcePath" text,
  "sourceAlbumId" uuid,
  "sourceName" text NOT NULL,
  "targetPath" text NOT NULL,
  "preset" character varying NOT NULL,
  "autoRename" boolean NOT NULL DEFAULT false,
  "status" character varying NOT NULL,
  "isUndo" boolean NOT NULL DEFAULT false,
  "cancelRequested" boolean NOT NULL DEFAULT false,
  "inPlaceCount" integer NOT NULL DEFAULT 0,
  "createdFolders" text[] NOT NULL DEFAULT '{}',
  "removedFolders" text[] NOT NULL DEFAULT '{}',
  "error" text,
  "finishedAt" timestamp with time zone,
  CONSTRAINT "reorganization_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "reorganization_pkey" PRIMARY KEY ("id")
);`.execute(db);
  await sql`CREATE INDEX "reorganization_ownerId_idx" ON "reorganization" ("ownerId");`.execute(db);
  await sql`CREATE OR REPLACE TRIGGER "reorganization_updatedAt"
  BEFORE UPDATE ON "reorganization"
  FOR EACH ROW
  EXECUTE FUNCTION updated_at();`.execute(db);
  await sql`CREATE TABLE "reorganization_item" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "reorganizationId" uuid NOT NULL,
  "assetId" uuid,
  "position" integer NOT NULL,
  "status" character varying NOT NULL,
  "reason" character varying,
  "error" text,
  "fromPath" text NOT NULL,
  "toPath" text,
  "fromLibraryId" uuid,
  "toLibraryId" uuid,
  "sidecarFromPath" text,
  "sidecarToPath" text,
  "videoAssetId" uuid,
  "videoFromPath" text,
  "videoToPath" text,
  CONSTRAINT "reorganization_item_reorganizationId_fkey" FOREIGN KEY ("reorganizationId") REFERENCES "reorganization" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "reorganization_item_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "asset" ("id") ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT "reorganization_item_pkey" PRIMARY KEY ("id")
);`.execute(db);
  await sql`CREATE INDEX "reorganization_item_reorganizationId_idx" ON "reorganization_item" ("reorganizationId");`.execute(db);
  await sql`CREATE INDEX "reorganization_item_assetId_idx" ON "reorganization_item" ("assetId");`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_reorganization_updatedAt', '{"type":"trigger","name":"reorganization_updatedAt","sql":"CREATE OR REPLACE TRIGGER \\"reorganization_updatedAt\\"\\n  BEFORE UPDATE ON \\"reorganization\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();"}'::jsonb);`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE "reorganization_item";`.execute(db);
  await sql`DROP TRIGGER "reorganization_updatedAt" ON "reorganization";`.execute(db);
  await sql`DROP TABLE "reorganization";`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'trigger_reorganization_updatedAt';`.execute(db);
}
