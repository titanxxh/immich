<script lang="ts">
  // PROTOTYPE: day selector.
  import type { TripData } from './trip-data';
  type Props = { trip: TripData; selectedDate?: string; onSelect: (date?: string) => void; vertical?: boolean };
  let { trip, selectedDate, onSelect, vertical = false }: Props = $props();
</script>

<div class={vertical ? 'flex flex-col gap-1' : 'flex gap-2 overflow-x-auto pb-2'}>
  <button
    type="button"
    class="shrink-0 rounded-xl border px-3 py-1.5 text-start text-sm {selectedDate
      ? ''
      : 'border-primary bg-primary/10'}"
    onclick={() => onSelect(undefined)}>全部</button
  >
  {#each trip.days as day (day.date)}
    <button
      type="button"
      class="shrink-0 rounded-xl border px-3 py-1.5 text-start text-sm {selectedDate === day.date
        ? 'border-primary bg-primary/10'
        : ''}"
      onclick={() => onSelect(day.date)}
    >
      <span class="me-1 inline-block size-2.5 rounded-full" style="background: {day.color}"></span>
      <span class="font-medium">{day.label}</span>
      {#if day.place}<span class="text-gray-500 dark:text-gray-300"> · {day.place}</span>{/if}
      {#if vertical}<span class="float-end text-xs text-gray-500">{day.photos.length} 张</span>{/if}
    </button>
  {/each}
</div>
