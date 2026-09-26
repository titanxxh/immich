<script lang="ts">
  // PROTOTYPE: trip overview line.
  import type { TripData } from './trip-data';
  let { trip }: { trip: TripData } = $props();
</script>

<div class="flex flex-wrap gap-x-6 gap-y-1 text-sm">
  <span><b class="text-lg">{trip.days.length}</b> 天</span>
  <span
    ><b class="text-lg">{trip.cities.length}</b> 个地方：{trip.cities.slice(0, 6).join('、')}{trip.cities.length > 6
      ? '…'
      : ''}</span
  >
  {#if trip.farthestKm !== undefined}
    <span>离家最远 <b class="text-lg">{trip.farthestKm.toLocaleString()}</b> km</span>
  {/if}
  <span><b class="text-lg">{trip.photoCount.toLocaleString()}</b> 张照片</span>
</div>
