import { Injectable } from '@nestjs/common';
import { ExpressionBuilder, Insertable, Kysely, sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { gunzip } from 'node:zlib';
import { DummyValue, GenerateSql } from 'src/decorators';
import { AssetVisibility } from 'src/enum';
import { DB } from 'src/schema';
import { AssetRegionTable } from 'src/schema/tables/asset-region.table';
import { RegionTable } from 'src/schema/tables/region.table';
import { asUuid } from 'src/utils/database';

const inRegion = (eb: ExpressionBuilder<DB, 'asset_region'>, id: string) =>
  eb.or([
    eb('asset_region.regionId', '=', id),
    eb('asset_region.provinceId', '=', id),
    eb('asset_region.countryId', '=', id),
  ]);

const gunzipAsync = promisify(gunzip);

@Injectable()
export class FootprintRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  async readVersion(path: string) {
    const version = await readFile(path, 'utf8');
    return version.trim();
  }

  /** Reads one of the gzipped JSON footprint files. */
  async readJson<T>(path: string): Promise<T> {
    const json = await gunzipAsync(await readFile(path));
    return JSON.parse(json.toString('utf8')) as T;
  }

  async replaceRegions(regions: Insertable<RegionTable>[]) {
    await this.db.transaction().execute(async (tx) => {
      await tx.deleteFrom('region').execute();
      for (let index = 0; index < regions.length; index += 1000) {
        await tx
          .insertInto('region')
          .values(regions.slice(index, index + 1000))
          .execute();
      }
    });
  }

  /** Located photos without regions, or whose location or region files changed since they got them. */
  @GenerateSql({ params: [DummyValue.STRING, 1000] })
  getAssetsToAssign(version: string, limit: number) {
    return this.db
      .selectFrom('asset_exif')
      .leftJoin('asset_region', 'asset_region.assetId', 'asset_exif.assetId')
      .select(['asset_exif.assetId', 'asset_exif.latitude', 'asset_exif.longitude'])
      .where('asset_exif.latitude', 'is not', null)
      .where('asset_exif.longitude', 'is not', null)
      .where((eb) =>
        eb.or([
          eb('asset_region.assetId', 'is', null),
          eb('asset_region.version', '!=', version),
          eb('asset_region.latitude', '!=', eb.ref('asset_exif.latitude')),
          eb('asset_region.longitude', '!=', eb.ref('asset_exif.longitude')),
        ]),
      )
      .limit(limit)
      .$narrowType<{ latitude: number; longitude: number }>()
      .execute();
  }

  async upsertAssetRegions(rows: Insertable<AssetRegionTable>[]) {
    if (rows.length === 0) {
      return;
    }

    await this.db
      .insertInto('asset_region')
      .values(rows.map((row) => ({ ...row, assetId: asUuid(row.assetId) })))
      .onConflict((oc) =>
        oc.column('assetId').doUpdateSet((eb) => ({
          countryId: eb.ref('excluded.countryId'),
          provinceId: eb.ref('excluded.provinceId'),
          regionId: eb.ref('excluded.regionId'),
          latitude: eb.ref('excluded.latitude'),
          longitude: eb.ref('excluded.longitude'),
          version: eb.ref('excluded.version'),
        })),
      )
      .execute();
  }

  /** Forgets the regions of photos whose location was removed. */
  @GenerateSql()
  async deleteUnlocated() {
    await this.db
      .deleteFrom('asset_region')
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('asset_exif')
              .whereRef('asset_exif.assetId', '=', 'asset_region.assetId')
              .where('asset_exif.latitude', 'is not', null)
              .where('asset_exif.longitude', 'is not', null),
          ),
        ),
      )
      .execute();
  }

  /** Own camera photos in the timeline or archive, with their regions. */
  private visits(userId: string) {
    return this.db
      .selectFrom('asset')
      .innerJoin('asset_exif', 'asset_exif.assetId', 'asset.id')
      .innerJoin('asset_region', 'asset_region.assetId', 'asset.id')
      .where('asset.ownerId', '=', asUuid(userId))
      .where('asset.deletedAt', 'is', null)
      .where('asset.visibility', 'in', [AssetVisibility.Timeline, AssetVisibility.Archive])
      .where('asset_exif.make', 'is not', null)
      .where('asset_exif.make', '!=', '');
  }

  /** First and last visit, photos and days for every region the user took camera photos in. */
  @GenerateSql({ params: [DummyValue.UUID] })
  getRegionVisits(userId: string) {
    return this.visits(userId)
      .where('asset_region.regionId', 'is not', null)
      .select((eb) => [
        'asset_region.regionId as id',
        eb.fn.min('asset.localDateTime').as('firstVisitAt'),
        eb.fn.max('asset.localDateTime').as('lastVisitAt'),
        eb.fn.countAll<number>().as('assetCount'),
        sql<number>`count(distinct ("asset"."localDateTime" at time zone 'UTC')::date)::int`.as('dayCount'),
      ])
      .groupBy('asset_region.regionId')
      .$narrowType<{ id: string }>()
      .execute();
  }

  /** The same figures for one region, province or country. */
  @GenerateSql({ params: [DummyValue.UUID, DummyValue.STRING] })
  getVisit(userId: string, id: string) {
    return this.visits(userId)
      .where((eb) => inRegion(eb, id))
      .select((eb) => [
        eb.fn.min('asset.localDateTime').as('firstVisitAt'),
        eb.fn.max('asset.localDateTime').as('lastVisitAt'),
        eb.fn.countAll<number>().as('assetCount'),
        sql<number>`count(distinct ("asset"."localDateTime" at time zone 'UTC')::date)::int`.as('dayCount'),
      ])
      .executeTakeFirstOrThrow();
  }

  /** The photos taken in a region, province or country, oldest first. */
  @GenerateSql({ params: [DummyValue.UUID, DummyValue.STRING] })
  async getAssetIds(userId: string, id: string) {
    const rows = await this.visits(userId)
      .where((eb) => inRegion(eb, id))
      .select('asset.id')
      .orderBy('asset.localDateTime')
      .orderBy('asset.id')
      .execute();
    return rows.map(({ id }) => id);
  }

  @GenerateSql({ params: [[DummyValue.STRING]] })
  getRegions(ids: string[]) {
    if (ids.length === 0) {
      return Promise.resolve([]);
    }
    return this.db.selectFrom('region').selectAll().where('id', 'in', ids).execute();
  }

  /** Own located camera photos whose regions have not been found with the current region files yet. */
  @GenerateSql({ params: [DummyValue.UUID, DummyValue.STRING] })
  async countPending(userId: string, version: string) {
    const { count } = await this.db
      .selectFrom('asset')
      .innerJoin('asset_exif', 'asset_exif.assetId', 'asset.id')
      .leftJoin('asset_region', 'asset_region.assetId', 'asset.id')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('asset.ownerId', '=', asUuid(userId))
      .where('asset.deletedAt', 'is', null)
      .where('asset.visibility', 'in', [AssetVisibility.Timeline, AssetVisibility.Archive])
      .where('asset_exif.make', 'is not', null)
      .where('asset_exif.make', '!=', '')
      .where('asset_exif.latitude', 'is not', null)
      .where('asset_exif.longitude', 'is not', null)
      .where((eb) =>
        eb.or([
          eb('asset_region.assetId', 'is', null),
          eb('asset_region.version', '!=', version),
          eb('asset_region.latitude', '!=', eb.ref('asset_exif.latitude')),
          eb('asset_region.longitude', '!=', eb.ref('asset_exif.longitude')),
        ]),
      )
      .executeTakeFirstOrThrow();
    return Number(count);
  }
}
