import { createZodDto } from 'nestjs-zod';
import { isoDatetimeToDate } from 'src/validation';
import z from 'zod';

const FootprintPlaceSchema = z
  .object({
    id: z.string().describe('Region ID'),
    name: z.string().describe('Local name'),
    nameZh: z.string().nullable().describe('Chinese name, when there is one'),
  })
  .meta({ id: 'FootprintPlace' });

const FootprintCountrySchema = FootprintPlaceSchema.extend({
  code: z.string().describe('ISO 3166-1 alpha-2 code; Hong Kong, Macau and Taiwan are CN'),
}).meta({ id: 'FootprintCountry' });

const FootprintRegionSchema = z
  .object({
    id: z.string().describe('Region ID'),
    name: z.string().describe('Local name'),
    nameZh: z.string().nullable().describe('Chinese name, when there is one'),
    province: FootprintPlaceSchema.nullable().describe('Province; null abroad when the region is itself first-level'),
    country: FootprintCountrySchema,
    latitude: z.number().meta({ format: 'double' }).describe('Latitude of a point inside the region'),
    longitude: z.number().meta({ format: 'double' }).describe('Longitude of a point inside the region'),
    firstVisitAt: isoDatetimeToDate.describe('Local time of the earliest photo taken there'),
    lastVisitAt: isoDatetimeToDate.describe('Local time of the latest photo taken there'),
    assetCount: z.int().describe('Number of photos taken there'),
    dayCount: z.int().describe('Number of local calendar days with photos taken there'),
    hidden: z.boolean().describe('Whether the user left the region off the footprint map'),
  })
  .meta({ id: 'FootprintRegion' });

const FootprintsResponseSchema = z
  .object({
    regions: z.array(FootprintRegionSchema).describe('Every region the user took camera photos in, oldest visit first'),
    pendingCount: z.int().describe('Located photos whose regions have not been found yet'),
  })
  .meta({ id: 'FootprintsResponseDto' });

const FootprintShapeSchema = z
  .object({
    type: z.enum(['Feature']).meta({ id: 'FootprintShapeType' }),
    properties: z.object({ id: z.string().describe('Region ID') }),
    geometry: z
      .object({
        type: z.enum(['Polygon', 'MultiPolygon']).meta({ id: 'FootprintGeometryType' }),
        coordinates: z.array(z.any()).describe('GeoJSON coordinates'),
      })
      .describe('Simplified outline'),
  })
  .meta({ id: 'FootprintShape' });

const FootprintShapesResponseSchema = z
  .object({
    type: z.enum(['FeatureCollection']).meta({ id: 'FootprintShapesType' }),
    features: z.array(FootprintShapeSchema).describe('Outlines of the regions the user visited, hidden ones included'),
  })
  .meta({ id: 'FootprintShapesResponseDto' });

const FootprintRegionDetailSchema = z
  .object({
    region: FootprintRegionSchema,
    assetIds: z.array(z.string()).describe('Some photos taken there, spread evenly over time, oldest first'),
  })
  .meta({ id: 'FootprintRegionDetailResponseDto' });

const FootprintRegionParamSchema = z.object({ id: z.string().describe('Region, province or country ID') });

export class FootprintsResponseDto extends createZodDto(FootprintsResponseSchema) {}
export class FootprintShapesResponseDto extends createZodDto(FootprintShapesResponseSchema) {}
export class FootprintRegionDetailResponseDto extends createZodDto(FootprintRegionDetailSchema) {}
export class FootprintRegionParamDto extends createZodDto(FootprintRegionParamSchema) {}
export type FootprintRegionDto = z.infer<typeof FootprintRegionSchema>;
