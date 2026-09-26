<script lang="ts">
  // PROTOTYPE variant B: map first. Click the map to drop a home; homes are cards beside the map.
  import { Button, Input, NumberInput, Switch, toastManager } from '@immich/ui';
  import { addHome, removeHome, tripState } from './state.svelte';

  let selectedId = $state<number | undefined>(tripState.homes[0]?.id);
  const selected = $derived(tripState.homes.find((home) => home.id === selectedId));
  const markers = $derived(
    tripState.homes.map((home) => ({
      id: String(home.id),
      lat: home.lat,
      lon: home.lng,
      city: home.name,
      state: null,
      country: null,
    })),
  );

  const onClickPoint = (point: { lat: number; lng: number }) => {
    if (selected) {
      selected.lat = point.lat;
      selected.lng = point.lng;
    } else {
      addHome(point);
      selectedId = tripState.homes.at(-1)?.id;
    }
  };
</script>

<div class="mt-4 flex flex-col gap-3 sm:ms-4">
  <div class="flex items-center justify-between">
    <div class="flex items-center gap-3">
      <Switch bind:checked={tripState.enabled} />
      <span class="text-sm">自动识别旅行 · 上次运行 {tripState.lastRun}</span>
    </div>
    <Button size="small" variant="outline" onclick={() => toastManager.primary('PROTOTYPE：已排队识别旅行')}>立即识别</Button>
  </div>

  <div class="grid gap-3 md:grid-cols-[1fr_280px]">
    <div class="h-[420px] overflow-hidden rounded-xl">
      {#await import('$lib/components/shared-components/map/Map.svelte') then { default: Map }}
        <Map
          mapMarkers={markers}
          zoom={5}
          center={{ lat: 30, lng: 120 }}
          simplified
          clickable
          {onClickPoint}
          showSettings={false}
          rounded
        />
      {/await}
    </div>

    <div class="flex flex-col gap-2">
      <p class="text-xs text-gray-500">选中一个家后点地图改位置；未选中时点地图新建</p>
      {#each tripState.homes as home (home.id)}
        <div
          role="button"
          tabindex="0"
          class="rounded-xl border p-3 text-sm {selectedId === home.id ? 'border-primary ring-1 ring-primary' : ''}"
          onclick={() => (selectedId = home.id)}
          onkeydown={() => (selectedId = home.id)}
        >
          <Input bind:value={home.name} />
          <p class="mt-1 text-xs text-gray-500">{home.lat.toFixed(3)}, {home.lng.toFixed(3)}</p>
          <div class="mt-2 flex items-center gap-2">
            <span class="text-xs">半径</span>
            <div class="w-20"><NumberInput bind:value={home.radiusKm} min={1} /></div>
            <span class="text-xs">km</span>
          </div>
          <div class="mt-2 flex gap-1 text-xs">
            <input type="date" class="w-full rounded border px-1 dark:bg-gray-800" bind:value={home.from} />
            <input type="date" class="w-full rounded border px-1 dark:bg-gray-800" bind:value={home.to} />
          </div>
          <Button class="mt-2" size="tiny" variant="ghost" color="danger" onclick={() => removeHome(home.id)}>删除</Button>
        </div>
      {/each}
      <Button size="small" variant="outline" onclick={() => (selectedId = undefined)}>+ 在地图上点选新家</Button>
    </div>
  </div>

  <details class="text-sm">
    <summary class="cursor-pointer text-gray-500">高级</summary>
    <div class="mt-2 grid grid-cols-3 gap-3">
      <label class="flex items-center gap-2">包含一日游 <Switch bind:checked={tripState.includeDayTrips} /></label>
      <label class="flex items-center gap-2">最长间隔 h <NumberInput bind:value={tripState.gapHours} /></label>
      <label class="flex items-center gap-2">最少张数 <NumberInput bind:value={tripState.minAssets} /></label>
    </div>
  </details>
</div>
