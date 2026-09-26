<script lang="ts">
  // PROTOTYPE variant C: day-by-day story. Replaces the timeline with one section per day: its title, a small map of
  // that day's route and a strip of its photos.
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { getAssetMediaUrl } from '$lib/utils';
  import { AssetMediaSize, type AlbumResponseDto } from '@immich/sdk';
  import { getTrip } from './trip-data';
  import TripOverview from './TripOverview.svelte';
  import TripRouteMap from './TripRouteMap.svelte';

  const PHOTOS_PER_DAY = 18;
  let { album }: { album: AlbumResponseDto } = $props();
</script>

<main class="h-dvh overflow-y-auto px-2 pt-(--navbar-height) pb-24 md:px-6">
  <section class="mx-auto max-w-5xl pt-8 md:pt-16">
    <h1 class="text-4xl font-medium text-primary">{album.albumName}</h1>
    {#await getTrip(album.id, authManager.preferences.trips.homes)}
      <p class="my-4 text-sm text-gray-500">正在计算路线…</p>
    {:then trip}
      <div class="my-4"><TripOverview {trip} /></div>
      <TripRouteMap {trip} class="h-72" />
      {#each trip.days as day (day.date)}
        <section class="mt-10">
          <h2 class="mb-3 flex items-center gap-2 text-xl">
            <span class="inline-block size-3 rounded-full" style="background: {day.color}"></span>
            <span class="font-medium">{day.label}</span>
            {#if day.place}<span class="text-gray-500 dark:text-gray-300">· {day.place}</span>{/if}
          </h2>
          <div class="grid gap-3 md:grid-cols-[280px_1fr]">
            {#if day.stops.length > 0}
              <TripRouteMap {trip} selectedDate={day.date} class="h-56" />
            {:else}
              <div class="flex h-56 items-center justify-center rounded-2xl bg-subtle text-sm text-gray-500">
                这天没有位置
              </div>
            {/if}
            <div class="grid grid-cols-6 gap-1 self-start">
              {#each day.photos.slice(0, PHOTOS_PER_DAY) as photo (photo.id)}
                <img
                  class="aspect-square w-full rounded object-cover"
                  loading="lazy"
                  alt=""
                  src={getAssetMediaUrl({ id: photo.id, size: AssetMediaSize.Thumbnail })}
                />
              {/each}
              {#if day.photos.length > PHOTOS_PER_DAY}
                <div class="flex aspect-square items-center justify-center rounded bg-subtle text-sm">
                  +{day.photos.length - PHOTOS_PER_DAY}
                </div>
              {/if}
            </div>
          </div>
        </section>
      {/each}
    {/await}
  </section>
</main>
