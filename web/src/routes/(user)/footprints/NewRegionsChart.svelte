<script lang="ts">
  import { t } from 'svelte-i18n';

  type Props = {
    years: Array<{ year: string; count: number }>;
    selected?: string;
    onSelect: (year?: string) => void;
  };

  let { years, selected, onSelect }: Props = $props();
  let hovered = $state<string>();

  const max = $derived(Math.max(1, ...years.map(({ count }) => count)));
  // label every year when there is room, otherwise every few years
  const labelEvery = $derived(Math.ceil(years.length / 12));
</script>

<figure class="flex flex-col gap-2">
  <figcaption class="flex items-baseline justify-between gap-2">
    <span class="font-medium">{$t('footprints_new_per_year')}</span>
    {#if selected}
      <button type="button" class="text-sm text-primary underline" onclick={() => onSelect(undefined)}>
        {$t('footprints_all_years')}
      </button>
    {/if}
  </figcaption>
  <div
    class="relative flex h-48 items-end gap-0.5 border-b border-gray-300 dark:border-gray-600"
    role="group"
    aria-label={$t('footprints_new_per_year')}
  >
    {#each years as { year, count }, index (year)}
      <button
        type="button"
        class="group relative flex h-full flex-1 items-end justify-center"
        aria-label={$t('footprints_new_in_year', { values: { year, count } })}
        aria-pressed={selected === year}
        onclick={() => onSelect(selected === year ? undefined : year)}
        onmouseenter={() => (hovered = year)}
        onmouseleave={() => (hovered = undefined)}
        onfocus={() => (hovered = year)}
        onblur={() => (hovered = undefined)}
      >
        <span
          class="w-full max-w-6 rounded-t bg-primary transition-opacity {selected && selected !== year
            ? 'opacity-30'
            : 'opacity-100'}"
          style:height="{(count / max) * 100}%"
        ></span>
        {#if hovered === year}
          <span
            class="pointer-events-none absolute bottom-full z-10 mb-1 rounded-md bg-gray-900 px-2 py-1 text-xs whitespace-nowrap text-white shadow-sm dark:bg-gray-100 dark:text-gray-900"
          >
            {$t('footprints_new_in_year', { values: { year, count } })}
          </span>
        {/if}
        <span
          class="absolute top-full mt-1 text-xs text-gray-500 dark:text-gray-300 {index % labelEvery === 0 ||
          selected === year
            ? ''
            : 'invisible'}"
        >
          {year}
        </span>
      </button>
    {/each}
  </div>
  <div class="h-5"></div>
</figure>
