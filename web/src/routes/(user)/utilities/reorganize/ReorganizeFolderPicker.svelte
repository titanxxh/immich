<script lang="ts">
  import { handleError } from '$lib/utils/handle-error';
  import { getReorganizeFolders, type ReorganizeFoldersResponseDto } from '@immich/sdk';
  import { Button, Icon, LoadingSpinner, Modal, ModalBody, ModalFooter } from '@immich/ui';
  import { mdiArrowUp, mdiFolder } from '@mdi/js';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import { normalizeFolder } from './reorganize';

  type Props = {
    title: string;
    path?: string;
    /** Whether a folder that does not exist yet can be picked, for a target. */
    allowNew?: boolean;
    onClose: (path?: string) => void;
  };

  let { title, path, allowNew = false, onClose }: Props = $props();

  let listing = $state<ReorganizeFoldersResponseDto>();
  let newName = $state('');

  const load = async (folder?: string) => {
    try {
      listing = await getReorganizeFolders({ path: folder });
      newName = '';
    } catch (error) {
      // a folder that is gone or outside the libraries: start again from the libraries
      if (folder) {
        await load();
      } else {
        handleError(error, $t('errors.unable_to_list_folders'));
      }
    }
  };

  onMount(() => load(path));

  const name = (folder: string) => folder.slice(folder.lastIndexOf('/') + 1);
  const picked = $derived(
    listing?.path ? normalizeFolder(newName.trim() ? `${listing.path}/${newName.trim()}` : listing.path) : undefined,
  );
</script>

<Modal {title} {onClose} size="medium">
  <ModalBody>
    {#if !listing}
      <div class="flex justify-center p-8"><LoadingSpinner /></div>
    {:else}
      <p class="mb-2 font-mono text-sm break-all">{listing.path ?? $t('reorganize_libraries')}</p>
      <div class="max-h-96 overflow-y-auto rounded-xl border border-gray-300 dark:border-immich-dark-gray">
        {#if listing.path}
          <button
            type="button"
            class="flex w-full items-center gap-3 px-4 py-2 text-start hover:bg-gray-100 dark:hover:bg-immich-dark-gray"
            onclick={() => load(listing?.parent ?? undefined)}
          >
            <Icon icon={mdiArrowUp} size="20" />
            {$t('reorganize_folder_up')}
          </button>
        {/if}
        {#each listing.folders as folder (folder)}
          <button
            type="button"
            class="flex w-full items-center gap-3 px-4 py-2 text-start hover:bg-gray-100 dark:hover:bg-immich-dark-gray"
            onclick={() => load(folder)}
          >
            <Icon icon={mdiFolder} size="20" class="text-primary" />
            <span class="break-all">{listing.path ? name(folder) : folder}</span>
          </button>
        {:else}
          <p class="px-4 py-2 text-sm text-gray-500 dark:text-gray-300">{$t('reorganize_no_folders')}</p>
        {/each}
      </div>
      {#if allowNew && listing.path}
        <label class="mt-3 flex items-center gap-2 text-sm">
          {$t('reorganize_new_folder')}
          <input
            class="grow rounded-lg border border-gray-300 bg-transparent px-2 py-1 dark:border-immich-dark-gray"
            bind:value={newName}
          />
        </label>
      {/if}
    {/if}
  </ModalBody>
  <ModalFooter>
    <div class="flex w-full items-center gap-3">
      <span class="min-w-0 grow truncate font-mono text-xs text-gray-500 dark:text-gray-300">{picked ?? ''}</span>
      <Button color="secondary" onclick={() => onClose()}>{$t('cancel')}</Button>
      <Button disabled={!picked || newName.includes('/')} onclick={() => onClose(picked)}>
        {$t('reorganize_pick_folder')}
      </Button>
    </div>
  </ModalFooter>
</Modal>
