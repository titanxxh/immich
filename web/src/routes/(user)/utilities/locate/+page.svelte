<script lang="ts">
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import GeolocationPointPickerModal from '$lib/modals/GeolocationPointPickerModal.svelte';
  import LocatePickMap from './LocatePickMap.svelte';
  import { locale } from '$lib/stores/preferences.store';
  import type { LatLng } from '$lib/types';
  import { getAssetMediaUrl } from '$lib/utils';
  import { handleError } from '$lib/utils/handle-error';
  import {
    AssetMediaSize,
    getLocateGroups,
    getLocateSuggestion,
    ignoreLocateAssets,
    updateAssets,
    type LocateGroupsResponseDto,
    type LocateSuggestionDto,
  } from '@immich/sdk';
  import { Button, LoadingSpinner, Switch, modalManager, toastManager } from '@immich/ui';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';

  type Item = { key: string; assetIds: string[]; startAt?: string; endAt?: string };

  const SCATTERED = 'scattered';

  let data = $state<LocateGroupsResponseDto>();
  let isBySize = $state(true);
  let currentKey = $state<string>();
  let selected = $state(new Set<string>());
  let point = $state<LatLng>();
  let suggestion = $state<LocateSuggestionDto | null>();
  let isSaving = $state(false);

  const items = $derived.by<Item[]>(() => {
    if (!data) {
      return [];
    }
    const groups = data.groups.map((group) => ({ key: group.id, ...group }));
    if (!isBySize) {
      groups.sort((a, b) => a.startAt.localeCompare(b.startAt));
    }
    return data.scattered.length > 0 ? [...groups, { key: SCATTERED, assetIds: data.scattered }] : groups;
  });
  const current = $derived(items.find((item) => item.key === currentKey) ?? items[0]);
  const photoCount = $derived(items.reduce((sum, item) => sum + item.assetIds.length, 0));
  const groupCount = $derived(data?.groups.length ?? 0);

  const load = async () => {
    try {
      data = await getLocateGroups();
    } catch (error) {
      handleError(error, $t('errors.unable_to_load_photos_to_locate'));
    }
  };

  onMount(load);

  // a new group starts with all its photos selected (scattered photos with none) and asks for a suggestion
  $effect(() => {
    const item = current;
    selected = new Set(item && item.key !== SCATTERED ? item.assetIds : []);
    anchorIndex = undefined;
    point = undefined;
    suggestion = undefined;
    if (!item) {
      return;
    }

    void getLocateSuggestion({ locateAssetIdsDto: { assetIds: item.assetIds } })
      .then((response) => {
        if (item !== current) {
          return;
        }
        suggestion = response.suggestion;
        point = response.suggestion
          ? { lat: response.suggestion.latitude, lng: response.suggestion.longitude }
          : undefined;
      })
      .catch(() => (suggestion = null));
  });

  const formatTime = (time: string, withYear: boolean) =>
    new Date(time).toLocaleString($locale, {
      timeZone: 'UTC',
      year: withYear ? 'numeric' : undefined,
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

  const getTitle = (item: Item) =>
    item.key === SCATTERED || !item.startAt || !item.endAt
      ? $t('locate_scattered')
      : `${formatTime(item.startAt, true)} – ${formatTime(item.endAt, false)}`;

  // the last photo clicked without shift, from which a shift-click selects or deselects a whole run
  let anchorIndex = $state<number>();

  const handlePhotoClick = (index: number, event: MouseEvent) => {
    const ids = current?.assetIds ?? [];
    if (event.shiftKey && anchorIndex !== undefined && anchorIndex < ids.length) {
      const run = new Set(ids.slice(Math.min(anchorIndex, index), Math.max(anchorIndex, index) + 1));
      // the run takes the state of the anchor, so a run can be selected as well as deselected
      const shouldSelect = selected.has(ids[anchorIndex]);
      selected = new Set(ids.filter((id) => (run.has(id) ? shouldSelect : selected.has(id))));
      return;
    }

    const id = ids[index];
    selected = selected.has(id) ? new Set([...selected].filter((other) => other !== id)) : new Set([...selected, id]);
    anchorIndex = index;
  };

  /** After a change, stay on what is left of the group, or move on to the next one. */
  const reload = async (handled: Set<string>) => {
    const rest = current?.assetIds.find((id) => !handled.has(id));
    await load();
    currentKey = rest ? items.find((item) => item.assetIds.includes(rest))?.key : undefined;
  };

  const handleApply = async () => {
    if (!point || selected.size === 0) {
      return;
    }
    isSaving = true;
    try {
      const ids = [...selected];
      await updateAssets({ assetBulkUpdateDto: { ids, latitude: point.lat, longitude: point.lng } });
      toastManager.primary($t('locate_applied', { values: { count: ids.length } }));
      await reload(selected);
    } catch (error) {
      handleError(error, $t('errors.unable_to_locate_photos'));
    } finally {
      isSaving = false;
    }
  };

  const handleIgnore = async () => {
    if (selected.size === 0) {
      return;
    }
    isSaving = true;
    try {
      const ids = [...selected];
      await ignoreLocateAssets({ locateAssetIdsDto: { assetIds: ids } });
      toastManager.primary($t('locate_ignored', { values: { count: ids.length } }));
      await reload(selected);
    } catch (error) {
      handleError(error, $t('errors.unable_to_ignore_photos_to_locate'));
    } finally {
      isSaving = false;
    }
  };

  const handleSearch = async () => {
    const picked = await modalManager.show(GeolocationPointPickerModal, { point });
    if (picked) {
      point = picked;
      suggestion = null;
    }
  };

  const hint = $derived.by(() => {
    if (suggestion === undefined) {
      return '';
    }
    if (suggestion && point?.lat === suggestion.latitude && point.lng === suggestion.longitude) {
      return suggestion.source === 'directory' ? $t('locate_suggestion_directory') : $t('locate_suggestion_time');
    }
    return point ? $t('locate_point_chosen') : $t('locate_no_suggestion');
  });
</script>

<UserPageLayout title={$t('locate_photos')}>
  {#if !data}
    <div class="flex justify-center p-8"><LoadingSpinner /></div>
  {:else if items.length === 0}
    <p class="p-8 text-center text-gray-500 dark:text-gray-300">{$t('locate_done')}</p>
  {:else}
    <div class="grid h-[calc(100dvh-var(--navbar-height)-4rem)] gap-4 p-4 md:grid-cols-[320px_1fr]">
      <div class="flex min-h-0 flex-col">
        <div class="mb-2 flex items-center justify-between gap-2 text-sm">
          <span>{$t('locate_summary', { values: { groups: groupCount, photos: photoCount } })}</span>
          <label class="flex items-center gap-2">
            {$t('locate_largest_first')}
            <Switch bind:checked={isBySize} />
          </label>
        </div>
        <div class="min-h-0 flex-1 overflow-y-auto">
          {#each items as item (item.key)}
            <button
              type="button"
              class="flex w-full items-center gap-2 rounded-xl p-1.5 text-start text-sm hover:bg-subtle {item ===
              current
                ? 'bg-primary/10'
                : ''}"
              onclick={() => (currentKey = item.key)}
            >
              <img
                class="size-12 shrink-0 rounded-lg object-cover"
                alt=""
                loading="lazy"
                src={getAssetMediaUrl({ id: item.assetIds[0], size: AssetMediaSize.Thumbnail })}
              />
              <span class="min-w-0">
                <span class="block truncate">{getTitle(item)}</span>
                <span class="text-gray-500 dark:text-gray-300">
                  {$t('trips_photos', { values: { count: item.assetIds.length } })}
                </span>
              </span>
            </button>
          {/each}
        </div>
      </div>

      {#if current}
        <div class="grid min-h-0 gap-4 overflow-y-auto xl:grid-cols-[1fr_440px]">
          <div>
            <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h2 class="text-lg font-medium">
                {getTitle(current)} · {$t('trips_photos', { values: { count: current.assetIds.length } })}
              </h2>
              <div class="flex gap-1">
                <Button size="small" variant="ghost" onclick={() => (selected = new Set(current.assetIds))}>
                  {$t('select_all')}
                </Button>
                <Button size="small" variant="ghost" onclick={() => (selected = new Set())}>
                  {$t('unselect_all')}
                </Button>
              </div>
            </div>
            {#if current.key === SCATTERED}
              <p class="mb-2 text-sm text-gray-500 dark:text-gray-300">{$t('locate_scattered_description')}</p>
            {/if}
            <p class="mb-2 text-sm text-gray-500 dark:text-gray-300">{$t('locate_range_hint')}</p>
            <div class="flex flex-wrap gap-1">
              {#each current.assetIds as id, index (id)}
                <button
                  type="button"
                  class="relative size-24"
                  onmousedown={(event) => event.shiftKey && event.preventDefault()}
                  onclick={(event) => handlePhotoClick(index, event)}
                >
                  <img
                    class="size-full rounded-sm object-cover {selected.has(id) ? '' : 'opacity-40 grayscale'}"
                    alt=""
                    loading="lazy"
                    src={getAssetMediaUrl({ id, size: AssetMediaSize.Thumbnail })}
                  />
                  {#if selected.has(id)}
                    <span class="absolute inset-e-1 top-1 size-4 rounded-full border-2 border-white bg-primary"></span>
                  {/if}
                </button>
              {/each}
            </div>
          </div>

          <div class="flex flex-col gap-2">
            <LocatePickMap {point} class="h-96" onPick={(picked) => (point = picked)} />
            <p class="text-sm text-gray-500 dark:text-gray-300">{hint}</p>
            <div class="flex flex-wrap gap-2">
              <Button disabled={!point || selected.size === 0 || isSaving} onclick={handleApply}>
                {$t('locate_apply', { values: { count: selected.size } })}
              </Button>
              <Button variant="outline" onclick={handleSearch}>{$t('locate_search_place')}</Button>
              <Button variant="ghost" color="danger" disabled={selected.size === 0 || isSaving} onclick={handleIgnore}>
                {$t('locate_ignore')}
              </Button>
            </div>
          </div>
        </div>
      {/if}
    </div>
  {/if}
</UserPageLayout>
