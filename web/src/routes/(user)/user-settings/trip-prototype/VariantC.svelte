<script lang="ts">
  // PROTOTYPE variant C: preview first. Few inputs on top, a live "what would be detected" list below,
  // homes shown as a timeline of periods. Preview uses synthetic data.
  import GeolocationPointPickerModal from '$lib/modals/GeolocationPointPickerModal.svelte';
  import { Button, NumberInput, Switch, modalManager, toastManager } from '@immich/ui';
  import { addHome, previewTrips, removeHome, tripState } from './state.svelte';

  const trips = $derived(previewTrips());
  const total = $derived(trips.reduce((sum, trip) => sum + trip.count, 0));

  const pickNew = async () => {
    const point = await modalManager.show(GeolocationPointPickerModal, {});
    if (point) {
      addHome(point);
    }
  };
</script>

<div class="mt-4 flex flex-col gap-4 sm:ms-4">
  <div class="flex flex-wrap items-center gap-4 rounded-xl bg-gray-100 p-4 dark:bg-gray-800">
    <Switch bind:checked={tripState.enabled} />
    <span class="text-sm">自动识别旅行</span>
    <span class="text-sm">离家 &gt;</span>
    <div class="w-20"><NumberInput bind:value={tripState.homes[0].radiusKm} /></div>
    <span class="text-sm">km · 至少</span>
    <div class="w-20"><NumberInput bind:value={tripState.minAssets} /></div>
    <span class="text-sm">张 · 一日游</span>
    <Switch bind:checked={tripState.includeDayTrips} />
  </div>

  <div>
    <p class="mb-2 text-sm font-medium">家的时间线</p>
    <div class="flex flex-col gap-1">
      {#each tripState.homes as home (home.id)}
        <div class="flex items-center gap-2 text-sm">
          <span class="w-20 truncate">{home.name}</span>
          <div class="h-6 flex-1 rounded bg-primary/30 px-2 text-xs leading-6">
            {home.from || '一直'} → {home.to || '至今'} · {home.lat.toFixed(2)}, {home.lng.toFixed(2)} · {home.radiusKm}km
          </div>
          <Button size="tiny" variant="ghost" color="danger" onclick={() => removeHome(home.id)}>×</Button>
        </div>
      {/each}
    </div>
    <Button class="mt-2" size="small" variant="outline" onclick={pickNew}>+ 添加家（地图选点）</Button>
  </div>

  <div>
    <div class="mb-2 flex items-center justify-between">
      <p class="text-sm font-medium">按当前设置会识别出 {trips.length} 次旅行 · {total} 张</p>
      <Button size="small" onclick={() => toastManager.primary('PROTOTYPE：已按这些设置排队识别')}>保存并识别</Button>
    </div>
    <div class="max-h-80 overflow-y-auto rounded-xl border text-sm">
      {#each trips as trip (trip.start + trip.name)}
        <div class="flex justify-between border-b px-3 py-1.5 last:border-0">
          <span>{trip.name}</span>
          <span class="text-gray-500">{trip.days} 天 · {trip.count} 张 · {trip.farKm} km</span>
        </div>
      {/each}
    </div>
    <p class="mt-1 text-xs text-gray-500">PROTOTYPE：预览是合成的假数据</p>
  </div>
</div>
