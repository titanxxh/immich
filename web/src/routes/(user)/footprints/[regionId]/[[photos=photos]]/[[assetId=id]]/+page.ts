import { getFootprintRegion } from '@immich/sdk';
import { authenticate } from '$lib/utils/auth';
import type { PageLoad } from './$types';

export const load = (async ({ params, url }) => {
  await authenticate(url);
  const { region } = await getFootprintRegion({ id: params.regionId });

  return {
    region,
    meta: {
      title: region.nameZh ?? region.name,
    },
  };
}) satisfies PageLoad;
