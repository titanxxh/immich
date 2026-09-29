import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE TABLE "region" (
  "id" character varying NOT NULL,
  "level" character varying NOT NULL,
  "countryId" character varying NOT NULL,
  "provinceId" character varying,
  "countryCode" character varying NOT NULL,
  "name" character varying NOT NULL,
  "nameZh" character varying,
  "latitude" double precision NOT NULL,
  "longitude" double precision NOT NULL,
  CONSTRAINT "region_pkey" PRIMARY KEY ("id")
);`.execute(db);
  await sql`CREATE TABLE "asset_region" (
  "assetId" uuid NOT NULL,
  "countryId" character varying,
  "provinceId" character varying,
  "regionId" character varying,
  "latitude" double precision NOT NULL,
  "longitude" double precision NOT NULL,
  "version" character varying NOT NULL,
  CONSTRAINT "asset_region_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "asset" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "asset_region_pkey" PRIMARY KEY ("assetId")
);`.execute(db);
  await sql`CREATE INDEX "asset_region_countryId_idx" ON "asset_region" ("countryId");`.execute(db);
  await sql`CREATE INDEX "asset_region_provinceId_idx" ON "asset_region" ("provinceId");`.execute(db);
  await sql`CREATE INDEX "asset_region_regionId_idx" ON "asset_region" ("regionId");`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE "region";`.execute(db);
  await sql`DROP TABLE "asset_region";`.execute(db);
}
