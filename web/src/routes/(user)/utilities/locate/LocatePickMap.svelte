<script lang="ts" module>
  import { addProtocol, setWorkerUrl } from 'maplibre-gl';
  import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
  import { Protocol } from 'pmtiles';

  setWorkerUrl(workerUrl);
  void addProtocol('pmtiles', new Protocol().tile);
</script>

<script lang="ts">
  import { serverConfigManager } from '$lib/managers/server-config-manager.svelte';
  import { mapSettings } from '$lib/stores/preferences.store';
  import type { LatLng } from '$lib/types';
  import { Theme, themeManager } from '@immich/ui';
  import { MapLibre, Marker, NavigationControl } from 'svelte-maplibre';

  type Props = { point?: LatLng; class?: string; onPick: (point: LatLng) => void };
  let { point, class: className = 'h-80', onPick }: Props = $props();

  const mapTheme = $derived($mapSettings.allowDarkMode ? themeManager.value : Theme.Light);
  const styleUrl = $derived(
    mapTheme === Theme.Dark ? serverConfigManager.value.mapDarkStyleUrl : serverConfigManager.value.mapLightStyleUrl,
  );
</script>

<div class={className}>
  <MapLibre
    style={styleUrl}
    class="h-full rounded-2xl"
    center={point ? [point.lng, point.lat] : [110, 32]}
    zoom={point ? 13 : 3}
    attributionControl={false}
    onclick={(event) => onPick({ lat: event.lngLat.lat, lng: event.lngLat.lng })}
  >
    <NavigationControl position="top-left" showCompass={false} />
    {#if point}
      <Marker lngLat={[point.lng, point.lat]}>
        <div class="size-5 rounded-full border-2 border-white bg-red-500 shadow-sm"></div>
      </Marker>
    {/if}
  </MapLibre>
</div>
