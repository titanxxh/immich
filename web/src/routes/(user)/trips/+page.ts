import { getTrips } from '@immich/sdk';
import { authenticate } from '$lib/utils/auth';
import { getFormatter } from '$lib/utils/i18n';
import type { PageLoad } from './$types';

export const load = (async ({ url }) => {
  await authenticate(url);
  const trips = await getTrips({});
  const $t = await getFormatter();

  return {
    trips: [...trips].sort((a, b) => b.startAt.localeCompare(a.startAt)),
    meta: {
      title: $t('trips'),
    },
  };
}) satisfies PageLoad;
