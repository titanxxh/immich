import { Column, ForeignKeyColumn, Table } from '@immich/sql-tools';
import { AssetTable } from 'src/schema/tables/asset.table';

/** The country, province and region a located photo was taken in. */
@Table('asset_region')
export class AssetRegionTable {
  @ForeignKeyColumn(() => AssetTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', primary: true })
  assetId!: string;

  /** null when the photo is out at sea, far from every country */
  @Column({ type: 'character varying', nullable: true, index: true })
  countryId!: string | null;

  @Column({ type: 'character varying', nullable: true, index: true })
  provinceId!: string | null;

  /** null when no region lies within reach of the photo */
  @Column({ type: 'character varying', nullable: true, index: true })
  regionId!: string | null;

  /** the location the regions were found for; the photo is assigned again once its location changes */
  @Column({ type: 'double precision' })
  latitude!: number;

  @Column({ type: 'double precision' })
  longitude!: number;

  /** version of the region files the regions were found with */
  @Column({ type: 'character varying' })
  version!: string;
}
