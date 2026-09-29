<script lang="ts">
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { Route } from '$lib/route';
  import { lang, locale } from '$lib/stores/preferences.store';
  import { handleError } from '$lib/utils/handle-error';
  import { updateMyPreferences, type FootprintRegion } from '@immich/sdk';
  import { Button } from '@immich/ui';
  import { mdiAirplane, mdiPause, mdiPlay } from '@mdi/js';
  import { onDestroy } from 'svelte';
  import { t } from 'svelte-i18n';
  import type { PageData } from './$types';
  import FootprintMap from './FootprintMap.svelte';
  import {
    countPlaces,
    formatVisitDate,
    newRegionsByYear,
    placeName,
    sortRegions,
    visitYear,
    visitedBy,
    type SortKey,
  } from './footprints';
  import NewRegionsChart from './NewRegionsChart.svelte';
  import RegionDrawer from './RegionDrawer.svelte';

  let { data }: { data: PageData } = $props();

  // replaced locally when the user hides or restores a region
  let regions = $derived(data.footprints.regions);
  let selected = $state<FootprintRegion>();
  let tableYear = $state<string>();
  let sortKey = $state<SortKey>('firstVisit');
  let map = $state<ReturnType<typeof FootprintMap>>();
  let mapSection = $state<HTMLElement>();

  const visible = $derived(regions.filter((region) => !region.hidden));
  const hidden = $derived(regions.filter((region) => region.hidden));
  const years = $derived(newRegionsByYear(visible));

  // replay: a year index into `years`, or undefined for today
  let replayIndex = $state<number>();
  let playing = $state(false);
  let timer: ReturnType<typeof setInterval> | undefined;
  const replayYear = $derived(replayIndex === undefined ? undefined : years[replayIndex]?.year);
  const shown = $derived(visitedBy(visible, replayYear));
  const counts = $derived(countPlaces(shown));
  const newThisYear = $derived(replayYear ? shown.filter((region) => visitYear(region) === replayYear).length : 0);

  const stop = () => {
    playing = false;
    clearInterval(timer);
  };

  const play = () => {
    if (years.length === 0) {
      return;
    }
    playing = true;
    replayIndex = 0;
    timer = setInterval(() => {
      if (replayIndex === undefined || replayIndex >= years.length - 1) {
        stop();
        return;
      }
      replayIndex++;
    }, 900);
  };

  onDestroy(stop);

  const rows = $derived(
    sortRegions(tableYear ? visible.filter((region) => visitYear(region) === tableYear) : visible, sortKey, $lang),
  );

  // `selected` is a state proxy, so find it by id
  const rankOf = (region: FootprintRegion) => (region.hidden ? 0 : visible.findIndex(({ id }) => id === region.id) + 1);

  const selectFromTable = (region: FootprintRegion) => {
    selected = region;
    mapSection?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    map?.flyTo(region);
  };

  const toggleHidden = async (region: FootprintRegion) => {
    const hiddenRegionIds = region.hidden
      ? hidden.filter(({ id }) => id !== region.id).map(({ id }) => id)
      : [...hidden.map(({ id }) => id), region.id];
    try {
      const response = await updateMyPreferences({ userPreferencesUpdateDto: { footprints: { hiddenRegionIds } } });
      authManager.setPreferences(response);
      const ids = new Set(response.footprints.hiddenRegionIds);
      regions = regions.map((row) => ({ ...row, hidden: ids.has(row.id) }));
      if (selected?.id === region.id) {
        selected = ids.has(region.id) ? undefined : regions.find(({ id }) => id === region.id);
      }
    } catch (error) {
      handleError(error, $t('errors.unable_to_update_settings'));
    }
  };
</script>

<UserPageLayout title={data.meta.title}>
  {#snippet buttons()}
    <Button href={Route.trips()} size="small" variant="ghost" color="secondary" leadingIcon={mdiAirplane}>
      {$t('trips')}
    </Button>
  {/snippet}

  {#if data.footprints.pendingCount > 0}
    <p class="mx-4 mb-2 rounded-xl bg-subtle px-4 py-2 text-sm">
      {$t('footprints_pending', { values: { count: data.footprints.pendingCount } })}
    </p>
  {/if}

  {#if regions.length === 0}
    <p class="p-8 text-center text-gray-500 dark:text-gray-300">{$t('footprints_empty')}</p>
  {:else}
    <section
      bind:this={mapSection}
      class="relative h-[calc(100dvh-var(--navbar-height)-4rem)] min-h-96 overflow-hidden"
    >
      <FootprintMap
        bind:this={map}
        {regions}
        shapes={data.shapes}
        year={replayYear}
        selectedId={selected?.id}
        onSelect={(region) => (selected = region)}
      />

      <div
        class="absolute inset-s-4 top-4 max-w-[calc(100%-5rem)] rounded-2xl bg-light/90 p-4 shadow-lg backdrop-blur-sm"
      >
        <p class="text-sm text-gray-500 dark:text-gray-300">
          {replayYear ? $t('footprints_as_of', { values: { year: replayYear } }) : $t('footprints_so_far')}
        </p>
        <div class="flex flex-wrap gap-x-5 gap-y-1">
          <span><b class="text-3xl">{counts.countries}</b> {$t('footprints_countries')}</span>
          <span><b class="text-3xl">{counts.provinces}</b> {$t('footprints_provinces')}</span>
          <span><b class="text-3xl">{counts.regions}</b> {$t('footprints_cities')}</span>
        </div>
        {#if replayYear}
          <p class="mt-1 flex items-center gap-2 text-sm">
            <span class="inline-block size-3 rounded-sm bg-[#2a3585] dark:bg-[#dbe3ff]"></span>
            {$t('footprints_new_in_year', { values: { year: replayYear, count: newThisYear } })}
          </p>
        {/if}
        {#if hidden.length > 0}
          <details class="mt-2 text-sm">
            <summary class="cursor-pointer text-gray-500 dark:text-gray-300">
              {$t('footprints_hidden_count', { values: { count: hidden.length } })}
            </summary>
            <ul class="mt-1 flex flex-col gap-1">
              {#each hidden as region (region.id)}
                <li class="flex items-center justify-between gap-3">
                  <span>{placeName(region, $lang)}</span>
                  <button type="button" class="text-primary underline" onclick={() => toggleHidden(region)}>
                    {$t('footprints_show_region')}
                  </button>
                </li>
              {/each}
            </ul>
          </details>
        {/if}
      </div>

      <div
        class="absolute inset-s-1/2 bottom-6 flex w-[min(40rem,calc(100%-2rem))] -translate-x-1/2 items-center gap-3 rounded-full bg-light/90 px-4 py-2 shadow-lg backdrop-blur-sm rtl:translate-x-1/2"
      >
        <Button
          size="small"
          variant="ghost"
          leadingIcon={playing ? mdiPause : mdiPlay}
          onclick={() => (playing ? stop() : play())}
        >
          {$t('footprints_replay')}
        </Button>
        <input
          class="grow accent-primary"
          type="range"
          min="0"
          max={years.length}
          value={replayIndex ?? years.length}
          aria-label={$t('footprints_replay')}
          oninput={(event) => {
            stop();
            const value = Number(event.currentTarget.value);
            replayIndex = value >= years.length ? undefined : value;
          }}
        />
        <span class="w-12 text-end text-sm font-medium">{replayYear ?? $t('footprints_now')}</span>
      </div>
    </section>

    <section class="grid gap-6 p-4 lg:grid-cols-[2fr_3fr]">
      <NewRegionsChart {years} selected={tableYear} onSelect={(year) => (tableYear = year)} />

      <div class="overflow-x-auto">
        <div class="mb-2 flex flex-wrap items-center gap-3 text-sm">
          <span class="font-medium">
            {tableYear
              ? $t('footprints_first_visited_in', { values: { year: tableYear, count: rows.length } })
              : $t('footprints_all_regions', { values: { count: rows.length } })}
          </span>
          <label class="ms-auto flex items-center gap-2">
            {$t('footprints_sort')}
            <select
              bind:value={sortKey}
              class="rounded-lg border border-gray-300 bg-light px-2 py-1 dark:border-gray-600"
            >
              <option value="firstVisit">{$t('footprints_first_visit')}</option>
              <option value="assetCount">{$t('photos')}</option>
              <option value="name">{$t('name')}</option>
            </select>
          </label>
        </div>
        <table class="w-full text-sm">
          <thead class="text-start text-gray-500 dark:text-gray-300">
            <tr>
              <th class="py-1 text-start font-normal">{$t('footprints_city')}</th>
              <th class="py-1 text-start font-normal">{$t('footprints_province')}</th>
              <th class="py-1 text-start font-normal">{$t('footprints_country')}</th>
              <th class="py-1 text-start font-normal">{$t('footprints_first_visit')}</th>
              <th class="py-1 text-end font-normal">{$t('photos')}</th>
            </tr>
          </thead>
          <tbody>
            {#each rows as region (region.id)}
              <tr
                class="cursor-pointer border-t border-gray-200 hover:bg-subtle dark:border-gray-700 {selected?.id ===
                region.id
                  ? 'bg-subtle font-medium'
                  : ''}"
                onclick={() => selectFromTable(region)}
              >
                <td class="py-1.5">
                  <button
                    type="button"
                    class="text-start"
                    onclick={(event) => {
                      event.stopPropagation();
                      selectFromTable(region);
                    }}
                  >
                    {placeName(region, $lang)}
                  </button>
                </td>
                <td>{region.province ? placeName(region.province, $lang) : ''}</td>
                <td>{placeName(region.country, $lang)}</td>
                <td>{formatVisitDate(region.firstVisitAt, $locale)}</td>
                <td class="text-end tabular-nums">{region.assetCount.toLocaleString($locale)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>
  {/if}
</UserPageLayout>

{#if selected}
  <RegionDrawer
    region={selected}
    rank={rankOf(selected)}
    onClose={() => (selected = undefined)}
    onToggleHidden={toggleHidden}
  />
{/if}
