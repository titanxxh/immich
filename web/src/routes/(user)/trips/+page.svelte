<script lang="ts">
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import { Route } from '$lib/route';
  import { locale } from '$lib/stores/preferences.store';
  import { getAssetMediaUrl } from '$lib/utils';
  import { AssetMediaSize } from '@immich/sdk';
  import { t } from 'svelte-i18n';
  import type { PageData } from './$types';
  import TripsMap from './TripsMap.svelte';
  import { formatTripDates, getYearColor, groupByYear } from './trips';

  let { data }: { data: PageData } = $props();

  let hoveredId = $state<string>();
  const groups = $derived(groupByYear(data.trips));
  const years = $derived(groups.map(([year]) => year));
</script>

<UserPageLayout title={$t('trips')} description={`(${data.trips.length.toLocaleString($locale)})`}>
  {#if data.trips.length === 0}
    <p class="p-8 text-center text-gray-500 dark:text-gray-300">{$t('trips_list_empty')}</p>
  {:else}
    <div class="grid h-[calc(100dvh-var(--navbar-height)-4rem)] gap-4 p-4 md:grid-cols-[1fr_420px]">
      <div class="min-h-80">
        <TripsMap trips={data.trips} {years} {hoveredId} onHover={(id) => (hoveredId = id)} />
      </div>

      <div class="overflow-y-auto pe-2">
        {#each groups as [year, trips] (year)}
          <div class="sticky top-0 z-1 flex items-center gap-2 bg-light py-2 text-xl font-medium">
            <span class="inline-block size-3 rounded-full" style:background={getYearColor(years, year)}></span>
            {year}
          </div>
          <ol class="relative ms-20 border-s-2 border-gray-300 dark:border-gray-600">
            {#each trips as trip (trip.id)}
              {@const [start, end] = formatTripDates(trip, $locale)}
              <li class="relative mb-2 ps-4" style:min-height="{Math.min(56 + trip.dayCount * 10, 180)}px">
                <span class="absolute -inset-s-20 top-3 w-18 text-end text-xs text-gray-500 dark:text-gray-300">
                  <span class="block">{start}</span>
                  {#if end}<span class="block">– {end}</span>{/if}
                </span>
                <span class="absolute inset-s-[-7px] top-4 size-3 rounded-full bg-primary"></span>
                <a
                  href={Route.viewAlbum({ id: trip.albumId })}
                  class="flex items-center gap-3 rounded-2xl p-2 hover:bg-subtle {hoveredId === trip.id
                    ? 'bg-primary/10'
                    : ''}"
                  onmouseenter={() => (hoveredId = trip.id)}
                  onmouseleave={() => (hoveredId = undefined)}
                >
                  {#if trip.thumbnailAssetId}
                    <img
                      class="size-16 shrink-0 rounded-xl object-cover"
                      alt=""
                      loading="lazy"
                      src={getAssetMediaUrl({ id: trip.thumbnailAssetId, size: AssetMediaSize.Thumbnail })}
                    />
                  {:else}
                    <div class="size-16 shrink-0 rounded-xl bg-subtle"></div>
                  {/if}
                  <div class="min-w-0">
                    <p class="truncate font-medium">{trip.name}</p>
                    <p class="text-sm text-gray-500 dark:text-gray-300">
                      {$t('trip_day_count', { values: { count: trip.dayCount } })} · {$t('trips_photos', {
                        values: { count: trip.assetCount },
                      })}
                    </p>
                  </div>
                </a>
              </li>
            {/each}
          </ol>
        {/each}
      </div>
    </div>
  {/if}
</UserPageLayout>
