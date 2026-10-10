import { Kysely, sql } from 'kysely';
import { getVectorExtension } from 'src/repositories/database.repository';
import { vectorIndexQuery } from 'src/utils/database';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE TABLE "smart_search_gemma" (
  "assetId" uuid NOT NULL,
  "embedding" vector(768) NOT NULL,
  CONSTRAINT "smart_search_gemma_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "asset" ("id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "smart_search_gemma_pkey" PRIMARY KEY ("assetId")
);`.execute(db);
  await sql`ALTER TABLE "smart_search_gemma" ALTER COLUMN "embedding" SET STORAGE EXTERNAL;`.execute(db);
  const vectorExtension = await getVectorExtension(db);
  await sql
    .raw(vectorIndexQuery({ vectorExtension, table: 'smart_search_gemma', indexName: 'gemma_index' }))
    .execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE "smart_search_gemma";`.execute(db);
}
