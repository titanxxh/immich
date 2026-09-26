<script lang="ts">
  // PROTOTYPE: three variants of the trip settings panel, switchable via ?variant=A|B|C. Wipe me.
  import { page } from '$app/state';
  import PrototypeSwitcher from '$lib/components/prototype/PrototypeSwitcher.svelte';
  import VariantA from './VariantA.svelte';
  import VariantB from './VariantB.svelte';
  import VariantC from './VariantC.svelte';

  const variant = $derived(page.url.searchParams.get('variant') ?? 'A');
</script>

{#if variant === 'B'}
  <VariantB />
{:else if variant === 'C'}
  <VariantC />
{:else}
  <VariantA />
{/if}

<PrototypeSwitcher
  variants={[
    { key: 'A', name: '经典表单' },
    { key: 'B', name: '地图优先' },
    { key: 'C', name: '预览优先' },
  ]}
/>
