<script lang="ts" module>
  import { addProtocol, setWorkerUrl } from 'maplibre-gl';
  import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
  import { Protocol } from 'pmtiles';

  setWorkerUrl(workerUrl);
  void addProtocol('pmtiles', new Protocol().tile);
</script>

<script lang="ts">
  import { goto } from '$app/navigation';
  import { serverConfigManager } from '$lib/managers/server-config-manager.svelte';
  import { Route } from '$lib/route';
  import { mapSettings } from '$lib/stores/preferences.store';
  import type { TripResponseDto } from '@immich/sdk';
  import { Theme, themeManager } from '@immich/ui';
  import { LngLatBounds } from 'maplibre-gl';
  import { CircleLayer, GeoJSON, MapLibre, NavigationControl } from 'svelte-maplibre';
  import { getYearColor } from './trips';

  type Props = {
    trips: TripResponseDto[];
    years: string[];
    hoveredId?: string;
    onHover: (id?: string) => void;
  };

  let { trips, years, hoveredId, onHover }: Props = $props();

  const mapTheme = $derived($mapSettings.allowDarkMode ? themeManager.value : Theme.Light);
  const styleUrl = $derived(
    mapTheme === Theme.Dark ? serverConfigManager.value.mapDarkStyleUrl : serverConfigManager.value.mapLightStyleUrl,
  );

  const located = $derived(trips.filter((trip) => trip.point));

  const bounds = $derived.by(() => {
    const bounds = new LngLatBounds();
    for (const { point } of located) {
      bounds.extend([point!.longitude, point!.latitude]);
    }
    return bounds.isEmpty() ? undefined : bounds;
  });

  const points = $derived({
    type: 'FeatureCollection' as const,
    features: located.map((trip) => ({
      type: 'Feature' as const,
      properties: {
        id: trip.id,
        albumId: trip.albumId,
        color: getYearColor(years, trip.startAt.slice(0, 4)),
        size: 5 + Math.min(trip.dayCount, 15),
        hovered: trip.id === hoveredId,
      },
      geometry: { type: 'Point' as const, coordinates: [trip.point!.longitude, trip.point!.latitude] },
    })),
  });
</script>

<MapLibre
  style={styleUrl}
  class="h-full rounded-2xl"
  {bounds}
  fitBoundsOptions={{ padding: 60, maxZoom: 8 }}
  attributionControl={false}
>
  <NavigationControl position="top-left" showCompass={false} />
  <GeoJSON data={points}>
    <CircleLayer
      hoverCursor="pointer"
      onclick={(event) => goto(Route.viewAlbum({ id: event.features[0]?.properties?.albumId as string }))}
      onmousemove={(event) => onHover(event.features[0]?.properties?.id as string)}
      onmouseleave={() => onHover(undefined)}
      paint={{
        'circle-color': ['get', 'color'],
        'circle-radius': ['get', 'size'],
        'circle-opacity': ['case', ['get', 'hovered'], 1, 0.75],
        'circle-stroke-color': '#fff',
        'circle-stroke-width': ['case', ['get', 'hovered'], 3, 1.5],
      }}
    />
  </GeoJSON>
</MapLibre>
