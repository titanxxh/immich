<script lang="ts">
  // PROTOTYPE variant B: a vertical timeline. Each trip is a row whose height follows its length, so long trips and
  // the gaps between trips are visible at a glance.
  import { getAssetMediaUrl } from '$lib/utils';
  import { AssetMediaSize } from '@immich/sdk';
  import { formatRange, groupByYear, type TripItem } from './types';
  let { trips }: { trips: TripItem[] } = $props();
</script>

<div class="mx-auto max-w-3xl">
  {#each groupByYear(trips) as [year, items] (year)}
    <div class="sticky top-0 z-1 bg-light py-2 text-2xl font-medium">{year}</div>
    <ol class="relative ms-24 border-s-2 border-gray-300 dark:border-gray-600">
      {#each items as trip (trip.album.id)}
        <li class="relative mb-4 ps-6" style="min-height: {Math.min(40 + trip.days * 12, 200)}px">
          <span class="absolute -start-24 top-3 w-20 text-end text-sm text-gray-500 dark:text-gray-300">
            {formatRange(trip)}
          </span>
          <span class="absolute -start-[7px] top-4 size-3 rounded-full bg-primary"></span>
          <a href="/albums/{trip.album.id}" class="flex items-center gap-4 rounded-2xl p-2 hover:bg-subtle">
            {#if trip.album.albumThumbnailAssetId}
              <img
                class="size-20 rounded-xl object-cover"
                alt=""
                loading="lazy"
                src={getAssetMediaUrl({ id: trip.album.albumThumbnailAssetId, size: AssetMediaSize.Thumbnail })}
              />
            {/if}
            <div>
              <p class="text-lg font-medium">{trip.place}</p>
              <p class="text-sm text-gray-500 dark:text-gray-300">{trip.days} 天 · {trip.album.assetCount} 张照片</p>
            </div>
          </a>
        </li>
      {/each}
    </ol>
  {/each}
</div>
