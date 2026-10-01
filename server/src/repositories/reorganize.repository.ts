import { Injectable } from '@nestjs/common';
import { Insertable, Kysely, sql, Updateable } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { DummyValue, GenerateSql } from 'src/decorators';
import { AssetFileType } from 'src/enum';
import { DB } from 'src/schema';
import { ReorganizationItemTable } from 'src/schema/tables/reorganization-item.table';
import { ReorganizationTable } from 'src/schema/tables/reorganization.table';
import { asUuid } from 'src/utils/database';
import { ReorganizationItemStatus, ReorganizationStatus } from 'src/utils/reorganize';

/** One file of a photo changing place in the database. */
export interface ReorganizeAssetMove {
  assetId: string;
  fromPath: string;
  toPath: string;
  checksum: Buffer;
  /** set when the file name changes */
  fileName?: string;
  libraryId: string;
}

export interface ReorganizeMove {
  original: ReorganizeAssetMove;
  sidecar?: { fromPath: string; toPath: string };
  /** the separate video file of a live photo */
  video?: ReorganizeAssetMove;
}

const ACTIVE: ReorganizationStatus[] = ['queued', 'running'];

@Injectable()
export class ReorganizeRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  /** Every photo under a folder, whoever owns it and whatever its state, so that the ones left out can be explained. */
  @GenerateSql({ params: [DummyValue.STRING] })
  getFolderAssets(folder: string) {
    return this.assets()
      .where(sql<boolean>`starts_with(asset."originalPath", ${folder.replace(/\/+$/, '') + '/'})`)
      .orderBy('asset.originalPath')
      .execute();
  }

  /** Every photo of an album, whoever owns it and whatever its state. */
  @GenerateSql({ params: [DummyValue.UUID] })
  getAlbumAssets(albumId: string) {
    return this.assets()
      .innerJoin('album_asset', 'album_asset.assetId', 'asset.id')
      .where('album_asset.albumId', '=', asUuid(albumId))
      .orderBy('asset.originalPath')
      .execute();
  }

  /** Stores a reorganization with its photos, in the order of the plan. */
  async create(
    record: Insertable<ReorganizationTable>,
    items: Array<Omit<Insertable<ReorganizationItemTable>, 'reorganizationId' | 'position'>>,
  ) {
    return this.db.transaction().execute(async (tx) => {
      const created = await tx.insertInto('reorganization').values(record).returningAll().executeTakeFirstOrThrow();
      for (let offset = 0; offset < items.length; offset += 1000) {
        await tx
          .insertInto('reorganization_item')
          .values(
            items
              .slice(offset, offset + 1000)
              .map((item, index) => ({ ...item, reorganizationId: created.id, position: offset + index })),
          )
          .execute();
      }
      return created;
    });
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  get(id: string) {
    return this.db.selectFrom('reorganization').selectAll().where('id', '=', asUuid(id)).executeTakeFirst();
  }

  /** The reorganizations of a user, newest first. */
  @GenerateSql({ params: [DummyValue.UUID] })
  getAll(ownerId: string) {
    return this.db
      .selectFrom('reorganization')
      .selectAll()
      .where('ownerId', '=', asUuid(ownerId))
      .orderBy('createdAt', 'desc')
      .execute();
  }

  /** The album the latest reorganization of a user into a target added its photos to. */
  @GenerateSql({ params: [DummyValue.UUID, DummyValue.STRING] })
  async getLastAlbumId(ownerId: string, targetPath: string) {
    const row = await this.db
      .selectFrom('reorganization')
      .select('albumId')
      .where('ownerId', '=', asUuid(ownerId))
      .where('targetPath', '=', targetPath)
      .where('albumId', 'is not', null)
      .orderBy('createdAt', 'desc')
      .limit(1)
      .executeTakeFirst();
    return row?.albumId ?? undefined;
  }

  /** The reorganization that is running or about to, of any user: only one runs at a time. */
  @GenerateSql()
  getActive() {
    return this.db.selectFrom('reorganization').selectAll().where('status', 'in', ACTIVE).executeTakeFirst();
  }

  /** How many photos of each reorganization are in each state. */
  @GenerateSql({ params: [[DummyValue.UUID]] })
  getItemCounts(ids: string[]) {
    if (ids.length === 0) {
      return Promise.resolve([]);
    }

    return this.db
      .selectFrom('reorganization_item')
      .select(['reorganizationId', 'status', 'reason'])
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('reorganizationId', 'in', ids)
      .groupBy(['reorganizationId', 'status', 'reason'])
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID, { statuses: ['moved'], limit: 100 }] })
  getItems(
    id: string,
    options: { statuses?: ReorganizationItemStatus[]; reason?: string; limit: number; reverse?: boolean },
  ) {
    return this.db
      .selectFrom('reorganization_item')
      .selectAll()
      .where('reorganizationId', '=', asUuid(id))
      .$if(!!options.statuses, (qb) => qb.where('status', 'in', options.statuses!))
      .$if(!!options.reason, (qb) => qb.where('reason', '=', options.reason!))
      .orderBy('position', options.reverse ? 'desc' : 'asc')
      .limit(options.limit)
      .execute();
  }

  async update(id: string, values: Updateable<ReorganizationTable>) {
    await this.db.updateTable('reorganization').set(values).where('id', '=', asUuid(id)).execute();
  }

  /** Moves a reorganization from one state to another, unless something else got there first. */
  @GenerateSql({ params: [DummyValue.UUID, 'queued', 'running'] })
  async transition(id: string, from: ReorganizationStatus, to: ReorganizationStatus) {
    const row = await this.db
      .updateTable('reorganization')
      .set({ status: to })
      .where('id', '=', asUuid(id))
      .where('status', '=', from)
      .returningAll()
      .executeTakeFirst();
    return row;
  }

  /** Adds folders to one of the folder lists of a reorganization. */
  async addFolders(id: string, column: 'createdFolders' | 'removedFolders', folders: string[]) {
    if (folders.length === 0) {
      return;
    }

    await this.db
      .updateTable('reorganization')
      .set({ [column]: sql`${sql.ref(column)} || ${folders}::text[]` })
      .where('id', '=', asUuid(id))
      .execute();
  }

  async updateItem(id: string, values: Updateable<ReorganizationItemTable>) {
    await this.db.updateTable('reorganization_item').set(values).where('id', '=', asUuid(id)).execute();
  }

  /** Puts the photos in some states of a reorganization into another state. */
  @GenerateSql({ params: [DummyValue.UUID, ['failed'], 'pending'] })
  async updateItemStatuses(id: string, from: ReorganizationItemStatus[], to: ReorganizationItemStatus) {
    await this.db
      .updateTable('reorganization_item')
      .set({ status: to, error: null })
      .where('reorganizationId', '=', asUuid(id))
      .where('status', 'in', from)
      .execute();
  }

  async delete(id: string) {
    await this.db.deleteFrom('reorganization').where('id', '=', asUuid(id)).execute();
  }

  /** Marks the reorganizations that were running as cut short, and returns them. */
  @GenerateSql()
  interruptRunning() {
    return this.db
      .updateTable('reorganization')
      .set({ status: 'interrupted' satisfies ReorganizationStatus, cancelRequested: false })
      .where('status', '=', 'running' satisfies ReorganizationStatus)
      .returningAll()
      .execute();
  }

  /**
   * Gives the photos that stayed for a reason found while running (their place was taken, their file was missing)
   * another go. Photos the plan itself left out have no destination and are not touched.
   */
  @GenerateSql({ params: [DummyValue.UUID, 'stayed', 'pending'] })
  async retryStayed(id: string, from: ReorganizationItemStatus, to: ReorganizationItemStatus) {
    await this.db
      .updateTable('reorganization_item')
      .set({ status: to, reason: null, error: null })
      .where('reorganizationId', '=', asUuid(id))
      .where('status', '=', from)
      .where('toPath', 'is not', null)
      .where('assetId', 'is not', null)
      .execute();
  }

  /** Whether a path is the file or the sidecar of an asset other than the given one. */
  @GenerateSql({ params: [DummyValue.STRING, DummyValue.UUID] })
  async isUsedByAnother(path: string, assetId: string) {
    const asset = await this.db
      .selectFrom('asset')
      .select('id')
      .where('originalPath', '=', path)
      .where('id', '!=', asUuid(assetId))
      .limit(1)
      .executeTakeFirst();
    if (asset) {
      return true;
    }
    const file = await this.db
      .selectFrom('asset_file')
      .select('id')
      .where('path', '=', path)
      .where('assetId', '!=', asUuid(assetId))
      .limit(1)
      .executeTakeFirst();
    return !!file;
  }

  /** Where a photo is right now, to check it against what a reorganization expects. */
  @GenerateSql({ params: [DummyValue.UUID] })
  getAssetState(assetId: string) {
    return this.db
      .selectFrom('asset')
      .leftJoin('asset as video', 'video.id', 'asset.livePhotoVideoId')
      .select([
        'asset.id',
        'asset.originalPath',
        'asset.libraryId',
        'asset.isOffline',
        'asset.deletedAt',
        'asset.livePhotoVideoId',
        'video.isExternal as videoIsExternal',
      ])
      .select((eb) =>
        eb
          .selectFrom('asset_file')
          .select('asset_file.path')
          .whereRef('asset_file.assetId', '=', 'asset.id')
          .where('asset_file.type', '=', AssetFileType.Sidecar)
          .limit(1)
          .as('sidecarPath'),
      )
      .where('asset.id', '=', asUuid(assetId))
      .executeTakeFirst();
  }

  /**
   * Points a photo, its sidecar and the video of a live photo at their new places, all or nothing. The checksum of
   * an external asset is a hash of its path, so it changes with the path.
   */
  async applyMove(move: ReorganizeMove, embeddedVideoId?: string) {
    await this.db.transaction().execute(async (tx) => {
      for (const asset of [move.original, move.video]) {
        if (!asset) {
          continue;
        }
        await tx
          .updateTable('asset')
          .set({
            originalPath: asset.toPath,
            checksum: asset.checksum,
            libraryId: asset.libraryId,
            ...(asset.fileName && { originalFileName: asset.fileName }),
          })
          .where('id', '=', asUuid(asset.assetId))
          .where('originalPath', '=', asset.fromPath)
          .executeTakeFirstOrThrow()
          .then((result) => {
            if (result.numUpdatedRows !== 1n) {
              throw new Error(`Asset ${asset.assetId} is no longer at ${asset.fromPath}`);
            }
          });
      }

      if (move.sidecar) {
        await tx
          .updateTable('asset_file')
          .set({ path: move.sidecar.toPath })
          .where('assetId', '=', asUuid(move.original.assetId))
          .where('type', '=', AssetFileType.Sidecar)
          .where('path', '=', move.sidecar.fromPath)
          .execute();
      }

      // a video extracted from the photo's own file has nothing to move, but belongs to the library of its photo
      if (embeddedVideoId) {
        await tx
          .updateTable('asset')
          .set({ libraryId: move.original.libraryId })
          .where('id', '=', asUuid(embeddedVideoId))
          .execute();
      }
    });
  }

  private assets() {
    return (
      this.db
        .selectFrom('asset')
        .leftJoin('library', 'library.id', 'asset.libraryId')
        .leftJoin('asset_job_status', 'asset_job_status.assetId', 'asset.id')
        .leftJoin('asset as video', 'video.id', 'asset.livePhotoVideoId')
        .select([
          'asset.id',
          'asset.ownerId',
          'asset.libraryId',
          'library.ownerId as libraryOwnerId',
          'asset.originalPath',
          'asset.localDateTime',
          'asset.isOffline',
          'asset.deletedAt',
          'asset_job_status.dateFromExif',
          'video.id as videoId',
          'video.originalPath as videoPath',
          'video.isExternal as videoIsExternal',
        ])
        .select((eb) =>
          eb
            .selectFrom('asset_file')
            .select('asset_file.path')
            .whereRef('asset_file.assetId', '=', 'asset.id')
            .where('asset_file.type', '=', AssetFileType.Sidecar)
            .limit(1)
            .as('sidecarPath'),
        )
        // the video of a live photo follows its photo instead of being planned on its own
        .where((eb) =>
          eb.not(
            eb.exists(
              eb.selectFrom('asset as photo').select('photo.id').whereRef('photo.livePhotoVideoId', '=', 'asset.id'),
            ),
          ),
        )
    );
  }
}
