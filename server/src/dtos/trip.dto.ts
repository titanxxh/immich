import { createZodDto } from 'nestjs-zod';
import { TripHomeSchema } from 'src/dtos/user-preferences.dto';
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
