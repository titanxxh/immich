<script lang="ts">
  // PROTOTYPE variant B: side panel. The timeline keeps the main column; a fixed panel on the right holds the
  // overview, the route map and the list of days.
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import DayChips from './DayChips.svelte';
  import { getTrip } from './trip-data';
  import TripOverview from './TripOverview.svelte';
  import TripRouteMap from './TripRouteMap.svelte';

  let { albumId }: { albumId: string } = $props();
  let selectedDate = $state<string>();
</script>

<aside
  class="hidden h-dvh w-[440px] shrink-0 flex-col gap-3 overflow-hidden border-s bg-light p-4 pt-(--navbar-height) lg:flex dark:border-gray-700"
>
  {#await getTrip(albumId, authManager.preferences.trips.homes)}
    <p class="mt-6 text-sm text-gray-500">正在计算路线…</p>
  {:then trip}
    <div class="mt-4"><TripOverview {trip} /></div>
    <TripRouteMap {trip} {selectedDate} class="h-[42vh] shrink-0" onSelectDate={(date) => (selectedDate = date)} />
    <div class="min-h-0 flex-1 overflow-y-auto">
      <DayChips {trip} {selectedDate} vertical onSelect={(date) => (selectedDate = date)} />
    </div>
  {/await}
</aside>
