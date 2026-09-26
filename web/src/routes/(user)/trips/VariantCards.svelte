<script lang="ts">
  // PROTOTYPE variant A: cards grouped by year.
  import { getAssetMediaUrl } from '$lib/utils';
  import { AssetMediaSize } from '@immich/sdk';
  import { formatRange, groupByYear, type TripItem } from './types';
  let { trips }: { trips: TripItem[] } = $props();
</script>

{#each groupByYear(trips) as [year, items] (year)}
  <section class="mb-8">
    <h2 class="mb-3 text-2xl font-medium">{year} <span class="text-base text-gray-500">· {items.length} 次</span></h2>
    <div class="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
      {#each items as trip (trip.album.id)}
        <a href="/albums/{trip.album.id}" class="group overflow-hidden rounded-2xl bg-subtle">
          {#if trip.album.albumThumbnailAssetId}
            <img
              class="aspect-[4/3] w-full object-cover transition group-hover:scale-105"
              alt=""
              loading="lazy"
              src={getAssetMediaUrl({ id: trip.album.albumThumbnailAssetId, size: AssetMediaSize.Thumbnail })}
            />
          {/if}
          <div class="p-3">
            <p class="font-medium">{trip.place}</p>
            <p class="text-sm text-gray-500 dark:text-gray-300">
              {formatRange(trip)} · {trip.days} 天 · {trip.album.assetCount} 张
            </p>
          </div>
        </a>
      {/each}
    </div>
  </section>
{/each}
