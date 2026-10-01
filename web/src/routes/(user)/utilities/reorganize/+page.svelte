<script lang="ts">
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import AlbumPickerModal from '$lib/modals/AlbumPickerModal.svelte';
  import { handleError } from '$lib/utils/handle-error';
  import {
    createReorganization,
    getAlbumInfo,
    getReorganization,
    getReorganizations,
    previewReorganization,
    previewReorganizationItems,
    ReorganizeAction,
    ReorganizePreset,
    ReorganizeSourceType,
    type ReorganizationResponseDto,
    type ReorganizeDto,
    type ReorganizeItemDto,
    type ReorganizeItemsDto,
    type ReorganizePreviewResponseDto,
  } from '@immich/sdk';
  import { Button, LoadingSpinner, modalManager, Switch } from '@immich/ui';
  import { onDestroy, onMount, untrack } from 'svelte';
  import { t } from 'svelte-i18n';
  import type { PageData } from './$types';
  import { getPresetKey, getReasonKey, isRunning, normalizeFolder } from './reorganize';
  import ReorganizeFolderPicker from './ReorganizeFolderPicker.svelte';
  import ReorganizeRecord from './ReorganizeRecord.svelte';

  type Props = { data: PageData };
  let { data }: Props = $props();

  const PREVIEW_DELAY = 400;
  const POLL_INTERVAL = 1000;
  const ITEM_LIMIT = 200;
  const presets = [
    { value: ReorganizePreset.Day, example: '2026-09-27/' },
    { value: ReorganizePreset.YearMonth, example: '2026/09/' },
    { value: ReorganizePreset.YearDay, example: '2026/2026-09-27/' },
  ];

  let tab = $state<'new' | 'records'>('new');

  // what to reorganize
  let sourceType = $state(ReorganizeSourceType.Folder);
  let sourcePath = $state<string>();
  let album = $state<{ id: string; name: string }>();
  let includeSubfolders = $state(true);
  let targetPath = $state<string>();
  let preset = $state(ReorganizePreset.Day);
  let labels = $state<Record<string, string>>({});
  let autoRename = $state(false);
  let excludedLibraryIds = $state<string[]>([]);

  // what that would do
  let preview = $state<ReorganizePreviewResponseDto>();
  let isLoading = $state(false);
  let previewError = $state<string>();
  let detail = $state<{ key: string; total: number; items: ReorganizeItemDto[] }>();

  // what was done
  let records = $state<ReorganizationResponseDto[]>([]);
  /** the run started from this page, shown in place of the preview until the user is done with it */
  let featuredId = $state<string>();
  let isStarting = $state(false);

  const dto = $derived.by<ReorganizeDto | undefined>(() => {
    const hasSource = sourceType === ReorganizeSourceType.Folder ? !!sourcePath : !!album;
    if (!hasSource || !targetPath) {
      return;
    }
    return {
      sourceType,
      sourcePath: sourceType === ReorganizeSourceType.Folder ? sourcePath : undefined,
      sourceAlbumId: sourceType === ReorganizeSourceType.Album ? album?.id : undefined,
      includeSubfolders,
      targetPath,
      preset,
      labels,
      autoRename,
      excludedLibraryIds,
    };
  });

  const featured = $derived(records.find((record) => record.id === featuredId));
  const running = $derived(records.find((record) => isRunning(record)));
  const isInPlace = $derived(sourceType === ReorganizeSourceType.Folder && !!sourcePath && sourcePath === targetPath);

  // the preview follows the settings, a moment after the last change
  let requestId = 0;
  let previewTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const current = dto ? $state.snapshot(dto) : undefined;
    clearTimeout(previewTimer);
    detail = undefined;
    if (!current) {
      preview = undefined;
      return;
    }
    previewTimer = setTimeout(() => void loadPreview(current as ReorganizeDto), PREVIEW_DELAY);
  });

  const loadPreview = async (reorganizeDto: ReorganizeDto) => {
    const id = ++requestId;
    isLoading = true;
    try {
      const result = await previewReorganization({ reorganizeDto });
      if (id === requestId) {
        preview = result;
        previewError = undefined;
      }
    } catch (error) {
      if (id === requestId) {
        preview = undefined;
        previewError = (error as { data?: { message?: string } })?.data?.message ?? String(error);
      }
    } finally {
      if (id === requestId) {
        isLoading = false;
      }
    }
  };

  const loadRecords = async () => {
    try {
      records = await getReorganizations();
    } catch (error) {
      handleError(error, $t('errors.unable_to_reorganize'));
    }
  };

  // while a run is going, follow it
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  $effect(() => {
    const id = running?.id;
    clearInterval(pollTimer);
    if (!id) {
      return;
    }
    const poll = async () => {
      try {
        const record = await getReorganization({ id });
        records = records.map((item) => (item.id === id ? record : item));
        // the folders changed under the preview
        if (!isRunning(record) && dto) {
          await loadPreview($state.snapshot(dto) as ReorganizeDto);
        }
      } catch {
        // a hiccup: the next tick tries again
      }
    };
    pollTimer = setInterval(() => void poll(), POLL_INTERVAL);
  });

  onMount(async () => {
    if (data.folder) {
      sourcePath = targetPath = normalizeFolder(data.folder);
    } else if (data.albumId) {
      sourceType = ReorganizeSourceType.Album;
      try {
        const info = await getAlbumInfo({ id: data.albumId });
        album = { id: info.id, name: info.albumName };
      } catch (error) {
        handleError(error, $t('errors.unable_to_reorganize'));
      }
    }
    await loadRecords();
    // come back to a run that is still going
    featuredId = untrack(() => running?.id);
  });

  onDestroy(() => {
    clearTimeout(previewTimer);
    clearInterval(pollTimer);
  });

  const pickSource = async () => {
    const path = await modalManager.show(ReorganizeFolderPicker, {
      title: $t('reorganize_source_folder'),
      path: sourcePath,
    });
    if (path) {
      // most reorganizations tidy a folder in place
      if (!targetPath || targetPath === sourcePath) {
        targetPath = path;
      }
      sourcePath = path;
      labels = {};
    }
  };

  const pickAlbum = async () => {
    const [picked] = (await modalManager.show(AlbumPickerModal, {})) ?? [];
    if (picked) {
      album = { id: picked.id, name: picked.albumName };
      labels = {};
      excludedLibraryIds = [];
    }
  };

  const pickTarget = async () => {
    const path = await modalManager.show(ReorganizeFolderPicker, {
      title: $t('reorganize_target_folder'),
      path: targetPath,
      allowNew: true,
    });
    if (path) {
      targetPath = path;
      labels = {};
    }
  };

  const toggleLibrary = (id: string, isIncluded: boolean) => {
    excludedLibraryIds = isIncluded ? excludedLibraryIds.filter((item) => item !== id) : [...excludedLibraryIds, id];
  };

  const toggleDetail = async (key: string, filter: Partial<ReorganizeItemsDto>) => {
    if (detail?.key === key || !dto) {
      detail = undefined;
      return;
    }
    try {
      const result = await previewReorganizationItems({
        reorganizeItemsDto: { ...($state.snapshot(dto) as ReorganizeDto), ...filter, limit: ITEM_LIMIT },
      });
      detail = { key, ...result };
    } catch (error) {
      handleError(error, $t('errors.unable_to_reorganize'));
    }
  };

  const start = async () => {
    if (!dto || !preview || isStarting) {
      return;
    }
    const isConfirmed = await modalManager.showDialog({
      prompt: $t('reorganize_start_prompt', { values: { count: preview.moveCount, folder: targetPath } }),
    });
    if (!isConfirmed) {
      return;
    }

    isStarting = true;
    try {
      const record = await createReorganization({ reorganizeDto: $state.snapshot(dto) as ReorganizeDto });
      records = [record, ...records];
      featuredId = record.id;
    } catch (error) {
      handleError(error, $t('errors.unable_to_reorganize'));
    } finally {
      isStarting = false;
    }
  };

  const onRecordChange = async (id: string, record?: ReorganizationResponseDto) => {
    records = record
      ? records.map((item) => (item.id === id ? record : item))
      : records.filter((item) => item.id !== id);
    if (!record && dto) {
      await loadPreview($state.snapshot(dto) as ReorganizeDto);
    }
  };

  const name = (path: string) => path.slice(path.lastIndexOf('/') + 1);
  /** A path as shown in the lists: without the source folder in front, where it is under it. */
  const short = (path: string) =>
    sourceType === ReorganizeSourceType.Folder && sourcePath && path.startsWith(`${sourcePath}/`)
      ? path.slice(sourcePath.length + 1)
      : path;
</script>

{#snippet detailList()}
  {#if detail}
    <div class="mt-2 max-h-80 overflow-auto rounded-lg bg-subtle p-2">
      <table class="w-full text-sm">
        <tbody>
          {#each detail.items as item (item.assetId)}
            <tr class="align-top">
              <td class="p-1 font-mono break-all">{short(item.fromPath)}</td>
              <td class="p-1 font-mono break-all">
                {#if item.toPath && item.toPath !== item.fromPath}
                  → {item.isRenamed ? name(item.toPath) : $t('reorganize_same_name')}
                {/if}
              </td>
              <td class="p-1 whitespace-nowrap text-gray-500 dark:text-gray-300">
                {#if item.hasSidecar}+xmp{/if}
                {#if item.reason}{$t(getReasonKey(item.reason), { default: item.reason })}{/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
      {#if detail.total > detail.items.length}
        <p class="p-1 text-xs text-gray-500 dark:text-gray-300">
          {$t('reorganize_list_capped', { values: { count: detail.items.length } })}
        </p>
      {/if}
    </div>
  {/if}
{/snippet}

<UserPageLayout title={$t('reorganize')}>
  <div class="p-4 pb-28 dark:text-white">
    <div class="mb-4 flex gap-6 border-b border-gray-300 dark:border-immich-dark-gray">
      <button
        type="button"
        class="pb-2 {tab === 'new' ? 'border-b-2 border-primary font-medium' : 'text-gray-500 dark:text-gray-300'}"
        onclick={() => (tab = 'new')}
      >
        {$t('reorganize_tab_new')}
      </button>
      <button
        type="button"
        class="pb-2 {tab === 'records' ? 'border-b-2 border-primary font-medium' : 'text-gray-500 dark:text-gray-300'}"
        onclick={() => (tab = 'records')}
      >
        {$t('reorganize_tab_records', { values: { count: records.length } })}
      </button>
    </div>

    {#if tab === 'records'}
      {#if records.length === 0}
        <p class="p-8 text-center text-gray-500 dark:text-gray-300">{$t('reorganize_no_records')}</p>
      {/if}
      <div class="flex flex-col gap-3">
        {#each records as record (record.id)}
          <ReorganizeRecord {record} onChange={(changed) => onRecordChange(record.id, changed)} />
        {/each}
      </div>
    {:else if featured}
      <div class="mx-auto max-w-3xl">
        <ReorganizeRecord record={featured} isFeatured onChange={(changed) => onRecordChange(featured.id, changed)} />
        {#if !isRunning(featured)}
          <div class="mt-3 flex justify-end">
            <Button onclick={() => (featuredId = undefined)}>{$t('done')}</Button>
          </div>
        {/if}
      </div>
    {:else}
      <p class="mb-4 text-sm text-gray-500 dark:text-gray-300">{$t('reorganize_description')}</p>
      <div class="flex flex-col gap-6 lg:flex-row">
        <aside class="flex shrink-0 flex-col gap-5 text-sm lg:w-80">
          <section>
            <h3 class="mb-1 text-xs font-medium text-gray-500 dark:text-gray-300">{$t('reorganize_source')}</h3>
            <div class="rounded-xl border border-gray-300 p-3 dark:border-immich-dark-gray">
              <div class="mb-2 flex gap-2">
                {#each [ReorganizeSourceType.Folder, ReorganizeSourceType.Album] as type (type)}
                  <button
                    type="button"
                    class="rounded-full px-3 py-0.5 {sourceType === type
                      ? 'bg-primary text-white dark:text-black'
                      : 'bg-gray-200 dark:bg-gray-700'}"
                    onclick={() => (sourceType = type)}
                  >
                    {$t(`reorganize_source_${type}`)}
                  </button>
                {/each}
              </div>
              {#if sourceType === ReorganizeSourceType.Folder}
                <p class="font-mono break-all">{sourcePath ?? $t('reorganize_not_chosen')}</p>
                <button type="button" class="underline" onclick={pickSource}>{$t('reorganize_choose')}</button>
                <label class="mt-2 flex items-center gap-2">
                  <Switch bind:checked={includeSubfolders} />
                  {$t('reorganize_include_subfolders')}
                </label>
              {:else}
                <p class="break-all">{album?.name ?? $t('reorganize_not_chosen')}</p>
                <button type="button" class="underline" onclick={pickAlbum}>{$t('reorganize_choose')}</button>
              {/if}
            </div>
          </section>

          <section>
            <h3 class="mb-1 text-xs font-medium text-gray-500 dark:text-gray-300">{$t('reorganize_target_folder')}</h3>
            <div class="rounded-xl border border-gray-300 p-3 dark:border-immich-dark-gray">
              <p class="font-mono break-all">{targetPath ?? $t('reorganize_not_chosen')}</p>
              {#if isInPlace}
                <p class="text-xs text-gray-500 dark:text-gray-300">{$t('reorganize_in_place')}</p>
              {/if}
              <button type="button" class="underline" onclick={pickTarget}>{$t('reorganize_choose')}</button>
            </div>
          </section>

          <section>
            <h3 class="mb-1 text-xs font-medium text-gray-500 dark:text-gray-300">{$t('reorganize_structure')}</h3>
            {#each presets as item (item.value)}
              <label class="flex items-center gap-2 py-1">
                <input type="radio" bind:group={preset} value={item.value} />
                {$t(getPresetKey(item.value))}
                <span class="ms-auto font-mono text-xs text-gray-500 dark:text-gray-300">{item.example}</span>
              </label>
            {/each}
          </section>

          <section>
            <h3 class="mb-1 text-xs font-medium text-gray-500 dark:text-gray-300">{$t('reorganize_name_taken')}</h3>
            <label class="flex items-center gap-2">
              <Switch bind:checked={autoRename} />
              {$t('reorganize_auto_rename')}
            </label>
          </section>

          {#if preview && preview.libraries.length > 1}
            <section>
              <h3 class="mb-1 text-xs font-medium text-gray-500 dark:text-gray-300">{$t('reorganize_libraries')}</h3>
              {#each preview.libraries as library (library.id)}
                <label class="flex items-center gap-2 py-1">
                  <Switch
                    bind:checked={() => !library.isExcluded, (isIncluded) => toggleLibrary(library.id, isIncluded)}
                  />
                  <span>
                    {library.name} · {library.count}
                    {#if !library.isTarget}
                      <span class="block text-xs text-amber-600">{$t('reorganize_cross_library')}</span>
                    {/if}
                  </span>
                </label>
              {/each}
            </section>
          {/if}
        </aside>

        <div class="min-w-0 grow">
          {#if previewError}
            <p class="rounded-xl bg-red-50 p-4 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
              {previewError}
            </p>
          {:else if !dto}
            <p class="p-8 text-center text-gray-500 dark:text-gray-300">{$t('reorganize_choose_first')}</p>
          {:else if !preview}
            <div class="flex justify-center p-8"><LoadingSpinner /></div>
          {:else}
            <div class="mb-4 grid grid-cols-2 gap-2 text-center text-sm sm:grid-cols-4" class:opacity-50={isLoading}>
              <div class="rounded-xl bg-subtle p-3">
                <b class="block text-2xl">{preview.moveCount}</b>{$t('reorganize_count_move')}
              </div>
              <div class="rounded-xl bg-subtle p-3">
                <b class="block text-2xl">{preview.inPlaceCount}</b>{$t('reorganize_count_in_place')}
              </div>
              <div class="rounded-xl bg-subtle p-3">
                <b class="block text-2xl">{autoRename ? preview.renameCount : preview.conflictCount}</b>
                {autoRename ? $t('reorganize_count_rename') : $t('reorganize_count_conflict')}
              </div>
              <div class="rounded-xl bg-subtle p-3">
                <b class="block text-2xl">{preview.skipCount}</b>{$t('reorganize_count_skip')}
              </div>
            </div>

            <h3 class="mb-2 text-xs font-medium text-gray-500 dark:text-gray-300">
              {$t('reorganize_after', { values: { folder: targetPath } })}
            </h3>
            <div class="rounded-xl border border-gray-300 dark:border-immich-dark-gray">
              {#each preview.folders as folder (folder.day ?? folder.folder)}
                {@const key = `folder:${folder.folder}`}
                <div class="border-b border-gray-200 p-3 last:border-0 dark:border-immich-dark-gray">
                  <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <button
                      type="button"
                      class="font-mono underline-offset-2 hover:underline"
                      onclick={() => toggleDetail(key, { folder: folder.folder })}
                    >
                      {detail?.key === key ? '▾' : '▸'}
                      {folder.folder}/
                    </button>
                    <span class="text-sm text-gray-500 dark:text-gray-300">
                      {$t('reorganize_folder_counts', {
                        values: { move: folder.moveCount, inPlace: folder.inPlaceCount, renamed: folder.renameCount },
                      })}
                    </span>
                    {#if folder.exists}
                      <span class="rounded-sm bg-gray-200 px-2 text-xs dark:bg-gray-700"
                        >{$t('reorganize_folder_exists')}</span
                      >
                    {/if}
                    {#if folder.day}
                      {@const day = folder.day}
                      <input
                        class="ms-auto w-40 rounded-lg border border-gray-300 bg-transparent px-2 py-1 text-sm dark:border-immich-dark-gray"
                        placeholder={$t('reorganize_label_placeholder')}
                        maxlength="60"
                        value={folder.label}
                        onchange={(event) => (labels = { ...labels, [day]: event.currentTarget.value })}
                      />
                    {/if}
                  </div>
                  {#if folder.day && folder.existingLabels.length > 1}
                    {@const day = folder.day}
                    <div class="mt-1 flex flex-wrap items-center gap-1 text-xs">
                      {$t('reorganize_existing_folders')}
                      {#each folder.existingLabels as label (label)}
                        <button
                          type="button"
                          class="rounded-sm bg-gray-200 px-2 dark:bg-gray-700"
                          onclick={() => (labels = { ...labels, [day]: label })}
                        >
                          {label ? `${day} ${label}` : day}
                        </button>
                      {/each}
                    </div>
                  {/if}
                  {#if detail?.key === key}{@render detailList()}{/if}
                </div>
              {:else}
                <p class="p-3 text-sm text-gray-500 dark:text-gray-300">{$t('reorganize_nothing_to_move')}</p>
              {/each}
            </div>

            {#if preview.staying.length > 0}
              <h3 class="mt-5 mb-2 text-xs font-medium text-gray-500 dark:text-gray-300">{$t('reorganize_staying')}</h3>
              <div class="rounded-xl border border-gray-300 p-3 text-sm dark:border-immich-dark-gray">
                {#each preview.staying as entry (entry.reason)}
                  {@const key = `reason:${entry.reason}`}
                  <div class="py-1">
                    <button
                      type="button"
                      class="flex w-full justify-between underline-offset-2 hover:underline"
                      onclick={() =>
                        toggleDetail(key, {
                          action: entry.action === 'conflict' ? ReorganizeAction.Conflict : ReorganizeAction.Skip,
                          reason: entry.reason,
                        })}
                    >
                      <span>{detail?.key === key ? '▾' : '▸'} {$t(getReasonKey(entry.reason))}</span>
                      <span>{entry.count}</span>
                    </button>
                    {#if detail?.key === key}{@render detailList()}{/if}
                  </div>
                {/each}
              </div>
            {/if}

            {#if preview.otherFileCount > 0}
              <p class="mt-3 text-xs text-gray-500 dark:text-gray-300">
                {$t('reorganize_other_files', { values: { count: preview.otherFileCount } })}
              </p>
            {/if}
          {/if}
        </div>
      </div>

      {#if preview && !previewError}
        <div
          class="fixed inset-s-4 inset-e-4 bottom-4 z-40 flex flex-wrap items-center gap-3 rounded-xl bg-subtle p-3 shadow-lg md:inset-s-72"
        >
          <span class="text-sm">
            {$t('reorganize_summary', {
              values: {
                photos: preview.moveCount,
                sidecars: preview.sidecarCount,
                created: preview.newFolderCount,
                removed: preview.emptyFolderCount,
              },
            })}
          </span>
          <Button
            class="ms-auto"
            loading={isStarting}
            disabled={isStarting || isLoading || preview.moveCount === 0 || !!running}
            onclick={start}
          >
            {running ? $t('reorganize_another_running') : $t('reorganize_start')}
          </Button>
        </div>
      {/if}
    {/if}
  </div>
</UserPageLayout>
