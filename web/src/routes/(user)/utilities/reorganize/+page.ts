import { authenticate } from '$lib/utils/auth';
import { getFormatter } from '$lib/utils/i18n';
import type { PageLoad } from './$types';

export const load = (async ({ url }) => {
  await authenticate(url);
  const $t = await getFormatter();

  return {
    // set by the shortcuts in the folder view and the album menu
    folder: url.searchParams.get('folder'),
    albumId: url.searchParams.get('album'),
    meta: {
      title: $t('reorganize'),
    },
  };
}) satisfies PageLoad;
