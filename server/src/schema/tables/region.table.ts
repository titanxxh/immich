import { Column, PrimaryColumn, Table } from '@immich/sql-tools';

/**
 * The areas of the footprint map, imported from the footprint region files on startup. Rows are
 * replaced whenever the files change, so nothing references them with a foreign key.
 */
@Table('region')
export class RegionTable {
  /** Overture division id (GERS ID), stable across releases; `<province id>:direct` for land a province administers directly */
  @PrimaryColumn({ type: 'character varying' })
  id!: string;

  /** country, province or region; a municipality such as Shanghai is a province that is also its only region */
  @Column({ type: 'character varying' })
  level!: string;

  @Column({ type: 'character varying' })
  countryId!: string;

  @Column({ type: 'character varying', nullable: true })
  provinceId!: string | null;

  /** ISO 3166-1 alpha-2; Hong Kong, Macau and Taiwan are CN */
  @Column({ type: 'character varying' })
  countryCode!: string;

  /** the local name */
  @Column({ type: 'character varying' })
  name!: string;

  @Column({ type: 'character varying', nullable: true })
  nameZh!: string | null;

  @Column({ type: 'double precision' })
  latitude!: number;

  @Column({ type: 'double precision' })
  longitude!: number;
}
