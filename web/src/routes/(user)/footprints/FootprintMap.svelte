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
  import type { FootprintRegion, FootprintShapesResponseDto } from '@immich/sdk';
  import { Theme, themeManager } from '@immich/ui';
  import { LngLatBounds, type Map as MapLibreMap } from 'maplibre-gl';
  import { untrack } from 'svelte';
  import { FillLayer, GeoJSON, LineLayer, MapLibre, NavigationControl } from 'svelte-maplibre';
  import { visitYear } from './footprints';

  type Props = {
    regions: FootprintRegion[];
    shapes: FootprintShapesResponseDto;
    /** light up only the regions first visited by this year, the year's new ones darker */
    year?: string;
    selectedId?: string;
    onSelect: (region: FootprintRegion) => void;
  };

  let { regions, shapes, year, selectedId, onSelect }: Props = $props();
  let map = $state<MapLibreMap>();

  const mapTheme = $derived($mapSettings.allowDarkMode ? themeManager.value : Theme.Light);
  const styleUrl = $derived(
    mapTheme === Theme.Dark ? serverConfigManager.value.mapDarkStyleUrl : serverConfigManager.value.mapLightStyleUrl,
  );
  // one hue, lighter for earlier visits and darker for the year being replayed
  const colors = $derived(
    mapTheme === Theme.Dark
      ? { lit: '#8ea3e8', new: '#dbe3ff', edge: '#0f172a' }
      : { lit: '#6f7fd6', new: '#2a3585', edge: '#ffffff' },
  );

  const byId = $derived(new Map(regions.map((region) => [region.id, region])));

  const stateOf = (region: FootprintRegion) => {
    if (region.hidden || (year && visitYear(region) > year)) {
      return 'off';
    }
    return year && visitYear(region) === year ? 'new' : 'lit';
  };

  const data = $derived({
    type: 'FeatureCollection' as const,
    features: shapes.features
      .filter((feature) => byId.has(feature.properties.id))
      .map((feature) => {
        const region = byId.get(feature.properties.id)!;
        return {
          type: 'Feature' as const,
          properties: { id: region.id, state: stateOf(region), selected: region.id === selectedId },
          geometry: feature.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon,
        };
      }),
  });

  // fitted once on open; hiding a region later should not move the map
  const bounds = untrack(() => {
    const bounds = new LngLatBounds();
    for (const region of regions) {
      if (!region.hidden) {
        bounds.extend([region.longitude, region.latitude]);
      }
    }
    return bounds.isEmpty() ? undefined : bounds;
  });

  const select = (id: unknown) => {
    const region = byId.get(id as string);
    if (region && stateOf(region) !== 'off') {
      onSelect(region);
    }
  };

  export const flyTo = (region: FootprintRegion) =>
    map?.flyTo({ center: [region.longitude, region.latitude], zoom: Math.max(map.getZoom(), 6) });
</script>

<MapLibre
  style={styleUrl}
  class="size-full"
  {bounds}
  fitBoundsOptions={{ padding: 80, maxZoom: 6 }}
  attributionControl={false}
  bind:map
>
  <NavigationControl position="top-right" showCompass={false} />
  <GeoJSON {data}>
    <FillLayer
      hoverCursor="pointer"
      onclick={(event) => select(event.features[0]?.properties?.id)}
      paint={{
        'fill-color': ['match', ['get', 'state'], 'new', colors.new, colors.lit],
        'fill-opacity': ['match', ['get', 'state'], 'off', 0, ['case', ['get', 'selected'], 0.85, 0.6]],
      }}
    />
    <LineLayer
      paint={{
        'line-color': ['case', ['get', 'selected'], colors.new, colors.edge],
        'line-width': ['case', ['get', 'selected'], 2.5, 0.6],
        'line-opacity': ['match', ['get', 'state'], 'off', 0, 1],
      }}
    />
  </GeoJSON>
</MapLibre>
