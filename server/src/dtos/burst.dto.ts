import { createZodDto } from 'nestjs-zod';
import { isoDatetimeToDate } from 'src/validation';
import z from 'zod';

const BurstOrderSchema = z
  .enum(['size', 'time'])
  .describe('Largest burst first, or oldest first')
  .meta({ id: 'BurstOrder' });

const BurstSearchSchema = z
  .object({
    order: BurstOrderSchema.default('size'),
    offset: z.coerce.number().int().min(0).default(0).describe('Number of bursts to skip'),
    limit: z.coerce.number().int().min(1).max(200).default(40).describe('Number of bursts to return'),
  })
  .meta({ id: 'BurstSearchDto' });

const BurstAssetSchema = z
  .object({
    id: z.string().describe('Photo ID'),
    localDateTime: isoDatetimeToDate.describe('Local time the photo was taken'),
    sharpness: z
      .number()
      .meta({ format: 'double' })
      .nullable()
      .describe('How sharp the photo is compared to the other photos of the burst; null without a preview'),
  })
  .meta({ id: 'BurstAssetDto' });

const BurstSchema = z
  .object({
    duplicateId: z.string().describe('Duplicate group ID'),
    assets: z.array(BurstAssetSchema).describe('Photos of the burst, oldest first'),
    recommendedAssetId: z.string().describe('The sharpest photo, suggested to keep'),
  })
  .meta({ id: 'BurstDto' });

const BurstsResponseSchema = z
  .object({
    total: z.int().describe('Number of bursts left'),
    bursts: z.array(BurstSchema).describe('Bursts of this page'),
  })
  .meta({ id: 'BurstsResponseDto' });

export type BurstOrder = z.infer<typeof BurstOrderSchema>;

export class BurstSearchDto extends createZodDto(BurstSearchSchema) {}
export class BurstsResponseDto extends createZodDto(BurstsResponseSchema) {}
