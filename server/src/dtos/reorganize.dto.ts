import { createZodDto } from 'nestjs-zod';
import { isoDatetimeToDate } from 'src/validation';
import z from 'zod';

const ReorganizePresetSchema = z
  .enum(['year-month', 'day', 'year-day'])
  .describe('Folder structure: `2026/09`, `2026-09-27` or `2026/2026-09-27`')
  .meta({ id: 'ReorganizePreset' });

const ReorganizeSourceTypeSchema = z
  .enum(['folder', 'album'])
  .describe('What is reorganized: a folder of an external library, or an album')
  .meta({ id: 'ReorganizeSourceType' });

const ReorganizeActionSchema = z
  .enum(['move', 'in-place', 'conflict', 'skip'])
  .describe('What happens to a photo')
  .meta({ id: 'ReorganizeAction' });

const ReorganizeReasonSchema = z
  .enum([
    'internal',
    'not-owner',
    'offline',
    'trashed',
    'unreliable-date',
    'library-excluded',
    'other-owner-library',
    'identical',
    'shared-sidecar',
    'target-exists',
    'same-target',
  ])
  .describe('Why a photo stays where it is, or why it was renamed')
  .meta({ id: 'ReorganizeReason' });

const ReorganizeSchema = z
  .object({
    sourceType: ReorganizeSourceTypeSchema,
    sourcePath: z.string().min(1).optional().describe('Folder to reorganize, for a folder source'),
    includeSubfolders: z.boolean().default(true).describe('Whether a folder source includes its subfolders'),
    sourceAlbumId: z.uuidv4().optional().describe('Album to reorganize, for an album source'),
    targetPath: z.string().min(1).describe('Folder the date folders are created in'),
    preset: ReorganizePresetSchema,
    labels: z
      .record(z.string(), z.string())
      .default({})
      .describe('Label per day (YYYY-MM-DD) for the day presets; a day left out joins its existing folder'),
    autoRename: z.boolean().default(false).describe('Move photos whose name is taken under a new name'),
    excludedLibraryIds: z.array(z.uuidv4()).default([]).describe('Source libraries to leave out, for an album'),
    albumId: z.uuidv4().optional().describe('Album to add the photos that move to'),
  })
  .meta({ id: 'ReorganizeDto' });

const ReorganizeItemsSchema = ReorganizeSchema.extend({
  folder: z
    .string()
    .optional()
    .describe('Only photos going to (or already in) this date folder, relative to the target'),
  action: ReorganizeActionSchema.optional(),
  reason: ReorganizeReasonSchema.optional(),
  limit: z.int().min(1).max(1000).default(200).describe('Number of photos to return'),
}).meta({ id: 'ReorganizeItemsDto' });

const ReorganizeFolderSchema = z
  .object({
    day: z.string().nullable().describe('Day of the folder (YYYY-MM-DD), null for a month folder'),
    folder: z.string().describe('Folder, relative to the target'),
    label: z.string().describe('Label in the folder name'),
    existingLabels: z.array(z.string()).describe('Labels of the folders of this day that already exist'),
    exists: z.boolean().describe('Whether the folder already exists'),
    moveCount: z.int().describe('Photos moving into the folder'),
    renameCount: z.int().describe('Photos among them that get a new name'),
    inPlaceCount: z.int().describe('Photos already in the folder'),
  })
  .meta({ id: 'ReorganizeFolderDto' });

const ReorganizeStayingSchema = z
  .object({
    action: ReorganizeActionSchema,
    reason: ReorganizeReasonSchema,
    count: z.int(),
  })
  .meta({ id: 'ReorganizeStayingDto' });

const ReorganizeLibrarySchema = z
  .object({
    id: z.string().describe('Library ID'),
    name: z.string().describe('Library name'),
    count: z.int().describe('Photos of the source in this library'),
    isTarget: z.boolean().describe('Whether the target folder is in this library'),
    isExcluded: z.boolean().describe('Whether its photos are left out'),
  })
  .meta({ id: 'ReorganizeLibraryDto' });

const ReorganizeAlbumSchema = z
  .object({
    id: z.string().describe('Album ID'),
    albumName: z.string().describe('Album name'),
  })
  .meta({ id: 'ReorganizeAlbumDto' });

const ReorganizePreviewResponseSchema = z
  .object({
    targetLibraryId: z.string().describe('Library the target folder belongs to'),
    total: z.int().describe('Photos of the source'),
    moveCount: z.int().describe('Photos that move'),
    renameCount: z.int().describe('Photos among them that get a new name'),
    inPlaceCount: z.int().describe('Photos already in their folder'),
    conflictCount: z.int().describe('Photos that stay because their name is taken'),
    skipCount: z.int().describe('Photos that are left out'),
    sidecarCount: z.int().describe('Sidecar files that move along'),
    newFolderCount: z.int().describe('Date folders to create'),
    otherFileCount: z.int().describe('Files of a source folder that are not photos of the library and stay'),
    emptyFolderCount: z.int().describe('Subfolders of a source folder that end up empty and are removed'),
    folders: z.array(ReorganizeFolderSchema).describe('Date folders after the reorganization, oldest first'),
    staying: z.array(ReorganizeStayingSchema).describe('Photos that stay, by reason'),
    libraries: z.array(ReorganizeLibrarySchema).describe('Libraries the photos of the source are in'),
    suggestedAlbum: ReorganizeAlbumSchema.nullable().describe(
      'The album the last reorganization into this target added its photos to',
    ),
  })
  .meta({ id: 'ReorganizePreviewResponseDto' });

const ReorganizeItemSchema = z
  .object({
    assetId: z.string().describe('Photo ID'),
    action: ReorganizeActionSchema,
    reason: ReorganizeReasonSchema.nullable(),
    fromPath: z.string().describe('Where the photo is'),
    toPath: z.string().nullable().describe('Where it goes, null when it stays'),
    isRenamed: z.boolean().describe('Whether it gets a new name'),
    hasSidecar: z.boolean().describe('Whether a sidecar moves along'),
  })
  .meta({ id: 'ReorganizeItemDto' });

const ReorganizeItemsResponseSchema = z
  .object({
    total: z.int().describe('Number of matching photos'),
    items: z.array(ReorganizeItemSchema),
  })
  .meta({ id: 'ReorganizeItemsResponseDto' });

const ReorganizeFolderQuerySchema = z
  .object({
    path: z.string().optional().describe('Folder to list; left out, the import paths of the libraries are listed'),
  })
  .meta({ id: 'ReorganizeFolderQueryDto' });

const ReorganizeFoldersResponseSchema = z
  .object({
    path: z.string().nullable().describe('The listed folder, null for the list of import paths'),
    parent: z.string().nullable().describe('Its parent, when that can be listed too'),
    libraryId: z.string().nullable().describe('Library the folder is in'),
    folders: z.array(z.string()).describe('Full paths of the folders inside'),
  })
  .meta({ id: 'ReorganizeFoldersResponseDto' });

const ReorganizationStatusSchema = z
  .enum(['queued', 'running', 'completed', 'cancelled', 'interrupted', 'paused'])
  .describe(
    'How far a reorganization got: interrupted by a restart and paused by the storage going away both wait for the user',
  )
  .meta({ id: 'ReorganizationStatus' });

const ReorganizationItemStatusSchema = z
  .enum(['pending', 'moving', 'moved', 'failed', 'stayed', 'undoing', 'undone', 'undo-failed', 'undo-skipped'])
  .describe('How far one photo of a reorganization got')
  .meta({ id: 'ReorganizationItemStatus' });

const ReorganizationSchema = z
  .object({
    id: z.string().describe('Reorganization ID'),
    createdAt: isoDatetimeToDate.describe('When it was started'),
    finishedAt: isoDatetimeToDate.nullable().describe('When it last stopped running'),
    sourceType: ReorganizeSourceTypeSchema,
    sourceName: z.string().describe('The source folder, or the name of the source album'),
    targetPath: z.string().describe('Folder the date folders were created in'),
    preset: ReorganizePresetSchema,
    autoRename: z.boolean().describe('Whether photos whose name was taken moved under a new name'),
    album: ReorganizeAlbumSchema.nullable().describe('Album the moved photos are added to, if it still exists'),
    status: ReorganizationStatusSchema,
    isUndo: z.boolean().describe('Whether the status is about undoing it rather than carrying it out'),
    error: z.string().nullable().describe('Why the whole run stopped'),
    pendingCount: z.int().describe('Photos not moved yet'),
    movedCount: z.int().describe('Photos in their date folder'),
    failedCount: z.int().describe('Photos that could not be moved, or moved back'),
    stayedCount: z.int().describe('Photos that were left where they were'),
    undoneCount: z.int().describe('Photos moved back by an undo'),
    undoSkippedCount: z.int().describe('Photos an undo left in place because they or their old place had changed'),
    inPlaceCount: z.int().describe('Photos that were already in their folder'),
    removedFolderCount: z.int().describe('Source subfolders removed because they ended up empty'),
  })
  .meta({ id: 'ReorganizationResponseDto' });

const ReorganizationItemSchema = z
  .object({
    id: z.string().describe('Item ID'),
    assetId: z.string().nullable().describe('Photo ID, null once the photo is deleted'),
    status: ReorganizationItemStatusSchema,
    reason: z.string().nullable().describe('Why the photo stayed, or why it was renamed'),
    error: z.string().nullable().describe('What went wrong'),
    fromPath: z.string().describe('Where the photo was'),
    toPath: z.string().nullable().describe('Where it went, null for a photo that stayed'),
    hasSidecar: z.boolean().describe('Whether a sidecar moved along'),
  })
  .meta({ id: 'ReorganizationItemDto' });

const ReorganizationItemsQuerySchema = z
  .object({
    status: ReorganizationItemStatusSchema.optional(),
    limit: z.coerce.number().int().min(1).max(1000).default(200).describe('Number of photos to return'),
  })
  .meta({ id: 'ReorganizationItemsQueryDto' });

export type ReorganizeReason = z.infer<typeof ReorganizeReasonSchema>;

export class ReorganizeDto extends createZodDto(ReorganizeSchema) {}
export class ReorganizeItemsDto extends createZodDto(ReorganizeItemsSchema) {}
export class ReorganizePreviewResponseDto extends createZodDto(ReorganizePreviewResponseSchema) {}
export class ReorganizeItemsResponseDto extends createZodDto(ReorganizeItemsResponseSchema) {}
export class ReorganizeFolderQueryDto extends createZodDto(ReorganizeFolderQuerySchema) {}
export class ReorganizeFoldersResponseDto extends createZodDto(ReorganizeFoldersResponseSchema) {}
export class ReorganizationResponseDto extends createZodDto(ReorganizationSchema) {}
export class ReorganizationItemDto extends createZodDto(ReorganizationItemSchema) {}
export class ReorganizationItemsQueryDto extends createZodDto(ReorganizationItemsQuerySchema) {}
