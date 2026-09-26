<script lang="ts">
  import { locale } from '$lib/stores/preferences.store';
  import type { TripDayDto, TripDetailResponseDto } from '@immich/sdk';
  import { t } from 'svelte-i18n';
  import TripRouteMap from './TripRouteMap.svelte';
  import { formatDayDate, getDayColor } from './trip';

  type Props = {
    trip: TripDetailResponseDto;
    selectedDate?: string;
    onSelectDay: (day?: TripDayDto) => void;
  };

  let { trip, selectedDate, onSelectDay }: Props = $props();

  let dayElements = $state<Record<string, HTMLElement>>({});

  // keep the highlighted day in view as the timeline scrolls
  $effect(() => {
    if (selectedDate) {
      dayElements[selectedDate]?.scrollIntoView({ block: 'nearest' });
    }
  });

  const onSelectDate = (date: string) => onSelectDay(trip.days.find((day) => day.date === date));
</script>

<aside
  class="hidden h-dvh w-110 shrink-0 flex-col gap-3 overflow-hidden border-s bg-light p-4 pt-(--navbar-height) lg:flex dark:border-gray-700"
>
  <div class="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-sm">
    <span>{$t('trip_day_count', { values: { count: trip.days.length } })}</span>
    {#if trip.places.length > 0}
      <span class="line-clamp-2" title={trip.places.join('、')}>
        {$t('trip_places', { values: { count: trip.places.length, places: trip.places.slice(0, 6).join('、') } })}
      </span>
    {/if}
    {#if trip.farthestKm !== null}
      <span>{$t('trip_farthest', { values: { distance: trip.farthestKm.toLocaleString($locale) } })}</span>
    {/if}
    <span>{$t('trips_photos', { values: { count: trip.assetCount } })}</span>
  </div>

  {#if trip.stops.length > 0}
    <TripRouteMap {trip} {selectedDate} class="h-[42vh] shrink-0" {onSelectDate} />
  {:else}
    <div class="flex h-40 shrink-0 items-center justify-center rounded-2xl bg-subtle text-sm text-gray-500">
      {$t('trip_no_location')}
    </div>
  {/if}

  <div class="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
    <button
      type="button"
      class="rounded-xl border px-3 py-1.5 text-start text-sm dark:border-gray-700 {selectedDate
        ? ''
        : 'border-primary bg-primary/10'}"
      onclick={() => onSelectDay(undefined)}
    >
      {$t('trip_whole')}
    </button>
    {#each trip.days as day (day.date)}
      <button
        type="button"
        bind:this={dayElements[day.date]}
        class="flex items-center gap-2 rounded-xl border px-3 py-1.5 text-start text-sm dark:border-gray-700 {selectedDate ===
        day.date
          ? 'border-primary bg-primary/10'
          : ''}"
        onclick={() => onSelectDay(day)}
      >
        <span class="inline-block size-2.5 shrink-0 rounded-full" style:background={getDayColor(day.index)}></span>
        <span class="min-w-0 flex-1 truncate">
          <span class="font-medium">{$t('trip_day', { values: { index: day.index } })}</span>
          {` · ${formatDayDate(day.date, $locale)}`}
          {#if day.place}
            <span class="text-gray-500 dark:text-gray-300">{` · ${day.place}`}</span>
          {/if}
        </span>
        <span class="shrink-0 text-xs text-gray-500">{$t('trips_photos', { values: { count: day.assetCount } })}</span>
      </button>
    {/each}
  </div>
</aside>
