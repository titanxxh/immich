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
  import type { TripDetailResponseDto } from '@immich/sdk';
  import { Theme, themeManager } from '@immich/ui';
  import { LngLatBounds } from 'maplibre-gl';
  import { CircleLayer, GeoJSON, LineLayer, MapLibre, NavigationControl } from 'svelte-maplibre';
  import { getDayColor } from './trip';

  type Props = {
    trip: TripDetailResponseDto;
    selectedDate?: string;
    class?: string;
    onSelectDate?: (date: string) => void;
  };

  let { trip, selectedDate, class: className = 'h-80', onSelectDate }: Props = $props();

  const mapTheme = $derived($mapSettings.allowDarkMode ? themeManager.value : Theme.Light);
  const styleUrl = $derived(
    mapTheme === Theme.Dark ? serverConfigManager.value.mapDarkStyleUrl : serverConfigManager.value.mapLightStyleUrl,
  );

  const colorOf = (date: string) => getDayColor(trip.days.find((day) => day.date === date)?.index ?? 1);
  const isDimmed = (date: string) => selectedDate !== undefined && date !== selectedDate;

  // follow the selected day, or show the whole trip
  const bounds = $derived.by(() => {
    const selected = trip.stops.filter((stop) => stop.date === selectedDate);
    const bounds = new LngLatBounds();
    for (const stop of selected.length > 0 ? selected : trip.stops) {
      bounds.extend([stop.longitude, stop.latitude]);
    }
    return bounds.isEmpty() ? undefined : bounds;
  });

  const getLegs = (isLongJump: boolean) => ({
    type: 'FeatureCollection' as const,
    features: trip.legs
      .filter((leg) => leg.isLongJump === isLongJump)
      .map((leg) => {
        const from = trip.stops[leg.from];
        const to = trip.stops[leg.to];
        return {
          type: 'Feature' as const,
          properties: { color: colorOf(to.date), dim: isDimmed(to.date) },
          geometry: {
            type: 'LineString' as const,
            coordinates: [
              [from.longitude, from.latitude],
              [to.longitude, to.latitude],
            ],
          },
        };
      }),
  });

  const points = $derived({
    type: 'FeatureCollection' as const,
    features: trip.stops.map((stop) => ({
      type: 'Feature' as const,
      properties: {
        color: colorOf(stop.date),
        date: stop.date,
        dim: isDimmed(stop.date),
        size: Math.min(4 + Math.sqrt(stop.assetCount) * 1.5, 14),
      },
      geometry: { type: 'Point' as const, coordinates: [stop.longitude, stop.latitude] },
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
    <GeoJSON data={getLegs(false)}>
      <LineLayer
        paint={{ 'line-color': ['get', 'color'], 'line-width': 3, 'line-opacity': ['case', ['get', 'dim'], 0.15, 0.9] }}
      />
    </GeoJSON>
    <GeoJSON data={getLegs(true)}>
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
