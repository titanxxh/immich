<script lang="ts" module>
  import { addProtocol, setWorkerUrl } from 'maplibre-gl';
  import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
  import { Protocol } from 'pmtiles';

  setWorkerUrl(workerUrl);
  void addProtocol('pmtiles', new Protocol().tile);
</script>

<script lang="ts">
  // PROTOTYPE: route map for the trip album page layout prototype.
  import { serverConfigManager } from '$lib/managers/server-config-manager.svelte';
  import { Theme, themeManager } from '@immich/ui';
  import { LngLatBounds } from 'maplibre-gl';
  import { CircleLayer, GeoJSON, LineLayer, MapLibre, NavigationControl } from 'svelte-maplibre';
  import type { TripData } from './trip-data';

  type Props = { trip: TripData; selectedDate?: string; class?: string; onSelectDate?: (date: string) => void };
  let { trip, selectedDate, class: className = 'h-80', onSelectDate }: Props = $props();

  const styleUrl = $derived(
    themeManager.value === Theme.Dark
      ? serverConfigManager.value.mapDarkStyleUrl
      : serverConfigManager.value.mapLightStyleUrl,
  );

  const visibleStops = $derived(selectedDate ? trip.stops.filter((stop) => stop.date === selectedDate) : trip.stops);
  const bounds = $derived.by(() => {
    const b = new LngLatBounds();
    for (const stop of visibleStops.length > 0 ? visibleStops : trip.stops) {
      b.extend([stop.lon, stop.lat]);
    }
    return b.isEmpty() ? undefined : b;
  });

  const lines = (long: boolean) => ({
    type: 'FeatureCollection' as const,
    features: trip.segments
      .filter((segment) => segment.long === long)
      .map((segment) => ({
        type: 'Feature' as const,
        properties: {
          color: segment.color,
          dim: selectedDate !== undefined && segment.to.date !== selectedDate,
        },
        geometry: {
          type: 'LineString' as const,
          coordinates: [
            [segment.from.lon, segment.from.lat],
            [segment.to.lon, segment.to.lat],
          ],
        },
      })),
  });

  const points = $derived({
    type: 'FeatureCollection' as const,
    features: trip.stops.map((stop) => ({
      type: 'Feature' as const,
      properties: {
        color: trip.days.find((day) => day.date === stop.date)?.color ?? '#888',
        date: stop.date,
        dim: selectedDate !== undefined && stop.date !== selectedDate,
        size: Math.min(4 + Math.sqrt(stop.count) * 1.5, 14),
      },
      geometry: { type: 'Point' as const, coordinates: [stop.lon, stop.lat] },
    })),
  });
</script>

<div class={className}>
  <MapLibre
    style={styleUrl}
    class="h-full rounded-2xl"
    {bounds}
    fitBoundsOptions={{ padding: 40, maxZoom: 14 }}
    attributionControl={false}
  >
    <NavigationControl position="top-left" showCompass={false} />
    <GeoJSON data={lines(false)}>
      <LineLayer
        paint={{ 'line-color': ['get', 'color'], 'line-width': 3, 'line-opacity': ['case', ['get', 'dim'], 0.15, 0.9] }}
      />
    </GeoJSON>
    <GeoJSON data={lines(true)}>
      <LineLayer
        paint={{
          'line-color': ['get', 'color'],
          'line-width': 2,
          'line-dasharray': [2, 2],
          'line-opacity': ['case', ['get', 'dim'], 0.15, 0.8],
        }}
      />
    </GeoJSON>
    <GeoJSON data={points}>
      <CircleLayer
        hoverCursor="pointer"
        onclick={(event) => onSelectDate?.(event.features[0]?.properties?.date as string)}
        paint={{
          'circle-color': ['get', 'color'],
          'circle-radius': ['get', 'size'],
          'circle-stroke-color': '#fff',
          'circle-stroke-width': 1.5,
          'circle-opacity': ['case', ['get', 'dim'], 0.2, 1],
          'circle-stroke-opacity': ['case', ['get', 'dim'], 0.2, 1],
        }}
      />
    </GeoJSON>
  </MapLibre>
</div>
