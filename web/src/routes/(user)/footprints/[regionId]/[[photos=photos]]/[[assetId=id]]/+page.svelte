<script lang="ts">
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import ButtonContextMenu from '$lib/components/shared-components/context-menu/ButtonContextMenu.svelte';
  import AssetSelectControlBar from '$lib/components/timeline/AssetSelectControlBar.svelte';
  import Timeline from '$lib/components/timeline/Timeline.svelte';
  import ArchiveAction from '$lib/components/timeline/actions/ArchiveAction.svelte';
  import ChangeDate from '$lib/components/timeline/actions/ChangeDateAction.svelte';
  import ChangeDescription from '$lib/components/timeline/actions/ChangeDescriptionAction.svelte';
  import ChangeLocation from '$lib/components/timeline/actions/ChangeLocationAction.svelte';
  import CreateSharedLink from '$lib/components/timeline/actions/CreateSharedLinkAction.svelte';
  import DeleteAssets from '$lib/components/timeline/actions/DeleteAssetsAction.svelte';
  import DownloadAction from '$lib/components/timeline/actions/DownloadAction.svelte';
  import FavoriteAction from '$lib/components/timeline/actions/FavoriteAction.svelte';
  import SelectAllAssets from '$lib/components/timeline/actions/SelectAllAction.svelte';
  import { AssetAction } from '$lib/constants';
  import { assetMultiSelectManager } from '$lib/managers/asset-multi-select-manager.svelte';
  import { TimelineManager } from '$lib/managers/timeline-manager/timeline-manager.svelte';
  import { Route } from '$lib/route';
  import { getAssetBulkActions } from '$lib/services/asset.service';
  import { lang, locale } from '$lib/stores/preferences.store';
  import { ActionButton, Button, CommandPaletteDefaultProvider } from '@immich/ui';
  import { mdiArrowLeft, mdiDotsVertical } from '@mdi/js';
  import { t } from 'svelte-i18n';
  import { formatVisitDate, placeName } from '../../../footprints';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  let timelineManager = $state<TimelineManager>() as TimelineManager;
  const options = $derived({ regionId: data.region.id });

  const parents = $derived(
    [
      data.region.province && data.region.province.id !== data.region.id ? data.region.province : undefined,
      data.region.country,
    ]
      .filter((place) => place !== undefined)
      .map((place) => placeName(place, $lang))
      .join(' · '),
  );
</script>

<UserPageLayout
  title={placeName(data.region, $lang)}
  description={`${parents} · ${$t('footprints_first_visit')} ${formatVisitDate(data.region.firstVisitAt, $locale)}`}
>
  {#snippet buttons()}
    <Button href={Route.footprints()} size="small" variant="ghost" color="secondary" leadingIcon={mdiArrowLeft}>
      {$t('footprints')}
    </Button>
  {/snippet}

  <Timeline
    enableRouting={true}
    bind:timelineManager
    {options}
    assetInteraction={assetMultiSelectManager}
    removeAction={AssetAction.ARCHIVE}
  />
</UserPageLayout>

<section>
  {#if assetMultiSelectManager.selectionActive}
    <div class="fixed inset-s-0 top-0 w-full">
      <AssetSelectControlBar>
        {@const Actions = getAssetBulkActions($t)}
        <CommandPaletteDefaultProvider name={$t('assets')} actions={Object.values(Actions)} />
        <CreateSharedLink />
        <SelectAllAssets {timelineManager} assetInteraction={assetMultiSelectManager} />
        <ActionButton action={Actions.AddToAlbum} />
        <FavoriteAction
          removeFavorite={assetMultiSelectManager.isAllFavorite}
          onFavorite={(ids, isFavorite) => timelineManager.update(ids, (asset) => (asset.isFavorite = isFavorite))}
        ></FavoriteAction>
        <ButtonContextMenu icon={mdiDotsVertical} title={$t('menu')}>
          <DownloadAction menuItem />
          <ChangeDate menuItem />
          <ChangeDescription menuItem />
          <ChangeLocation menuItem />
          <ArchiveAction menuItem onArchive={(assetIds) => timelineManager.removeAssets(assetIds)} />
          <DeleteAssets
            menuItem
            onAssetDelete={(assetIds) => timelineManager.removeAssets(assetIds)}
            onUndoDelete={(assets) => timelineManager.upsertAssets(assets)}
          />
        </ButtonContextMenu>
      </AssetSelectControlBar>
    </div>
  {/if}
</section>
