import { Column, ForeignKeyColumn, Generated, PrimaryGeneratedColumn, Table } from '@immich/sql-tools';
import { AssetTable } from 'src/schema/tables/asset.table';
import { ReorganizationTable } from 'src/schema/tables/reorganization.table';

/** One photo of a reorganization: where it was, where it went (or why it stayed) and how far that got. */
@Table('reorganization_item')
export class ReorganizationItemTable {
  @PrimaryGeneratedColumn()
  id!: Generated<string>;

  @ForeignKeyColumn(() => ReorganizationTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', nullable: false })
  reorganizationId!: string;

  /** null once the photo is deleted; the paths stay as a record */
  @ForeignKeyColumn(() => AssetTable, { onDelete: 'SET NULL', onUpdate: 'CASCADE', nullable: true })
  assetId!: string | null;

  /** order of the plan, so that a run and its undo go through the photos predictably */
  @Column({ type: 'integer' })
  position!: number;

  @Column({ type: 'character varying' })
  status!: string;

  /** why the photo stayed, or why it was renamed */
  @Column({ type: 'character varying', nullable: true })
  reason!: string | null;

  @Column({ type: 'text', nullable: true })
  error!: string | null;

  /** whether the reorganization put the photo in its album, so that an undo only takes out what it put in */
  @Column({ type: 'boolean', default: false })
  addedToAlbum!: Generated<boolean>;

  @Column({ type: 'text' })
  fromPath!: string;

  /** null for a photo that stays */
  @Column({ type: 'text', nullable: true })
  toPath!: string | null;

  @Column({ type: 'uuid', nullable: true })
  fromLibraryId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  toLibraryId!: string | null;

  @Column({ type: 'text', nullable: true })
  sidecarFromPath!: string | null;

  @Column({ type: 'text', nullable: true })
  sidecarToPath!: string | null;

  /** the video of a live photo, a separate asset that follows the photo; not a foreign key, see assetId */
  @Column({ type: 'uuid', nullable: true })
  videoAssetId!: string | null;

  @Column({ type: 'text', nullable: true })
  videoFromPath!: string | null;

  @Column({ type: 'text', nullable: true })
  videoToPath!: string | null;
}
