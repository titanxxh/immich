import { createZodDto } from 'nestjs-zod';
import { AssetOrderSchema, UserAvatarColorSchema } from 'src/enum';
import { UserPreferences } from 'src/types';
import z from 'zod';

const AlbumsUpdateSchema = z
  .object({
    defaultAssetOrder: AssetOrderSchema.optional(),
  })
  .optional()
  .describe('Album preferences')
  .meta({ id: 'AlbumsUpdate' });

const AvatarUpdateSchema = z
  .object({
    color: UserAvatarColorSchema.optional(),
  })
  .optional()
  .meta({ id: 'AvatarUpdate' });

const MemoriesUpdateSchema = z
  .object({
    enabled: z.boolean().optional().describe('Whether memories are enabled'),
    duration: z.int().min(1).optional().describe('Memory duration in seconds'),
    sidebarWeb: z.boolean().optional().describe('Whether memories appear in web sidebar'),
  })
  .optional()
  .meta({ id: 'MemoriesUpdate' });

const RatingsUpdateSchema = z
  .object({
    enabled: z.boolean().optional().describe('Whether ratings are enabled'),
  })
  .optional()
  .meta({ id: 'RatingsUpdate' });

const FoldersUpdateSchema = z
  .object({
    enabled: z.boolean().optional().describe('Whether folders are enabled'),
    sidebarWeb: z.boolean().optional().describe('Whether folders appear in web sidebar'),
  })
  .optional()
  .meta({ id: 'FoldersUpdate' });

const PeopleUpdateSchema = z
  .object({
    enabled: z.boolean().optional().describe('Whether people are enabled'),
    sidebarWeb: z.boolean().optional().describe('Whether people appear in web sidebar'),
    minimumFaces: z.int().min(1).optional().describe('People face threshold'),
  })
  .optional()
  .meta({ id: 'PeopleUpdate' });

const SharedLinksUpdateSchema = z
  .object({
    enabled: z.boolean().optional().describe('Whether shared links are enabled'),
    sidebarWeb: z.boolean().optional().describe('Whether shared links appear in web sidebar'),
  })
  .optional()
  .meta({ id: 'SharedLinksUpdate' });

const TagsUpdateSchema = z
  .object({
    enabled: z.boolean().optional().describe('Whether tags are enabled'),
    sidebarWeb: z.boolean().optional().describe('Whether tags appear in web sidebar'),
  })
  .optional()
  .meta({ id: 'TagsUpdate' });

const EmailNotificationsUpdateSchema = z
  .object({
    enabled: z.boolean().optional().describe('Whether email notifications are enabled'),
    albumInvite: z.boolean().optional().describe('Whether to receive email notifications for album invites'),
    albumUpdate: z.boolean().optional().describe('Whether to receive email notifications for album updates'),
  })
  .optional()
  .meta({ id: 'EmailNotificationsUpdate' });

const DownloadUpdateSchema = z
  .object({
    archiveSize: z.int().min(1).optional().describe('Maximum archive size in bytes'),
    includeEmbeddedVideos: z.boolean().optional().describe('Whether to include embedded videos in downloads'),
  })
  .optional()
  .meta({ id: 'DownloadUpdate' });

const PurchaseUpdateSchema = z
  .object({
    showSupportBadge: z.boolean().optional().describe('Whether to show support badge'),
    hideBuyButtonUntil: z.string().optional().describe('Date until which to hide buy button'),
  })
  .optional()
  .meta({ id: 'PurchaseUpdate' });

const CastUpdateSchema = z
  .object({
    gCastEnabled: z.boolean().optional().describe('Whether Google Cast is enabled'),
  })
  .optional()
  .meta({ id: 'CastUpdate' });

const RecentlyAddedUpdateSchema = z
  .object({
    sidebarWeb: z.boolean().optional().describe('Whether the recently added page appears in the web sidebar'),
  })
  .optional()
  .meta({ id: 'RecentlyAddedUpdate' });

const TripHomeSchema = z
  .object({
    name: z.string().describe('Home name'),
    latitude: z.number().min(-90).max(90).meta({ format: 'double' }).describe('Home latitude'),
    longitude: z.number().min(-180).max(180).meta({ format: 'double' }).describe('Home longitude'),
    radiusKm: z
      .number()
      .positive()
      .meta({ format: 'double' })
      .describe('Photos within this distance (km) are taken at home'),
    from: z.iso.date().nullish().describe('First day this home applies to (YYYY-MM-DD, inclusive)'),
    to: z.iso.date().nullish().describe('Last day this home applies to (YYYY-MM-DD, inclusive)'),
  })
  .meta({ id: 'TripHome' });

const TripsUpdateSchema = z
  .object({
    enabled: z.boolean().optional().describe('Whether trips are detected and turned into albums'),
    homes: z.array(TripHomeSchema).optional().describe('Places that are home; being away from all of them is a trip'),
    minAssets: z.int().min(1).optional().describe('Minimum number of located photos for a trip'),
    includeDayTrips: z.boolean().optional().describe('Whether trips within a single day get an album'),
  })
  .optional()
  .meta({ id: 'TripsUpdate' });

const UserPreferencesUpdateSchema = z
  .object({
    albums: AlbumsUpdateSchema,
    avatar: AvatarUpdateSchema,
    cast: CastUpdateSchema,
    download: DownloadUpdateSchema,
    emailNotifications: EmailNotificationsUpdateSchema,
    folders: FoldersUpdateSchema,
    memories: MemoriesUpdateSchema,
    people: PeopleUpdateSchema,
    purchase: PurchaseUpdateSchema,
    ratings: RatingsUpdateSchema,
    sharedLinks: SharedLinksUpdateSchema,
    tags: TagsUpdateSchema,
    recentlyAdded: RecentlyAddedUpdateSchema,
    trips: TripsUpdateSchema,
  })
  .meta({ id: 'UserPreferencesUpdateDto' });

const AlbumsResponseSchema = z
  .object({
    defaultAssetOrder: AssetOrderSchema,
  })
  .meta({ id: 'AlbumsResponse' });

const FoldersResponseSchema = z
  .object({
    enabled: z.boolean().describe('Whether folders are enabled'),
    sidebarWeb: z.boolean().describe('Whether folders appear in web sidebar'),
  })
  .meta({ id: 'FoldersResponse' });

const MemoriesResponseSchema = z
  .object({
    enabled: z.boolean().describe('Whether memories are enabled'),
    duration: z.int().describe('Memory duration in seconds'),
    sidebarWeb: z.boolean().describe('Whether memories appear in web sidebar'),
  })
  .meta({ id: 'MemoriesResponse' });

const PeopleResponseSchema = z
  .object({
    enabled: z.boolean().describe('Whether people are enabled'),
    sidebarWeb: z.boolean().describe('Whether people appear in web sidebar'),
    minimumFaces: z.int().min(1).optional().describe('People face threshold'),
  })
  .meta({ id: 'PeopleResponse' });

const RatingsResponseSchema = z
  .object({
    enabled: z.boolean().describe('Whether ratings are enabled'),
  })
  .meta({ id: 'RatingsResponse' });

const SharedLinksResponseSchema = z
  .object({
    enabled: z.boolean().describe('Whether shared links are enabled'),
    sidebarWeb: z.boolean().describe('Whether shared links appear in web sidebar'),
  })
  .meta({ id: 'SharedLinksResponse' });

const TagsResponseSchema = z
  .object({
    enabled: z.boolean().describe('Whether tags are enabled'),
    sidebarWeb: z.boolean().describe('Whether tags appear in web sidebar'),
  })
  .meta({ id: 'TagsResponse' });

const EmailNotificationsResponseSchema = z
  .object({
    enabled: z.boolean().describe('Whether email notifications are enabled'),
    albumInvite: z.boolean().describe('Whether to receive email notifications for album invites'),
    albumUpdate: z.boolean().describe('Whether to receive email notifications for album updates'),
  })
  .meta({ id: 'EmailNotificationsResponse' });

const DownloadResponseSchema = z
  .object({
    archiveSize: z.int().describe('Maximum archive size in bytes'),
    includeEmbeddedVideos: z.boolean().describe('Whether to include embedded videos in downloads'),
  })
  .meta({ id: 'DownloadResponse' });

const PurchaseResponseSchema = z
  .object({
    showSupportBadge: z.boolean().describe('Whether to show support badge'),
    hideBuyButtonUntil: z.string().describe('Date until which to hide buy button'),
  })
  .meta({ id: 'PurchaseResponse' });

const CastResponseSchema = z
  .object({
    gCastEnabled: z.boolean().describe('Whether Google Cast is enabled'),
  })
  .meta({ id: 'CastResponse' });

const RecentlyAddedResponseSchema = z
  .object({
    sidebarWeb: z.boolean().describe('Whether the recently added page appears in the web sidebar'),
  })
  .meta({ id: 'RecentlyAddedResponse' });

const TripsResponseSchema = z
  .object({
    enabled: z.boolean().describe('Whether trips are detected and turned into albums'),
    homes: z.array(TripHomeSchema).describe('Places that are home; being away from all of them is a trip'),
    minAssets: z.int().describe('Minimum number of located photos for a trip'),
    includeDayTrips: z.boolean().describe('Whether trips within a single day get an album'),
  })
  .meta({ id: 'TripsResponse' });

const UserPreferencesResponseSchema = z
  .object({
    albums: AlbumsResponseSchema,
    folders: FoldersResponseSchema,
    memories: MemoriesResponseSchema,
    people: PeopleResponseSchema,
    ratings: RatingsResponseSchema,
    sharedLinks: SharedLinksResponseSchema,
    tags: TagsResponseSchema,
    emailNotifications: EmailNotificationsResponseSchema,
    download: DownloadResponseSchema,
    purchase: PurchaseResponseSchema,
    cast: CastResponseSchema,
    recentlyAdded: RecentlyAddedResponseSchema,
    trips: TripsResponseSchema,
  })
  .meta({ id: 'UserPreferencesResponseDto' });

export class UserPreferencesUpdateDto extends createZodDto(UserPreferencesUpdateSchema) {}
export class UserPreferencesResponseDto extends createZodDto(UserPreferencesResponseSchema) {}

export const mapPreferences = (preferences: UserPreferences): UserPreferencesResponseDto => {
  return preferences;
};
