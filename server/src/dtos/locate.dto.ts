import { createZodDto } from 'nestjs-zod';
import { isoDatetimeToDate } from 'src/validation';
import z from 'zod';

const LocateGroupSchema = z
  .object({
    id: z.string().describe('Key of the group in the list: its first photo'),
    startAt: isoDatetimeToDate.describe('Local time of the first photo'),
    endAt: isoDatetimeToDate.describe('Local time of the last photo'),
    assetIds: z.array(z.string()).describe('Photos of the group, oldest first'),
  })
  .meta({ id: 'LocateGroupDto' });

const LocateGroupsResponseSchema = z
  .object({
    groups: z.array(LocateGroupSchema).describe('Photos taken close together, largest group first'),
    scattered: z.array(z.string()).describe('Photos too few to form a group, oldest first'),
  })
  .meta({ id: 'LocateGroupsResponseDto' });

const LocateAssetIdsSchema = z
  .object({ assetIds: z.array(z.uuidv4()).min(1).describe('Photos') })
  .meta({ id: 'LocateAssetIdsDto' });

const LocateSuggestionSchema = z
  .object({
    latitude: z.number().meta({ format: 'double' }).describe('Latitude'),
    longitude: z.number().meta({ format: 'double' }).describe('Longitude'),
    source: z
      .enum(['directory', 'time'])
      .describe('Where it comes from: located photos in the same folder, or the located photo nearest in time'),
  })
  .meta({ id: 'LocateSuggestionDto' });

const LocateSuggestionResponseSchema = z
  .object({ suggestion: LocateSuggestionSchema.nullable().describe('Suggested position; null without any clue') })
  .meta({ id: 'LocateSuggestionResponseDto' });

const LocateSuspectSchema = z
  .object({
    assetId: z.string().describe('The photo whose location is in doubt'),
    localDateTime: isoDatetimeToDate.describe('Local time of the photo'),
    latitude: z.number().meta({ format: 'double' }).describe('Latitude of the photo'),
    longitude: z.number().meta({ format: 'double' }).describe('Longitude of the photo'),
    place: z.string().nullable().describe('Place name of the photo'),
    otherAssetId: z.string().describe('A photo taken at the same moment that it contradicts'),
    otherLocalDateTime: isoDatetimeToDate.describe('Local time of the other photo'),
    otherLatitude: z.number().meta({ format: 'double' }).describe('Latitude of the other photo'),
    otherLongitude: z.number().meta({ format: 'double' }).describe('Longitude of the other photo'),
    otherPlace: z.string().nullable().describe('Place name of the other photo'),
  })
  .meta({ id: 'LocateSuspectDto' });

const LocateSuspectsResponseSchema = z
  .object({ suspects: z.array(LocateSuspectSchema).describe('Photos with a suspect location, oldest first') })
  .meta({ id: 'LocateSuspectsResponseDto' });

export class LocateSuspectsResponseDto extends createZodDto(LocateSuspectsResponseSchema) {}
export class LocateGroupsResponseDto extends createZodDto(LocateGroupsResponseSchema) {}
export class LocateAssetIdsDto extends createZodDto(LocateAssetIdsSchema) {}
export class LocateSuggestionResponseDto extends createZodDto(LocateSuggestionResponseSchema) {}
