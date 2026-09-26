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
import { AlbumTable } from 'src/schema/tables/album.table';
import { UserTable } from 'src/schema/tables/user.table';

@Table('trip')
@UpdatedAtTrigger('trip_updatedAt')
export class TripTable {
  @PrimaryGeneratedColumn()
  id!: Generated<string>;

  @ForeignKeyColumn(() => UserTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', nullable: false })
  ownerId!: string;

  /** null once the user deletes the album: the trip is then dismissed and never recreated */
  @ForeignKeyColumn(() => AlbumTable, { onDelete: 'SET NULL', onUpdate: 'CASCADE', nullable: true })
  albumId!: string | null;

  /** local time of the first photo, same convention as asset.localDateTime */
  @Column({ type: 'timestamp with time zone' })
  startAt!: Timestamp;

  /** local time of the last photo, same convention as asset.localDateTime */
  @Column({ type: 'timestamp with time zone' })
  endAt!: Timestamp;

  /** the album name last written by trip detection; a different album name means the user renamed it */
  @Column({ type: 'character varying' })
  generatedName!: string;

  /** photos uploaded after this are added to the album; earlier ones the user removed stay removed */
  @Column({ type: 'timestamp with time zone' })
  lastSyncedAt!: Timestamp;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;

  @UpdateDateColumn()
  updatedAt!: Generated<Timestamp>;

  @UpdateIdColumn({ index: true })
  updateId!: Generated<string>;
}
