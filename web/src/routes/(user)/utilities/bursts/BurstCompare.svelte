<script lang="ts">
  import { getAssetMediaUrl } from '$lib/utils';
  import { AssetMediaSize, type BurstDto } from '@immich/sdk';
  import { Button, IconButton } from '@immich/ui';
  import { mdiChevronLeft, mdiChevronRight, mdiClose, mdiMagnifyPlusOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';
  import { getRelativeSharpness, pickPhoto, type BurstDecision } from './burst';

  type Props = {
    burst: BurstDto;
    decision: BurstDecision;
    hasPrevious: boolean;
    hasNext: boolean;
    onChange: (decision: BurstDecision) => void;
    onConfirm: () => void;
    onSkip: () => void;
    onKeepAll: () => void;
    onMove: (delta: number) => void;
    onClose: () => void;
  };

  let { burst, decision, hasPrevious, hasNext, onChange, onConfirm, onSkip, onKeepAll, onMove, onClose }: Props =
    $props();

  // with the loupe on, every photo shows the same spot, at full size, under the pointer
  let isZoomed = $state(false);
  let focus = $state({ x: 0.5, y: 0.5 });

  const columns = $derived(Math.min(burst.assets.length, 4));

  const pick = (assetId: string, isAdding: boolean) => onChange(pickPhoto(decision, assetId, isAdding));
  const toggleAction = () =>
    onChange({ ...decision, action: decision.action === 'trash' ? 'stack' : 'trash', isChanged: true });

  const onkeydown = (event: KeyboardEvent) => {
    if (event.target instanceof HTMLElement && event.target.closest('input, textarea, [contenteditable]')) {
      return;
    }
    const index = Number(event.key) - 1;
    if (index >= 0 && index < burst.assets.length && index < 9) {
      pick(burst.assets[index].id, event.shiftKey);
      return;
    }
    switch (event.key) {
      case ' ': {
        event.preventDefault();
        toggleAction();
        break;
      }
      case 'Enter': {
        event.preventDefault();
        onConfirm();
        break;
      }
      case 's':
      case 'S': {
        onSkip();
        break;
      }
      case 'z':
      case 'Z': {
        isZoomed = !isZoomed;
        break;
      }
      case 'ArrowLeft': {
        if (hasPrevious) {
          onMove(-1);
        }
        break;
      }
      case 'ArrowRight': {
        if (hasNext) {
          onMove(1);
        }
        break;
      }
      case 'Escape': {
        onClose();
        break;
      }
    }
  };

  const onpointermove = (event: PointerEvent) => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    focus = { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height };
  };
</script>

<svelte:window {onkeydown} />

<div class="fixed inset-0 z-50 flex flex-col gap-3 overflow-y-auto bg-light p-4">
  <div class="flex flex-wrap items-center gap-2">
    <IconButton
      icon={mdiClose}
      shape="round"
      variant="ghost"
      color="secondary"
      aria-label={$t('close')}
      onclick={onClose}
    />
    <IconButton
      icon={mdiChevronLeft}
      shape="round"
      variant="ghost"
      color="secondary"
      aria-label={$t('previous')}
      disabled={!hasPrevious}
      onclick={() => onMove(-1)}
    />
    <IconButton
      icon={mdiChevronRight}
      shape="round"
      variant="ghost"
      color="secondary"
      aria-label={$t('next')}
      disabled={!hasNext}
      onclick={() => onMove(1)}
    />
    <span class="text-sm text-gray-500 dark:text-gray-300">{$t('bursts_compare_hint')}</span>
    <span class="ms-auto flex flex-wrap gap-1">
      <IconButton
        icon={mdiMagnifyPlusOutline}
        shape="round"
        variant={isZoomed ? 'filled' : 'ghost'}
        color="secondary"
        aria-label="Z"
        onclick={() => (isZoomed = !isZoomed)}
      />
      <Button
        size="small"
        variant={decision.action === 'trash' ? 'filled' : 'ghost'}
        onclick={() => decision.action === 'stack' && toggleAction()}
      >
        {$t('bursts_trash_others')}
      </Button>
      <Button
        size="small"
        variant={decision.action === 'stack' ? 'filled' : 'ghost'}
        onclick={() => decision.action === 'trash' && toggleAction()}
      >
        {$t('bursts_stack')}
      </Button>
      <Button size="small" variant="ghost" color="secondary" onclick={onKeepAll}>{$t('bursts_keep_all')}</Button>
      <Button size="small" variant="ghost" color="secondary" onclick={onSkip}>{$t('bursts_skip')}</Button>
      <Button size="small" onclick={onConfirm}>{$t('confirm')} ⏎</Button>
    </span>
  </div>

  <div class="grid gap-2" style:grid-template-columns="repeat({columns}, minmax(0, 1fr))">
    {#each burst.assets as asset, index (asset.id)}
      {@const isKept = decision.keep.includes(asset.id)}
      <button
        type="button"
        class="relative overflow-hidden rounded-lg bg-black {isKept ? 'ring-4 ring-green-500' : ''}"
        onclick={(event) => pick(asset.id, event.shiftKey)}
        {onpointermove}
      >
        {#if isZoomed}
          <div
            class="aspect-4/3 w-full bg-no-repeat"
            style:background-image="url({getAssetMediaUrl({ id: asset.id, size: AssetMediaSize.Fullsize })})"
            style:background-size="400%"
            style:background-position="{focus.x * 100}% {focus.y * 100}%"
          ></div>
        {:else}
          <img
            src={getAssetMediaUrl({ id: asset.id, size: AssetMediaSize.Preview })}
            alt=""
            class="aspect-4/3 w-full object-contain {isKept ? '' : 'opacity-60'}"
          />
        {/if}
        {#if index < 9}
          <span class="absolute inset-s-1 top-1 rounded-sm bg-black/70 px-1.5 text-white">{index + 1}</span>
        {/if}
        <span class="absolute inset-e-1 bottom-1 rounded-sm bg-black/70 px-1.5 text-xs text-white">
          {$t('bursts_sharpness', { values: { value: getRelativeSharpness(burst, asset.id) } })}
        </span>
      </button>
    {/each}
  </div>
</div>
