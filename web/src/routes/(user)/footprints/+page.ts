import { getFootprints, getFootprintShapes } from '@immich/sdk';
import { authenticate } from '$lib/utils/auth';
import { getFormatter } from '$lib/utils/i18n';
import type { PageLoad } from './$types';

export const load = (async ({ url }) => {
  await authenticate(url);
  const [footprints, shapes] = await Promise.all([getFootprints(), getFootprintShapes()]);
  const $t = await getFormatter();

  return {
    footprints,
    shapes,
    meta: {
      title: $t('footprints'),
    },
  };
}) satisfies PageLoad;
