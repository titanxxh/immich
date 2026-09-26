import { Injectable } from '@nestjs/common';
import { Insertable, Kysely, sql, Updateable } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { reverseGeocodeMaxDistance } from 'src/constants';
import { DummyValue, GenerateSql } from 'src/decorators';
import { AssetVisibility } from 'src/enum';
import { DB } from 'src/schema';
import { TripTable } from 'src/schema/tables/trip.table';

export type TripPoint = { latitude: number; longitude: number };
export type TripPointPlace = {
  name: string;
  alternateNames: string | null;
  countryCode: string;
  admin1Name: string | null;
  admin2Name: string | null;
};

@Injectable()
export class TripRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  @GenerateSql({ params: [DummyValue.UUID] })
  getByOwnerId(ownerId: string) {
    return this.db
      .selectFrom('trip')
      .leftJoin('album', 'album.id', 'trip.albumId')
      .selectAll('trip')
      .select(['album.albumName', 'album.albumThumbnailAssetId'])
      .where('trip.ownerId', '=', ownerId)
      .orderBy('trip.startAt')
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getById(id: string) {
    return this.db
      .selectFrom('trip')
      .leftJoin('album', 'album.id', 'trip.albumId')
      .selectAll('trip')
      .select(['album.albumName', 'album.albumThumbnailAssetId'])
      .where('trip.id', '=', id)
      .executeTakeFirst();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getByAlbumId(albumId: string) {
    return this.db.selectFrom('trip').selectAll().where('albumId', '=', albumId).executeTakeFirst();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  async delete(id: string) {
    await this.db.deleteFrom('trip').where('id', '=', id).execute();
  }

  /** The photos of an album, as trip detection sees them, oldest first. */
  @GenerateSql({ params: [DummyValue.UUID] })
  getAlbumAssets(albumId: string) {
    return this.db
      .selectFrom('album_asset')
      .innerJoin('asset', 'asset.id', 'album_asset.assetId')
      .leftJoin('asset_exif', 'asset_exif.assetId', 'asset.id')
      .select([
        'asset.id',
        'asset.localDateTime',
        'asset.createdAt',
        'asset.originalFileName',
        'asset_exif.latitude',
        'asset_exif.longitude',
        'asset_exif.make',
      ])
      .where('album_asset.albumId', '=', albumId)
      .where('asset.deletedAt', 'is', null)
      .where('asset.visibility', 'in', [AssetVisibility.Timeline, AssetVisibility.Archive])
      .orderBy('asset.localDateTime')
      .orderBy('asset.id')
      .execute();
  }

  @GenerateSql({ params: [{ ownerId: DummyValue.UUID }] })
  create(trip: Insertable<TripTable>) {
    return this.db.insertInto('trip').values(trip).returningAll().executeTakeFirstOrThrow();
  }

  @GenerateSql({ params: [DummyValue.UUID, { generatedName: DummyValue.STRING }] })
  async update(id: string, trip: Updateable<TripTable>) {
    await this.db.updateTable('trip').set(trip).where('id', '=', id).execute();
  }

  /** Every photo of the user that trip detection looks at, oldest first. */
  @GenerateSql({ params: [DummyValue.UUID] })
  getAssets(ownerId: string) {
    return this.db
      .selectFrom('asset')
      .innerJoin('asset_exif', 'asset_exif.assetId', 'asset.id')
      .select([
        'asset.id',
        'asset.localDateTime',
        'asset.createdAt',
        'asset.originalFileName',
        'asset_exif.latitude',
        'asset_exif.longitude',
        'asset_exif.make',
      ])
      .where('asset.ownerId', '=', ownerId)
      .where('asset.deletedAt', 'is', null)
      .where('asset.visibility', 'in', [AssetVisibility.Timeline, AssetVisibility.Archive])
      .orderBy('asset.localDateTime')
      .orderBy('asset.id')
      .execute();
  }

  /** The country and prefecture of the populated place nearest to each point, in the same order as the points. */
  @GenerateSql({ params: [[{ latitude: 30, longitude: 120 }]] })
  async getPlaces(points: TripPoint[]): Promise<Array<TripPointPlace | undefined>> {
    if (points.length === 0) {
      return [];
    }

    const { rows } = await sql<{
      index: string;
      name: string;
      alternateNames: string | null;
      countryCode: string;
      admin1Name: string | null;
      admin2Name: string | null;
    }>`
      select point.index, place.name, place."alternateNames", place."countryCode", place."admin1Name", place."admin2Name"
      from unnest(
        ${points.map(({ latitude }) => latitude)}::double precision[],
        ${points.map(({ longitude }) => longitude)}::double precision[]
      ) with ordinality as point(latitude, longitude, index)
      cross join lateral (
        select name, "alternateNames", "countryCode", "admin1Name", "admin2Name"
        from geodata_places
        where earth_box(ll_to_earth_public(point.latitude, point.longitude), ${reverseGeocodeMaxDistance})
          @> ll_to_earth_public(geodata_places.latitude, geodata_places.longitude)
        order by earth_distance(
          ll_to_earth_public(point.latitude, point.longitude),
          ll_to_earth_public(geodata_places.latitude, geodata_places.longitude)
        )
        limit 1
      ) as place
    `.execute(this.db);

    const places: Array<TripPointPlace | undefined> = Array.from({ length: points.length });
    for (const row of rows) {
      places[Number(row.index) - 1] = {
        name: row.name,
        alternateNames: row.alternateNames,
        countryCode: row.countryCode,
        admin1Name: row.admin1Name,
        admin2Name: row.admin2Name,
      };
    }
    return places;
  }

  /**
   * The GeoNames alternate names of the most prominent place carrying each name in its province, which for a city
   * name is the city itself rather than a village of the same name. Keyed by `name|admin1Name`.
   */
  @GenerateSql({ params: [[{ name: DummyValue.STRING, admin1Name: DummyValue.STRING }]] })
  async getAlternateNames(places: Array<{ name: string; admin1Name: string }>) {
    if (places.length === 0) {
      return new Map<string, string | null>();
    }

    const rows = await this.db
      .selectFrom('geodata_places')
      .select(['name', 'admin1Name', 'alternateNames'])
      .distinctOn(['name', 'admin1Name'])
      .where((eb) =>
        eb.or(places.map(({ name, admin1Name }) => eb.and([eb('name', '=', name), eb('admin1Name', '=', admin1Name)]))),
      )
      .orderBy('name')
      .orderBy('admin1Name')
      .orderBy(sql`length("alternateNames")`, (ob) => ob.desc().nullsLast())
      .execute();

    return new Map(rows.map((row) => [`${row.name}|${row.admin1Name}`, row.alternateNames]));
  }
}
