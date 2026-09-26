<script lang="ts">
  // PROTOTYPE: floating variant switcher. Never merge into release branches.
  import { dev } from '$app/environment';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';

  type Props = { variants: { key: string; name: string }[] };
  let { variants }: Props = $props();

  const current = $derived(page.url.searchParams.get('variant') ?? variants[0].key);
  const index = $derived(Math.max(0, variants.findIndex((v) => v.key === current)));

  const go = (delta: number) => {
    const next = variants[(index + delta + variants.length) % variants.length];
    const url = new URL(page.url);
    url.searchParams.set('variant', next.key);
    void goto(url, { replaceState: true, noScroll: true, keepFocus: true });
  };

  const onkeydown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('input, textarea, [contenteditable]')) {
      return;
    }
    if (event.key === 'ArrowLeft') {
      go(-1);
    } else if (event.key === 'ArrowRight') {
      go(1);
    }
  };
</script>

<svelte:window {onkeydown} />

{#if dev}
  <div
    class="fixed bottom-6 left-1/2 z-[9999] flex -translate-x-1/2 items-center gap-3 rounded-full bg-black px-4 py-2 text-sm text-white shadow-2xl ring-2 ring-yellow-400"
  >
    <button type="button" class="px-2" onclick={() => go(-1)}>←</button>
    <span>PROTOTYPE {variants[index].key} ({variants[index].name})</span>
    <button type="button" class="px-2" onclick={() => go(1)}>→</button>
  </div>
{/if}
