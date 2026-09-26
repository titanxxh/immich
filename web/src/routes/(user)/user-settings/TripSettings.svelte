<script lang="ts">
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import GeolocationPointPickerModal from '$lib/modals/GeolocationPointPickerModal.svelte';
  import { handleError } from '$lib/utils/handle-error';
  import {
    detectTrips,
    previewTrips,
    updateMyPreferences,
    type TripHome,
    type TripPreviewDto,
    type TripPreviewResponseDto,
  } from '@immich/sdk';
  import {
    Button,
    Field,
    IconButton,
    Input,
    LoadingSpinner,
    NumberInput,
    Switch,
    modalManager,
    toastManager,
  } from '@immich/ui';
  import { mdiDeleteOutline, mdiMapMarkerOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';
  import { fade } from 'svelte/transition';

  const PREVIEW_DELAY = 500;

  let enabled = $state(authManager.preferences.trips.enabled);
  let homes = $state<TripHome[]>(authManager.preferences.trips.homes.map((home) => ({ ...home })));
  let minAssets = $state(authManager.preferences.trips.minAssets);
  let includeDayTrips = $state(authManager.preferences.trips.includeDayTrips);

  let preview = $state<TripPreviewResponseDto[]>([]);
  let isPreviewLoading = $state(false);
  const previewAssetCount = $derived(preview.reduce((sum, trip) => sum + trip.assetCount, 0));

  // the date inputs give '' for an empty date, which the API does not accept
  const getHomes = () => homes.map((home) => ({ ...home, from: home.from || null, to: home.to || null }));

  let previewRequest = 0;
  const loadPreview = async (dto: TripPreviewDto, request: number) => {
    isPreviewLoading = true;
    try {
      const trips = await previewTrips({ tripPreviewDto: dto });
      if (request === previewRequest) {
        preview = trips;
      }
    } catch (error) {
      handleError(error, $t('errors.unable_to_load_trips_preview'));
    } finally {
      if (request === previewRequest) {
        isPreviewLoading = false;
      }
    }
  };

  $effect(() => {
    const dto = { homes: getHomes(), minAssets: minAssets ?? 1, includeDayTrips };
    const request = ++previewRequest;
    if (dto.homes.length === 0) {
      preview = [];
      return;
    }

    const timeout = setTimeout(() => void loadPreview(dto, request), PREVIEW_DELAY);
    return () => clearTimeout(timeout);
  });

  const handleAddHome = async () => {
    const point = await modalManager.show(GeolocationPointPickerModal, {});
    if (!point) {
      return;
    }

    homes.push({
      name: $t('trips_home_default_name', { values: { number: homes.length + 1 } }),
      latitude: point.lat,
      longitude: point.lng,
      radiusKm: 50,
      from: null,
      to: null,
    });
  };

  const handleMoveHome = async (home: TripHome) => {
    const point = await modalManager.show(GeolocationPointPickerModal, {
      point: { lat: home.latitude, lng: home.longitude },
    });
    if (point) {
      home.latitude = point.lat;
      home.longitude = point.lng;
    }
  };

  const handleRemoveHome = (index: number) => {
    homes.splice(index, 1);
  };

  const handleSave = async () => {
    try {
      const response = await updateMyPreferences({
        userPreferencesUpdateDto: { trips: { enabled, homes: getHomes(), minAssets, includeDayTrips } },
      });
      authManager.setPreferences(response);

      if (enabled) {
        await detectTrips();
        toastManager.primary($t('trips_detect_queued'));
      } else {
        toastManager.primary($t('saved_settings'));
      }
    } catch (error) {
      handleError(error, $t('errors.unable_to_update_settings'));
    }
  };

  const onsubmit = (event: Event) => {
    event.preventDefault();
  };
</script>

<section class="my-4">
  <div in:fade={{ duration: 500 }}>
    <form autocomplete="off" {onsubmit} class="mt-4 flex flex-col gap-6 sm:ms-8">
      <div class="grid gap-4 sm:grid-cols-3">
        <Field label={$t('trips_enabled')}>
          <Switch bind:checked={enabled} />
        </Field>
        <Field label={$t('trips_min_assets')}>
          <NumberInput min={1} bind:value={minAssets} />
        </Field>
        <Field label={$t('trips_include_day_trips')}>
          <Switch bind:checked={includeDayTrips} />
        </Field>
      </div>

      <div class="flex flex-col gap-2">
        <p class="text-sm font-medium">{$t('trips_homes')}</p>
        <p class="text-sm text-gray-500 dark:text-gray-300">{$t('trips_homes_description')}</p>
        {#each homes as home, index (index)}
          <div class="flex flex-col gap-2 rounded-xl bg-gray-100 p-3 dark:bg-gray-800">
            <div class="flex items-end gap-2">
              <Field label={$t('name')} class="flex-1">
                <Input bind:value={home.name} />
              </Field>
              <Field label={$t('trips_home_radius')} class="w-28">
                <NumberInput min={1} bind:value={home.radiusKm} />
              </Field>
              <IconButton
                shape="round"
                color="danger"
                variant="ghost"
                icon={mdiDeleteOutline}
                aria-label={$t('trips_remove_home')}
                onclick={() => handleRemoveHome(index)}
              />
            </div>
            <div class="flex flex-wrap items-end gap-2">
              <Field label={$t('trips_home_from')} class="w-40">
                <Input type="date" bind:value={() => home.from ?? '', (value) => (home.from = value)} />
              </Field>
              <Field label={$t('trips_home_to')} class="w-40">
                <Input type="date" bind:value={() => home.to ?? '', (value) => (home.to = value)} />
              </Field>
              <Button
                size="small"
                variant="ghost"
                leadingIcon={mdiMapMarkerOutline}
                onclick={() => handleMoveHome(home)}
                title={$t('trips_move_home')}
              >
                {home.latitude.toFixed(3)}, {home.longitude.toFixed(3)}
              </Button>
            </div>
          </div>
        {/each}
        <div>
          <Button size="small" variant="outline" onclick={handleAddHome}>{$t('trips_add_home')}</Button>
        </div>
      </div>

      <div class="flex flex-col gap-2">
        <div class="flex items-center justify-between gap-2">
          <p class="flex items-center gap-2 text-sm font-medium">
            {#if homes.length === 0}
              {$t('trips_preview_no_home')}
            {:else if preview.length === 0 && isPreviewLoading}
              {$t('trips_preview_loading')}
            {:else if preview.length === 0}
              {$t('trips_preview_empty')}
            {:else}
              {$t('trips_preview_count', { values: { count: preview.length, assets: previewAssetCount } })}
            {/if}
            {#if isPreviewLoading}
              <LoadingSpinner size="small" />
            {/if}
          </p>
          <Button size="small" onclick={handleSave}>{$t('trips_save_and_detect')}</Button>
        </div>
        {#if preview.length > 0}
          <div class="max-h-80 overflow-y-auto rounded-xl border text-sm dark:border-gray-700">
            {#each preview as trip (trip.startAt)}
              <div class="flex justify-between gap-2 border-b px-3 py-1.5 last:border-0 dark:border-gray-700">
                <span>{trip.name}</span>
                <span class="shrink-0 text-gray-500 dark:text-gray-300">
                  {$t('trips_days', { values: { count: trip.days } })} · {$t('trips_photos', {
                    values: { count: trip.assetCount },
                  })}
                </span>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </form>
  </div>
</section>
