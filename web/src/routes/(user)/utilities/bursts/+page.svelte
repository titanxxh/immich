<script lang="ts">
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import { getAssetMediaUrl } from '$lib/utils';
  import { handleError } from '$lib/utils/handle-error';
  import {
    AssetMediaSize,
    createStack,
    deleteDuplicate,
    getBursts,
    resolveDuplicates,
    updateAssets,
    type BurstDto,
  } from '@immich/sdk';
  import { Button, LoadingSpinner, toastManager } from '@immich/ui';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import BurstCompare from './BurstCompare.svelte';
  import { getDefaultDecision, getSummary, type BurstDecision } from './burst';

  const SCREEN_SIZE = 40;

  let bursts = $state<BurstDto[]>();
  let total = $state(0);
  let decisions = $state<Record<string, BurstDecision>>({});
  // skipped bursts come back on the next visit; until then the next screen starts after them
  let skipped = $state<string[]>([]);
  let openIndex = $state<number>();
  let isSaving = $state(false);

  const summary = $derived(getSummary(bursts ?? [], decisions));
  const decisionOf = (burst: BurstDto) => decisions[burst.duplicateId] ?? getDefaultDecision(burst);

  const load = async () => {
    try {
      const response = await getBursts({ offset: skipped.length, limit: SCREEN_SIZE });
      bursts = response.bursts;
      total = response.total - skipped.length;
      decisions = {};
    } catch (error) {
      handleError(error, $t('errors.unable_to_load_bursts'));
    }
  };

  onMount(load);

  const remove = (handled: BurstDto[]) => {
    const ids = new Set(handled.map((burst) => burst.duplicateId));
    bursts = bursts?.filter((burst) => !ids.has(burst.duplicateId));
    total -= handled.length;
  };

  const handle = async (handled: BurstDto[]) => {
    const toTrash = handled.filter((burst) => decisionOf(burst).action === 'trash');
    const toStack = handled.filter((burst) => decisionOf(burst).action === 'stack');

    if (toTrash.length > 0) {
      const results = await resolveDuplicates({
        duplicateResolveDto: {
          groups: toTrash.map((burst) => {
            const { keep } = decisionOf(burst);
            return {
              duplicateId: burst.duplicateId,
              keepAssetIds: keep,
              trashAssetIds: burst.assets.map(({ id }) => id).filter((id) => !keep.includes(id)),
            };
          }),
        },
      });
      const failed = results.find((result) => !result.success);
      if (failed) {
        throw new Error(failed.errorMessage ?? failed.error);
      }
    }

    for (const burst of toStack) {
      const { keep } = decisionOf(burst);
      const assetIds = [...keep, ...burst.assets.map(({ id }) => id).filter((id) => !keep.includes(id))];
      await createStack({ stackCreateDto: { assetIds } });
      await updateAssets({ assetBulkUpdateDto: { ids: assetIds, duplicateId: null } });
    }
  };

  const confirm = async (handled: BurstDto[]) => {
    if (handled.length === 0 || isSaving) {
      return;
    }
    isSaving = true;
    try {
      await handle(handled);
      toastManager.primary($t('bursts_confirmed', { values: { count: handled.length } }));
      remove(handled);
      if (bursts?.length === 0) {
        await load();
      }
    } catch (error) {
      handleError(error, $t('errors.unable_to_handle_bursts'));
      await load();
    } finally {
      isSaving = false;
    }
  };

  const keepAll = async (burst: BurstDto) => {
    try {
      await deleteDuplicate({ id: burst.duplicateId });
      remove([burst]);
    } catch (error) {
      handleError(error, $t('errors.unable_to_handle_bursts'));
    }
  };

  const skip = (burst: BurstDto) => {
    skipped.push(burst.duplicateId);
    remove([burst]);
  };

  // handling a burst from the compare view goes back to the wall
  const afterHandled = () => (openIndex = undefined);
</script>

<UserPageLayout title={$t('bursts_pick')}>
  {#if !bursts}
    <div class="flex justify-center p-8"><LoadingSpinner /></div>
  {:else if bursts.length === 0}
    <p class="p-8 text-center text-gray-500 dark:text-gray-300">{$t('bursts_done')}</p>
  {:else}
    <div class="p-4 pb-24">
      <p class="mb-3 text-sm text-gray-500 dark:text-gray-300">{$t('bursts_description')}</p>
      <div class="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6 2xl:grid-cols-8">
        {#each bursts as burst, index (burst.duplicateId)}
          {@const decision = decisionOf(burst)}
          <button type="button" class="relative block" onclick={() => (openIndex = index)}>
            <img
              src={getAssetMediaUrl({ id: decision.keep[0], size: AssetMediaSize.Thumbnail })}
              alt=""
              loading="lazy"
              class="aspect-square w-full rounded-lg object-cover"
            />
            <span class="absolute inset-s-1 top-1 rounded-sm bg-black/60 px-1.5 text-xs text-white">
              {decision.keep.length}/{burst.assets.length}
            </span>
            {#if decision.isChanged || decision.action === 'stack'}
              <span class="absolute inset-e-1 top-1 rounded-sm bg-primary px-1.5 text-xs text-white">
                {decision.action === 'stack' ? $t('bursts_stack') : $t('bursts_changed')}
              </span>
            {/if}
          </button>
        {/each}
      </div>
    </div>

    <div
      class="fixed inset-s-4 inset-e-4 bottom-4 z-40 flex flex-wrap items-center gap-3 rounded-xl bg-subtle p-3 shadow-lg md:inset-s-72"
    >
      <span class="text-sm">
        {$t('bursts_summary', { values: { trash: summary.trash, stacks: summary.stacks, left: total } })}
      </span>
      <Button class="ms-auto" loading={isSaving} disabled={isSaving} onclick={() => confirm(bursts ?? [])}>
        {$t('bursts_confirm_screen')}
      </Button>
    </div>
  {/if}
</UserPageLayout>

{#if bursts && openIndex !== undefined && bursts[openIndex]}
  {@const burst = bursts[openIndex]}
  <BurstCompare
    {burst}
    decision={decisionOf(burst)}
    hasPrevious={openIndex > 0}
    hasNext={openIndex < bursts.length - 1}
    onChange={(decision) => (decisions[burst.duplicateId] = decision)}
    onConfirm={async () => {
      await confirm([burst]);
      afterHandled();
    }}
    onSkip={() => {
      skip(burst);
      afterHandled();
    }}
    onKeepAll={async () => {
      await keepAll(burst);
      afterHandled();
    }}
    onMove={(delta) => (openIndex = (openIndex ?? 0) + delta)}
    onClose={() => (openIndex = undefined)}
  />
{/if}
