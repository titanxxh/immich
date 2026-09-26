<script lang="ts">
  // PROTOTYPE variant A: classic settings form (matches FeatureSettings), homes as editable rows.
  import GeolocationPointPickerModal from '$lib/modals/GeolocationPointPickerModal.svelte';
  import { Button, Field, Input, NumberInput, Switch, modalManager, toastManager } from '@immich/ui';
  import { addHome, removeHome, tripState } from './state.svelte';

  const pick = async (index: number) => {
    const home = tripState.homes[index];
    const point = await modalManager.show(GeolocationPointPickerModal, { point: { lat: home.lat, lng: home.lng } });
    if (point) {
      home.lat = point.lat;
      home.lng = point.lng;
    }
  };
</script>

<div class="mt-4 flex flex-col gap-6 sm:ms-4">
  <Field label="自动识别旅行" description="每晚把离开所有「家」的连续拍摄识别为旅行，并自动建相册">
    <Switch bind:checked={tripState.enabled} />
  </Field>

  <div class="flex flex-col gap-2">
    <p class="text-sm font-medium">家</p>
    <p class="text-xs text-gray-500">离所有家都超过半径才算在外地；可给每个家设生效时间段（搬过家时用）</p>
    <table class="w-full text-sm">
      <thead class="text-left text-xs text-gray-500">
        <tr><th>名称</th><th>坐标</th><th>半径 km</th><th>从</th><th>到</th><th></th></tr>
      </thead>
      <tbody>
        {#each tripState.homes as home, index (home.id)}
          <tr class="align-middle">
            <td class="pe-2"><Input bind:value={home.name} /></td>
            <td class="pe-2 whitespace-nowrap">
              <button type="button" class="text-primary underline" onclick={() => pick(index)}>
                {home.lat.toFixed(3)}, {home.lng.toFixed(3)}
              </button>
            </td>
            <td class="pe-2 w-24"><NumberInput bind:value={home.radiusKm} min={1} /></td>
            <td class="pe-2"><input type="date" class="rounded border px-2 py-1 dark:bg-gray-800" bind:value={home.from} /></td>
            <td class="pe-2"><input type="date" class="rounded border px-2 py-1 dark:bg-gray-800" bind:value={home.to} /></td>
            <td><Button size="small" variant="ghost" color="danger" onclick={() => removeHome(home.id)}>删除</Button></td>
          </tr>
        {/each}
      </tbody>
    </table>
    <div><Button size="small" variant="outline" onclick={() => addHome()}>+ 添加家</Button></div>
  </div>

  <Field label="包含一日游" description="只跨一个日历日的出行也建相册">
    <Switch bind:checked={tripState.includeDayTrips} />
  </Field>
  <Field label="最长间隔（小时）" description="相邻两张在外地的照片间隔超过它就切成两次旅行">
    <NumberInput bind:value={tripState.gapHours} min={1} />
  </Field>
  <Field label="最少照片数">
    <NumberInput bind:value={tripState.minAssets} min={1} />
  </Field>

  <div class="flex justify-end gap-2">
    <Button size="small" variant="outline" onclick={() => toastManager.primary('PROTOTYPE：已排队识别旅行')}>立即识别</Button>
    <Button size="small" onclick={() => toastManager.primary('PROTOTYPE：已保存（未持久化）')}>保存</Button>
  </div>
</div>
