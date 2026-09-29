<script lang="ts">
  import { Route } from '$lib/route';
  import { lang, locale } from '$lib/stores/preferences.store';
  import { getAssetMediaUrl } from '$lib/utils';
  import { handleError } from '$lib/utils/handle-error';
  import { AssetMediaSize, getFootprintRegion, type FootprintRegion } from '@immich/sdk';
  import { Button, IconButton, LoadingSpinner } from '@immich/ui';
  import { mdiClose, mdiEyeOffOutline, mdiEyeOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';
  import { formatVisitDate, placeName } from './footprints';

  type Props = {
    region: FootprintRegion;
    /** position of the region among the visible ones by first visit, 1-based; 0 when hidden */
    rank: number;
    onClose: () => void;
    onToggleHidden: (region: FootprintRegion) => void;
  };

  let { region, rank, onClose, onToggleHidden }: Props = $props();

  let assetIds = $state<string[]>();

  $effect(() => {
    const id = region.id;
    assetIds = undefined;
    getFootprintRegion({ id })
      .then((detail) => {
        if (detail.region.id === region.id) {
          assetIds = detail.assetIds;
        }
      })
      .catch((error) => handleError(error, $t('errors.unable_to_load_footprint_region')));
  });

  const parents = $derived(
    [region.province && region.province.id !== region.id ? region.province : undefined, region.country]
      .filter((place) => place !== undefined)
      .map((place) => placeName(place, $lang))
      .join(' · '),
  );
</script>

<aside
  class="fixed inset-e-0 top-(--navbar-height) z-20 flex h-[calc(100dvh-var(--navbar-height))] w-full max-w-sm flex-col gap-4 overflow-y-auto border-s border-gray-200 bg-light p-4 shadow-xl dark:border-gray-700"
  aria-label={placeName(region, $lang)}
>
  <div class="flex items-start justify-between gap-2">
    <div class="min-w-0">
      <h2 class="truncate text-2xl font-medium">{placeName(region, $lang)}</h2>
      <p class="text-sm text-gray-500 dark:text-gray-300">{parents}</p>
    </div>
    <IconButton
      icon={mdiClose}
      aria-label={$t('close')}
      shape="round"
      variant="ghost"
      color="secondary"
      onclick={onClose}
    />
  </div>

  <dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
    <div>
      <dt class="text-gray-500 dark:text-gray-300">{$t('footprints_first_visit')}</dt>
      <dd class="font-medium">{formatVisitDate(region.firstVisitAt, $locale)}</dd>
    </div>
    <div>
      <dt class="text-gray-500 dark:text-gray-300">{$t('footprints_last_visit')}</dt>
      <dd class="font-medium">{formatVisitDate(region.lastVisitAt, $locale)}</dd>
    </div>
    <div>
      <dt class="text-gray-500 dark:text-gray-300">{$t('photos')}</dt>
      <dd class="font-medium">{region.assetCount.toLocaleString($locale)}</dd>
    </div>
    <div>
      <dt class="text-gray-500 dark:text-gray-300">{$t('footprints_days')}</dt>
      <dd class="font-medium">{region.dayCount.toLocaleString($locale)}</dd>
    </div>
  </dl>
  {#if rank > 0}
    <p class="text-sm">{$t('footprints_rank', { values: { rank } })}</p>
  {/if}

  {#if assetIds}
    <div class="grid grid-cols-4 gap-1">
      {#each assetIds as assetId (assetId)}
        <a href={Route.viewFootprintAsset({ regionId: region.id, assetId })}>
          <img
            class="aspect-square w-full rounded-md object-cover"
            alt=""
            loading="lazy"
            src={getAssetMediaUrl({ id: assetId, size: AssetMediaSize.Thumbnail })}
          />
        </a>
      {/each}
    </div>
  {:else}
    <div class="flex justify-center p-4"><LoadingSpinner /></div>
  {/if}

  <div class="mt-auto flex flex-wrap gap-2">
    <Button href={Route.viewFootprintRegion({ id: region.id })} size="small">
      {$t('footprints_view_all', { values: { count: region.assetCount } })}
    </Button>
    <Button
      size="small"
      variant="ghost"
      color="secondary"
      leadingIcon={region.hidden ? mdiEyeOutline : mdiEyeOffOutline}
      onclick={() => onToggleHidden(region)}
    >
      {region.hidden ? $t('footprints_show_region') : $t('footprints_hide_region')}
    </Button>
  </div>
</aside>
