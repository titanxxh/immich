import { createZodDto } from 'nestjs-zod';
import { TripHomeSchema } from 'src/dtos/user-preferences.dto';
import { TripSourceSchema } from 'src/enum';
import { isoDatetimeToDate } from 'src/validation';
import z from 'zod';

const TripPreviewSchema = z
  .object({
    homes: z.array(TripHomeSchema).describe('Places that are home; being away from all of them is a trip'),
    minAssets: z.int().min(1).describe('Minimum number of located photos for a trip'),
    includeDayTrips: z.boolean().describe('Whether trips within a single day count'),
  })
  .meta({ id: 'TripPreviewDto' });

const TripPreviewResponseSchema = z
  .object({
    name: z.string().describe('Name the trip album would get'),
    startAt: isoDatetimeToDate.describe('Local time of the first photo'),
    endAt: isoDatetimeToDate.describe('Local time of the last photo'),
    days: z.int().describe('Number of calendar days with located photos'),
    assetCount: z.int().describe('Number of photos in the trip'),
  })
  .meta({ id: 'TripPreviewResponseDto' });

export class TripPreviewDto extends createZodDto(TripPreviewSchema) {}
export class TripPreviewResponseDto extends createZodDto(TripPreviewResponseSchema) {}

const TripSearchSchema = z
  .object({ albumId: z.uuidv4().optional().describe('Only the trip of this album') })
  .meta({ id: 'TripSearchDto' });

const TripCreateSchema = z
  .object({
    albumId: z.uuidv4().describe('The album to mark as a trip'),
    replaceTripIds: z
      .array(z.uuidv4())
      .optional()
      .describe('Detected trips overlapping the album that it replaces; they are dismissed and keep their albums'),
  })
  .meta({ id: 'TripCreateDto' });

const TripPointSchema = z
  .object({
    latitude: z.number().meta({ format: 'double' }).describe('Latitude'),
    longitude: z.number().meta({ format: 'double' }).describe('Longitude'),
  })
  .meta({ id: 'TripPoint' });

const TripResponseSchema = z
  .object({
    id: z.string().describe('Trip ID'),
    albumId: z.string().describe('ID of the trip album'),
    source: TripSourceSchema,
    name: z.string().describe('Album name'),
    startAt: isoDatetimeToDate.describe('Local time of the first photo'),
    endAt: isoDatetimeToDate.describe('Local time of the last photo'),
    dayCount: z.int().describe('Number of calendar days with photos'),
    assetCount: z.int().describe('Number of photos'),
    thumbnailAssetId: z.string().nullable().describe('Album cover'),
    point: TripPointSchema.nullable().describe('Where the trip is shown on a map; null without located photos'),
  })
  .meta({ id: 'TripResponseDto' });

const TripStopSchema = TripPointSchema.extend({
  date: z.string().describe('Local date (YYYY-MM-DD)'),
  assetCount: z.int().describe('Number of photos taken at the stop'),
  place: z.string().nullable().describe('City of the stop'),
}).meta({ id: 'TripStopDto' });

const TripDaySchema = z
  .object({
    index: z.int().describe('1 for the first day of the trip'),
    date: z.string().describe('Local date (YYYY-MM-DD)'),
    place: z.string().describe('Where the day was spent, e.g. "丽江 → 大理"; empty without located photos'),
    assetCount: z.int().describe('Number of photos'),
    firstAssetId: z.string().describe('First photo of the day'),
    stops: z.array(z.int()).describe("Indexes of the day's stops"),
  })
  .meta({ id: 'TripDayDto' });

const TripLegSchema = z
  .object({
    from: z.int().describe('Index of the stop the leg starts at'),
    to: z.int().describe('Index of the stop the leg ends at'),
    isLongJump: z.boolean().describe('Whether the leg is long enough to be a flight or train ride'),
  })
  .meta({ id: 'TripLegDto' });

const TripDetailResponseSchema = TripResponseSchema.extend({
  places: z.array(z.string()).describe('Places visited, in order'),
  farthestKm: z.number().meta({ format: 'double' }).nullable().describe('Largest distance from home in kilometres'),
  days: z.array(TripDaySchema),
  stops: z.array(TripStopSchema),
  legs: z.array(TripLegSchema),
}).meta({ id: 'TripDetailResponseDto' });

export class TripSearchDto extends createZodDto(TripSearchSchema) {}
export class TripCreateDto extends createZodDto(TripCreateSchema) {}
export class TripResponseDto extends createZodDto(TripResponseSchema) {}
export class TripDetailResponseDto extends createZodDto(TripDetailResponseSchema) {}
