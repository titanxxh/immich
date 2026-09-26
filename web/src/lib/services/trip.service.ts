import { createTrip, isHttpError, removeTrip, type TripResponseDto } from '@immich/sdk';
import { modalManager, toastManager } from '@immich/ui';
import { handleError } from '$lib/utils/handle-error';
import { getFormatter } from '$lib/utils/i18n';

/**
 * Marks an album as a trip. When the album overlaps trips that already exist, the user is asked whether it replaces
 * them. Returns whether the album is now a trip.
 */
export const markAlbumAsTrip = async (albumId: string) => {
  const $t = await getFormatter();
  try {
    try {
      await createTrip({ tripCreateDto: { albumId } });
    } catch (error) {
      if (!isHttpError(error) || error.status !== 409) {
        throw error;
      }

      const trips = (error.data as { trips?: TripResponseDto[] } | undefined)?.trips ?? [];
      const names = trips.map((trip) => `《${trip.name}》`).join('、');
      const isConfirmed = await modalManager.showDialog({
        prompt: $t('trip_replace_prompt', { values: { trips: names } }),
      });
      if (!isConfirmed) {
        return false;
      }

      await createTrip({ tripCreateDto: { albumId, replaceTripIds: trips.map((trip) => trip.id) } });
    }

    toastManager.primary($t('trip_marked'));
    return true;
  } catch (error) {
    handleError(error, $t('errors.unable_to_mark_trip'));
    return false;
  }
};

/** Stops treating an album as a trip; the album itself stays. */
export const unmarkTrip = async (tripId: string) => {
  const $t = await getFormatter();
  try {
    await removeTrip({ id: tripId });
    toastManager.primary($t('trip_unmarked'));
    return true;
  } catch (error) {
    handleError(error, $t('errors.unable_to_unmark_trip'));
    return false;
  }
};
