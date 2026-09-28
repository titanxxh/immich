import { Injectable } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { DummyValue, GenerateSql } from 'src/decorators';
import { AssetVisibility } from 'src/enum';
import { DB } from 'src/schema';

/** Marks a photo the user chose not to locate, so it is no longer offered. */
export const LOCATE_IGNORED_KEY = 'locate-ignored';

@Injectable()
export class LocateRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  /** Camera photos of the user without a location, oldest first, leaving out those the user ignored. */
  @GenerateSql({ params: [DummyValue.UUID] })
  getUnlocatedAssets(ownerId: string) {
    return this.db
      .selectFrom('asset')
      .innerJoin('asset_exif', 'asset_exif.assetId', 'asset.id')
      .select(['asset.id', 'asset.localDateTime'])
      .where('asset.ownerId', '=', ownerId)
      .where('asset.deletedAt', 'is', null)
      .where('asset.visibility', 'in', [AssetVisibility.Timeline, AssetVisibility.Archive])
      .where('asset_exif.latitude', 'is', null)
      .where('asset_exif.make', 'is not', null)
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('asset_metadata')
              .whereRef('asset_metadata.assetId', '=', 'asset.id')
              .where('asset_metadata.key', '=', LOCATE_IGNORED_KEY),
          ),
        ),
      )
      .orderBy('asset.localDateTime')
      .orderBy('asset.id')
      .execute();
  }

  /** The time and path of the user's own photos among the given ones. */
  @GenerateSql({ params: [DummyValue.UUID, [DummyValue.UUID]] })
  getAssets(ownerId: string, assetIds: string[]) {
    return this.db
      .selectFrom('asset')
      .select(['asset.id', 'asset.localDateTime', 'asset.originalPath'])
      .where('asset.ownerId', '=', ownerId)
      .where('asset.id', 'in', assetIds)
      .execute();
  }

  /** Positions of the user's located photos directly inside any of the folders. */
  @GenerateSql({ params: [DummyValue.UUID, [DummyValue.STRING]] })
  getLocatedInDirectories(ownerId: string, directories: string[]) {
    return this.db
      .selectFrom('asset')
      .innerJoin('asset_exif', 'asset_exif.assetId', 'asset.id')
      .select(['asset_exif.latitude', 'asset_exif.longitude'])
      .where('asset.ownerId', '=', ownerId)
      .where('asset.deletedAt', 'is', null)
      .where('asset_exif.latitude', 'is not', null)
      .where('asset_exif.longitude', 'is not', null)
      .where(sql<string>`regexp_replace("asset"."originalPath", '/[^/]*$', '')`, 'in', directories)
      .limit(10_000)
      .$narrowType<{ latitude: number; longitude: number }>()
      .execute();
  }

  /** The user's located photo taken closest to the given time, within the window. */
  @GenerateSql({ params: [DummyValue.UUID, DummyValue.DATE, DummyValue.DATE, DummyValue.DATE] })
  getNearestLocated(ownerId: string, time: Date, from: Date, to: Date) {
    return this.db
      .selectFrom('asset')
      .innerJoin('asset_exif', 'asset_exif.assetId', 'asset.id')
      .select(['asset_exif.latitude', 'asset_exif.longitude'])
      .where('asset.ownerId', '=', ownerId)
      .where('asset.deletedAt', 'is', null)
      .where('asset_exif.latitude', 'is not', null)
      .where('asset_exif.longitude', 'is not', null)
      .where('asset.localDateTime', '>=', from)
      .where('asset.localDateTime', '<=', to)
      .orderBy(sql`abs(extract(epoch from ("asset"."localDateTime" - ${time}::timestamptz)))`)
      .limit(1)
      .$narrowType<{ latitude: number; longitude: number }>()
      .executeTakeFirst();
  }

  @GenerateSql({ params: [[DummyValue.UUID]] })
  async ignore(assetIds: string[]) {
    if (assetIds.length === 0) {
      return;
    }

    await this.db
      .insertInto('asset_metadata')
      .values(assetIds.map((assetId) => ({ assetId, key: LOCATE_IGNORED_KEY, value: {} })))
      .onConflict((oc) => oc.columns(['assetId', 'key']).doNothing())
      .execute();
  }
}
