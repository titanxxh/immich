import { Column, ForeignKeyColumn, Index, Table } from '@immich/sql-tools';
import { AssetTable } from 'src/schema/tables/asset.table';

/** Embeddings of the Gemma model, kept next to the CLIP ones of `smart_search` so that searches can use either. */
@Table({ name: 'smart_search_gemma' })
@Index({
  name: 'gemma_index',
  using: 'hnsw',
  expression: `embedding vector_cosine_ops`,
  with: `ef_construction = 300, m = 16`,
  synchronize: false,
})
export class SmartSearchGemmaTable {
  @ForeignKeyColumn(() => AssetTable, { onDelete: 'CASCADE', primary: true })
  assetId!: string;

  @Column({ type: 'vector', length: 768, storage: 'external', synchronize: false })
  embedding!: string;
}
