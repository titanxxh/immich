import { Column, ForeignKeyColumn, Table, Timestamp } from '@immich/sql-tools';
import { AssetTable } from 'src/schema/tables/asset.table';

@Table('asset_job_status')
export class AssetJobStatusTable {
  @ForeignKeyColumn(() => AssetTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', primary: true })
  assetId!: string;

  @Column({ type: 'timestamp with time zone', nullable: true })
  facesRecognizedAt!: Timestamp | null;

  @Column({ type: 'timestamp with time zone', nullable: true })
  metadataExtractedAt!: Timestamp | null;

  @Column({ type: 'timestamp with time zone', nullable: true })
  duplicatesDetectedAt!: Timestamp | null;

  @Column({ type: 'timestamp with time zone', nullable: true })
  ocrAt!: Timestamp | null;

  @Column({ type: 'double precision', nullable: true })
  sharpness!: number | null;

  @Column({ type: 'smallint', nullable: true })
  sharpnessVersion!: number | null;

  /** Whether the capture date comes from the file's metadata (true) or fell back on the file times (false). */
  @Column({ type: 'boolean', nullable: true })
  dateFromExif!: boolean | null;
}
