import { Injectable } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { DummyValue, GenerateSql } from 'src/decorators';
import { AssetFileType } from 'src/enum';
import { DB } from 'src/schema';
import { asUuid } from 'src/utils/database';

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
