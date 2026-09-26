<script lang="ts" module>
  import { addProtocol, setWorkerUrl } from 'maplibre-gl';
  import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
  import { Protocol } from 'pmtiles';

  setWorkerUrl(workerUrl);
  void addProtocol('pmtiles', new Protocol().tile);
</script>

<script lang="ts">
  // PROTOTYPE variant C: one big map with a dot per trip, coloured by year, and a compact list beside it.
  import { goto } from '$app/navigation';
  import { serverConfigManager } from '$lib/managers/server-config-manager.svelte';
  import { getAlbumMapMarkers } from '@immich/sdk';
  import { Theme, themeManager } from '@immich/ui';
  import { CircleLayer, GeoJSON, MapLibre, NavigationControl } from 'svelte-maplibre';
  import { formatRange, groupByYear, type TripItem } from './types';

  let { trips }: { trips: TripItem[] } = $props();
  let hovered = $state<string>();

  const styleUrl = $derived(
    themeManager.value === Theme.Dark
      ? serverConfigManager.value.mapDarkStyleUrl
      : serverConfigManager.value.mapLightStyleUrl,
  );
  const years = $derived([...new Set(trips.map((trip) => trip.year))]);
  const COLORS = [
    '#e6194b',
    '#3cb44b',
    '#4363d8',
    '#f58231',
    '#911eb4',
    '#42d4f4',
    '#f032e6',
    '#9a6324',
    '#469990',
    '#800000',
  ];
  const colorOf = (year: string) => COLORS[years.indexOf(year) % COLORS.length];

  const loadPoints = async () => {
    const features = await Promise.all(
      trips.map(async (trip) => {
        const markers = await getAlbumMapMarkers({ id: trip.album.id });
        if (markers.length === 0) {
          return;
        }
        const lat = markers.reduce((sum, marker) => sum + marker.lat, 0) / markers.length;
        const lon = markers.reduce((sum, marker) => sum + marker.lon, 0) / markers.length;
        return {
          type: 'Feature' as const,
          properties: { id: trip.album.id, color: colorOf(trip.year), size: 5 + Math.min(trip.days, 15) },
          geometry: { type: 'Point' as const, coordinates: [lon, lat] },
        };
      }),
    );
    return { type: 'FeatureCollection' as const, features: features.filter((feature) => feature !== undefined) };
  };
</script>

<div class="grid h-[calc(100dvh-10rem)] gap-4 md:grid-cols-[1fr_340px]">
  <div class="min-h-80">
    {#await loadPoints()}
      <p class="text-sm text-gray-500">正在计算每次旅行的位置…</p>
    {:then points}
      <MapLibre style={styleUrl} class="h-full rounded-2xl" center={[110, 30]} zoom={2.5} attributionControl={false}>
        <NavigationControl position="top-left" showCompass={false} />
        <GeoJSON data={points}>
          <CircleLayer
            hoverCursor="pointer"
            onclick={(event) => goto(`/albums/${event.features[0]?.properties?.id}`)}
            onmousemove={(event) => (hovered = event.features[0]?.properties?.id as string)}
            onmouseleave={() => (hovered = undefined)}
            paint={{
              'circle-color': ['get', 'color'],
              'circle-radius': ['get', 'size'],
              'circle-opacity': 0.75,
              'circle-stroke-color': '#fff',
              'circle-stroke-width': 1.5,
            }}
          />
        </GeoJSON>
      </MapLibre>
    {/await}
  </div>
  <div class="overflow-y-auto">
    {#each groupByYear(trips) as [year, items] (year)}
      <p class="mt-3 mb-1 flex items-center gap-2 font-medium">
        <span class="inline-block size-3 rounded-full" style="background: {colorOf(year)}"></span>{year}
      </p>
      {#each items as trip (trip.album.id)}
        <a
          href="/albums/{trip.album.id}"
          class="block rounded-lg px-2 py-1 text-sm hover:bg-subtle {hovered === trip.album.id ? 'bg-primary/10' : ''}"
        >
          {trip.place} <span class="text-gray-500">· {formatRange(trip)} · {trip.days} 天</span>
        </a>
      {/each}
    {/each}
  </div>
</div>
