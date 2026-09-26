<script lang="ts">
  // PROTOTYPE variant A: map on top. Overview, a wide route map and a row of day chips above the unchanged timeline.
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import DayChips from './DayChips.svelte';
  import { getTrip } from './trip-data';
  import TripOverview from './TripOverview.svelte';
  import TripRouteMap from './TripRouteMap.svelte';

  let { albumId }: { albumId: string } = $props();
  let selectedDate = $state<string>();
</script>

{#await getTrip(albumId, authManager.preferences.trips.homes)}
  <p class="my-4 text-sm text-gray-500">正在计算路线…</p>
{:then trip}
  <div class="my-4 flex flex-col gap-3">
    <TripOverview {trip} />
    <TripRouteMap {trip} {selectedDate} class="h-96" onSelectDate={(date) => (selectedDate = date)} />
    <DayChips {trip} {selectedDate} onSelect={(date) => (selectedDate = date)} />
  </div>
{/await}
