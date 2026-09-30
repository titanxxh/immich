<script lang="ts">
  import GeolocationPointPickerModal from '$lib/modals/GeolocationPointPickerModal.svelte';
  import { locale } from '$lib/stores/preferences.store';
  import type { LatLng } from '$lib/types';
  import { getAssetMediaUrl } from '$lib/utils';
  import { handleError } from '$lib/utils/handle-error';
  import {
    AssetMediaSize,
    confirmLocateSuspects,
    getLocateSuspects,
    updateAssets,
    type LocateSuspectDto,
  } from '@immich/sdk';
  import { Button, LoadingSpinner, modalManager, toastManager } from '@immich/ui';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import LocatePickMap from './LocatePickMap.svelte';

  type Props = { onCount?: (count: number) => void };
  let { onCount }: Props = $props();

  let suspects = $state<LocateSuspectDto[]>();
  let currentId = $state<string>();
  let isSaving = $state(false);

  const current = $derived(suspects?.find((suspect) => suspect.assetId === currentId) ?? suspects?.[0]);

  const load = async () => {
    try {
      ({ suspects } = await getLocateSuspects());
      onCount?.(suspects.length);
    } catch (error) {
      handleError(error, $t('errors.unable_to_load_suspect_locations'));
    }
  };

  onMount(load);

  // each photo starts from where it is placed now
  let point = $derived<LatLng | undefined>(current ? { lat: current.latitude, lng: current.longitude } : undefined);

  const formatTime = (time: string) =>
    new Date(time).toLocaleString($locale, {
      timeZone: 'UTC',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

  /** After a change, move on to the next photo. */
  const next = async () => {
    const index = suspects && current ? suspects.indexOf(current) : -1;
    const following = suspects?.[index + 1]?.assetId;
    await load();
    currentId = following;
  };

  const handleApply = async () => {
    if (!current || !point) {
      return;
    }
    isSaving = true;
    try {
      await updateAssets({ assetBulkUpdateDto: { ids: [current.assetId], latitude: point.lat, longitude: point.lng } });
      toastManager.primary($t('locate_applied', { values: { count: 1 } }));
      await next();
    } catch (error) {
      handleError(error, $t('errors.unable_to_locate_photos'));
    } finally {
      isSaving = false;
    }
  };

  const handleConfirm = async () => {
    if (!current) {
      return;
    }
    isSaving = true;
    try {
      await confirmLocateSuspects({ locateAssetIdsDto: { assetIds: [current.assetId] } });
      toastManager.primary($t('locate_suspect_confirmed'));
      await next();
    } catch (error) {
      handleError(error, $t('errors.unable_to_confirm_suspect_locations'));
    } finally {
      isSaving = false;
    }
  };

  const handleSearch = async () => {
    const picked = await modalManager.show(GeolocationPointPickerModal, { point });
    if (picked) {
      point = picked;
    }
  };
</script>

{#if !suspects}
  <div class="flex justify-center p-8"><LoadingSpinner /></div>
{:else if suspects.length === 0 || !current}
  <p class="p-8 text-center text-gray-500 dark:text-gray-300">{$t('locate_suspects_none')}</p>
{:else}
  <div class="grid h-[calc(100dvh-var(--navbar-height)-7rem)] gap-4 p-4 md:grid-cols-[320px_1fr]">
    <div class="flex min-h-0 flex-col">
      <p class="mb-2 text-sm">{$t('locate_suspects_summary', { values: { count: suspects.length } })}</p>
      <div class="min-h-0 flex-1 overflow-y-auto">
        {#each suspects as suspect (suspect.assetId)}
          <button
            type="button"
            class="flex w-full items-center gap-2 rounded-xl p-1.5 text-start text-sm hover:bg-subtle {suspect ===
            current
              ? 'bg-primary/10'
              : ''}"
            onclick={() => (currentId = suspect.assetId)}
          >
            <img
              class="size-12 shrink-0 rounded-lg object-cover"
              alt=""
              loading="lazy"
              src={getAssetMediaUrl({ id: suspect.assetId, size: AssetMediaSize.Thumbnail })}
            />
            <span class="min-w-0">
              <span class="block truncate">{formatTime(suspect.localDateTime)}</span>
              <span class="block truncate text-gray-500 dark:text-gray-300">
                {suspect.place ?? '?'} ↔ {suspect.otherPlace ?? '?'}
              </span>
            </span>
          </button>
        {/each}
      </div>
    </div>

    <div class="grid min-h-0 gap-4 overflow-y-auto xl:grid-cols-[1fr_440px]">
      <div>
        <p class="mb-2 text-sm text-gray-500 dark:text-gray-300">{$t('locate_suspect_description')}</p>
        <div class="grid grid-cols-2 gap-2">
          {#each [{ id: current.assetId, label: $t('locate_suspect_this'), time: current.localDateTime, place: current.place }, { id: current.otherAssetId, label: $t('locate_suspect_other'), time: current.otherLocalDateTime, place: current.otherPlace }] as photo (photo.id)}
            <figure class="flex flex-col gap-1">
              <img
                class="aspect-square w-full rounded-lg bg-subtle object-contain"
                alt=""
                src={getAssetMediaUrl({ id: photo.id, size: AssetMediaSize.Preview })}
              />
              <figcaption class="text-sm">
                <span class="font-medium">{photo.label}</span>
                · {formatTime(photo.time)} · {photo.place ?? '?'}
              </figcaption>
            </figure>
          {/each}
        </div>
      </div>

      <div class="flex flex-col gap-2">
        <LocatePickMap {point} class="h-96" onPick={(picked) => (point = picked)} />
        <div class="flex flex-wrap gap-2">
          <Button
            disabled={!point || isSaving || (point.lat === current.latitude && point.lng === current.longitude)}
            onclick={handleApply}
          >
            {$t('locate_apply', { values: { count: 1 } })}
          </Button>
          <Button
            variant="outline"
            onclick={() => (point = { lat: current.otherLatitude, lng: current.otherLongitude })}
          >
            {$t('locate_suspect_use_other')}
          </Button>
          <Button variant="outline" onclick={handleSearch}>{$t('locate_search_place')}</Button>
          <Button variant="ghost" disabled={isSaving} onclick={handleConfirm}>{$t('locate_suspect_confirm')}</Button>
        </div>
      </div>
    </div>
  </div>
{/if}
