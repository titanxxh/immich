<script lang="ts">
  import { getAssetMediaUrl } from '$lib/utils';
  import { AssetMediaSize } from '@immich/sdk';
  import { IconButton } from '@immich/ui';
  import { mdiCheckCircle, mdiChevronLeft, mdiChevronRight, mdiCircleOutline, mdiClose } from '@mdi/js';
  import { t } from 'svelte-i18n';

  type Props = {
    assetIds: string[];
    index: number;
    selected: Set<string>;
    onToggle: (id: string) => void;
    onClose: () => void;
  };

  let { assetIds, index = $bindable(), selected, onToggle, onClose }: Props = $props();

  const id = $derived(assetIds[index]);
  const isSelected = $derived(selected.has(id));

  const move = (delta: number) => {
    index = Math.min(Math.max(index + delta, 0), assetIds.length - 1);
  };

  const onkeydown = (event: KeyboardEvent) => {
    switch (event.key) {
      case 'Escape': {
        onClose();

        break;
      }
      case 'ArrowLeft': {
        move(-1);

        break;
      }
      case 'ArrowRight': {
        move(1);

        break;
      }
      case ' ': {
        event.preventDefault();
        onToggle(id);

        break;
      }
      default: {
        return;
      }
    }
    event.stopPropagation();
  };
</script>

<svelte:window {onkeydown} />

<div class="fixed inset-0 z-1000 flex flex-col bg-black/90 text-white" role="dialog" aria-modal="true">
  <div class="flex items-center justify-between gap-2 p-3">
    <span class="text-sm">{index + 1} / {assetIds.length}</span>
    <div class="flex items-center gap-2">
      <button
        type="button"
        class="flex items-center gap-2 rounded-full px-3 py-1.5 text-sm hover:bg-white/10"
        onclick={() => onToggle(id)}
      >
        <svg class="size-5" viewBox="0 0 24 24"
          ><path fill="currentColor" d={isSelected ? mdiCheckCircle : mdiCircleOutline} /></svg
        >
        {isSelected ? $t('locate_preview_selected') : $t('locate_preview_not_selected')}
      </button>
      <IconButton
        shape="round"
        variant="ghost"
        color="secondary"
        icon={mdiClose}
        aria-label={$t('close')}
        onclick={onClose}
      />
    </div>
  </div>

  <div class="relative flex min-h-0 flex-1 items-center justify-center px-14 pb-4">
    <img
      class="max-h-full max-w-full object-contain"
      alt=""
      src={getAssetMediaUrl({ id, size: AssetMediaSize.Preview })}
    />
    {#if index > 0}
      <div class="absolute inset-s-2 top-1/2 -translate-y-1/2">
        <IconButton
          shape="round"
          variant="ghost"
          color="secondary"
          icon={mdiChevronLeft}
          aria-label={$t('previous')}
          onclick={() => move(-1)}
        />
      </div>
    {/if}
    {#if index < assetIds.length - 1}
      <div class="absolute inset-e-2 top-1/2 -translate-y-1/2">
        <IconButton
          shape="round"
          variant="ghost"
          color="secondary"
          icon={mdiChevronRight}
          aria-label={$t('next')}
          onclick={() => move(1)}
        />
      </div>
    {/if}
  </div>
  <p class="pb-3 text-center text-xs text-white/60">{$t('locate_preview_hint')}</p>
</div>
