<script lang="ts">
  import { handleError } from '$lib/utils/handle-error';
  import {
    cancelReorganization,
    deleteReorganization,
    getReorganizationItems,
    ReorganizationItemStatus,
    resumeReorganization,
    undoReorganization,
    type ReorganizationItemDto,
    type ReorganizationResponseDto,
  } from '@immich/sdk';
  import { Button, modalManager } from '@immich/ui';
  import { t } from 'svelte-i18n';
  import {
    canResume,
    canUndo,
    getItemStatusKey,
    getPresetKey,
    getProgress,
    getReasonKey,
    getRecordState,
    isRunning,
  } from './reorganize';

  type Props = {
    record: ReorganizationResponseDto;
    /** Shows the progress and outcome in full, for the run the user just started. */
    isFeatured?: boolean;
    /** Called with the record after an action, or without it once it is deleted. */
    onChange: (record?: ReorganizationResponseDto) => void;
  };

  let { record, isFeatured = false, onChange }: Props = $props();

  const LIMIT = 500;
  let items = $state<ReorganizationItemDto[]>();
  let isBusy = $state(false);

  const recordState = $derived(getRecordState(record));
  const progress = $derived(getProgress(record));

  const run = async (action: () => Promise<ReorganizationResponseDto | void>, message: string) => {
    isBusy = true;
    try {
      onChange((await action()) || undefined);
      items = undefined;
    } catch (error) {
      handleError(error, message);
    } finally {
      isBusy = false;
    }
  };

  const cancel = () => run(() => cancelReorganization({ id: record.id }), $t('errors.unable_to_reorganize'));
  const resume = () => run(() => resumeReorganization({ id: record.id }), $t('errors.unable_to_reorganize'));
  const undo = async () => {
    const isConfirmed = await modalManager.showDialog({
      prompt: $t('reorganize_undo_prompt', { values: { count: record.movedCount } }),
    });
    if (isConfirmed) {
      await run(() => undoReorganization({ id: record.id }), $t('errors.unable_to_reorganize'));
    }
  };
  const remove = async () => {
    const isConfirmed = await modalManager.showDialog({ prompt: $t('reorganize_delete_prompt') });
    if (isConfirmed) {
      await run(() => deleteReorganization({ id: record.id }), $t('errors.unable_to_reorganize'));
    }
  };

  const toggleItems = async () => {
    if (items) {
      items = undefined;
      return;
    }
    try {
      items = await getReorganizationItems({ id: record.id, limit: LIMIT });
    } catch (error) {
      handleError(error, $t('errors.unable_to_reorganize'));
    }
  };

  const itemNote = (item: ReorganizationItemDto) => {
    if (item.error) {
      return item.error;
    }
    return item.reason ? $t(getReasonKey(item.reason), { default: item.reason }) : '';
  };
  const isProblem = (item: ReorganizationItemDto) =>
    item.status === ReorganizationItemStatus.Failed || item.status === ReorganizationItemStatus.UndoFailed;
</script>

<div class="rounded-2xl border border-gray-300 p-4 dark:border-immich-dark-gray dark:text-white">
  <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
    <span class="font-medium">{$t(`reorganize_state_${recordState}`)}</span>
    <span class="text-sm text-gray-500 dark:text-gray-300">
      {new Date(record.createdAt).toLocaleString()} · {$t(getPresetKey(record.preset))}
    </span>
  </div>
  <p class="mt-1 font-mono text-sm break-all">
    {record.sourceName}
    {#if record.sourceName !== record.targetPath}→ {record.targetPath}{/if}
  </p>

  {#if isRunning(record)}
    <div class="my-3 h-2 rounded-sm bg-gray-200 dark:bg-gray-700">
      <div
        class="h-2 rounded-sm bg-primary transition-[width]"
        style:width="{progress.total ? (progress.done / progress.total) * 100 : 0}%"
      ></div>
    </div>
    <p class="text-sm">{$t('reorganize_progress', { values: progress })}</p>
    {#if isFeatured}
      <p class="text-sm text-gray-500 dark:text-gray-300">{$t('reorganize_running_hint')}</p>
    {/if}
  {:else}
    <p class="mt-2 text-sm">
      {$t('reorganize_result', {
        values: {
          moved: record.movedCount,
          failed: record.failedCount,
          stayed: record.stayedCount,
          pending: record.pendingCount,
        },
      })}
      {#if record.isUndo}
        · {$t('reorganize_result_undo', { values: { undone: record.undoneCount, skipped: record.undoSkippedCount } })}
      {/if}
      {#if record.removedFolderCount > 0 && !record.isUndo}
        · {$t('reorganize_result_folders', { values: { count: record.removedFolderCount } })}
      {/if}
    </p>
    {#if record.error}
      <p class="mt-1 text-sm text-red-600 dark:text-red-400">{record.error}</p>
    {/if}
  {/if}

  <div class="mt-3 flex flex-wrap gap-2">
    {#if isRunning(record)}
      <Button size="small" color="secondary" disabled={isBusy} onclick={cancel}>{$t('cancel')}</Button>
    {:else}
      {#if canResume(record)}
        <Button size="small" disabled={isBusy} onclick={resume}>
          {record.status === 'completed' ? $t('reorganize_retry_failed') : $t('reorganize_continue')}
        </Button>
      {/if}
      {#if canUndo(record)}
        <Button size="small" color="secondary" disabled={isBusy} onclick={undo}>
          {record.status === 'completed' && !record.isUndo ? $t('reorganize_undo') : $t('reorganize_undo_done_part')}
        </Button>
      {/if}
      <Button size="small" color="secondary" variant="ghost" onclick={toggleItems}>
        {items ? $t('reorganize_hide_details') : $t('reorganize_details')}
      </Button>
      {#if !isFeatured}
        <Button size="small" color="danger" variant="ghost" disabled={isBusy} onclick={remove}>
          {$t('reorganize_delete_record')}
        </Button>
      {/if}
    {/if}
  </div>

  {#if items}
    <div class="mt-3 max-h-96 overflow-auto">
      <table class="w-full text-start text-sm">
        <thead class="text-xs text-gray-500 dark:text-gray-300">
          <tr>
            <th class="p-1 text-start">{$t('reorganize_column_from')}</th>
            <th class="p-1 text-start">{$t('reorganize_column_to')}</th>
            <th class="p-1 text-start">{$t('status')}</th>
            <th class="p-1 text-start">{$t('reorganize_column_note')}</th>
          </tr>
        </thead>
        <tbody>
          {#each items as item (item.id)}
            <tr class="border-t border-gray-200 align-top dark:border-immich-dark-gray">
              <td class="p-1 font-mono break-all">{item.fromPath}</td>
              <td class="p-1 font-mono break-all">{item.toPath ?? '—'}</td>
              <td class="p-1 whitespace-nowrap" class:text-red-600={isProblem(item)}>
                {$t(getItemStatusKey(item.status))}
              </td>
              <td class="p-1 text-gray-500 dark:text-gray-300">{itemNote(item)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
      {#if items.length === LIMIT}
        <p class="p-1 text-xs text-gray-500 dark:text-gray-300">
          {$t('reorganize_list_capped', { values: { count: LIMIT } })}
        </p>
      {/if}
    </div>
  {/if}
</div>
