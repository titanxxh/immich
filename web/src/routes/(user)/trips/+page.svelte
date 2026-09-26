<script lang="ts">
  // PROTOTYPE: trip list page variants.
  import { page } from '$app/state';
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import PrototypeSwitcher from '$lib/components/prototype/PrototypeSwitcher.svelte';
  import type { PageData } from './$types';
  import VariantCards from './VariantCards.svelte';
  import VariantMap from './VariantMap.svelte';
  import VariantTimeline from './VariantTimeline.svelte';

  let { data }: { data: PageData } = $props();
  const variant = $derived(page.url.searchParams.get('variant') ?? 'A');
</script>

<UserPageLayout title="旅行（PROTOTYPE）" description="({data.trips.length})">
  <div class="p-4">
    {#if variant === 'B'}
      <VariantTimeline trips={data.trips} />
    {:else if variant === 'C'}
      <VariantMap trips={data.trips} />
    {:else}
      <VariantCards trips={data.trips} />
    {/if}
  </div>
</UserPageLayout>

<PrototypeSwitcher
  variants={[
    { key: 'A', name: '年份卡片' },
    { key: 'B', name: '时间轴' },
    { key: 'C', name: '大地图' },
  ]}
/>
