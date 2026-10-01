import {
  Column,
  CreateDateColumn,
  ForeignKeyColumn,
  Generated,
  PrimaryGeneratedColumn,
  Table,
  Timestamp,
  UpdateDateColumn,
} from '@immich/sql-tools';
import { UpdatedAtTrigger, UpdateIdColumn } from 'src/decorators';
import { UserTable } from 'src/schema/tables/user.table';

/** One reorganization: what the user asked for and how far it got. Kept until the user deletes it. */
@Table('reorganization')
@UpdatedAtTrigger('reorganization_updatedAt')
export class ReorganizationTable {
  @PrimaryGeneratedColumn()
  id!: Generated<string>;

  @ForeignKeyColumn(() => UserTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', nullable: false })
  ownerId!: string;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;

  @UpdateDateColumn()
  updatedAt!: Generated<Timestamp>;

  /** set by the updated-at trigger */
  @UpdateIdColumn()
  updateId!: Generated<string>;

  @Column({ type: 'character varying' })
  sourceType!: string;

  /** the folder of a folder source */
  @Column({ type: 'text', nullable: true })
  sourcePath!: string | null;

  /** the album of an album source; not a foreign key, the record outlives the album */
  @Column({ type: 'uuid', nullable: true })
  sourceAlbumId!: string | null;

  /** the source as shown to the user: the folder, or the album name at the time */
  @Column({ type: 'text' })
  sourceName!: string;

  @Column({ type: 'text' })
  targetPath!: string;

  @Column({ type: 'character varying' })
  preset!: string;

  @Column({ type: 'boolean', default: false })
  autoRename!: Generated<boolean>;

  @Column({ type: 'character varying' })
  status!: string;

  /** whether the record is being, or was last, undone rather than carried out */
  @Column({ type: 'boolean', default: false })
  isUndo!: Generated<boolean>;

  @Column({ type: 'boolean', default: false })
  cancelRequested!: Generated<boolean>;

  /** photos that were already in their folder, which have no item */
  @Column({ type: 'integer', default: 0 })
  inPlaceCount!: Generated<number>;

  /** folders created for the photos, removed again when an undo leaves them empty */
  @Column({ type: 'text', array: true, default: '{}' })
  createdFolders!: Generated<string[]>;

  /** source subfolders removed because the reorganization emptied them */
  @Column({ type: 'text', array: true, default: '{}' })
  removedFolders!: Generated<string[]>;

  /** why the whole run stopped, as opposed to the error of one photo */
  @Column({ type: 'text', nullable: true })
  error!: string | null;

  @Column({ type: 'timestamp with time zone', nullable: true })
  finishedAt!: Timestamp | null;
}
