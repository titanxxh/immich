import { ReorganizationStatus, type ReorganizationResponseDto } from '@immich/sdk';
import type { Translations } from 'svelte-i18n';

const key = (prefix: string, value: string) => `${prefix}_${value.replaceAll('-', '_')}` as Translations;

/** The translation key of why a photo stays or was renamed. */
export const getReasonKey = (reason: string) => key('reorganize_reason', reason);

/** The translation key of a folder structure. */
export const getPresetKey = (preset: string) => key('reorganize_preset', preset);

/** The translation key of how far one photo got. */
export const getItemStatusKey = (status: string) => key('reorganize_item', status);

/** A folder as the server knows it: absolute, without a trailing slash. */
export const normalizeFolder = (path: string) => {
  const absolute = path.startsWith('/') ? path : `/${path}`;
  return absolute.length > 1 ? absolute.replace(/\/+$/, '') : absolute;
};

export const isRunning = (record: Pick<ReorganizationResponseDto, 'status'>) =>
  record.status === ReorganizationStatus.Queued || record.status === ReorganizationStatus.Running;

export type RecordState =
  | 'running'
  | 'undoing'
  | 'completed'
  | 'partial'
  | 'cancelled'
  | 'interrupted'
  | 'paused'
  | 'undone'
  | 'partially_undone';

/** What a reorganization amounts to for the user, from its status, direction and counts. */
export const getRecordState = (record: ReorganizationResponseDto): RecordState => {
  if (isRunning(record)) {
    return record.isUndo ? 'undoing' : 'running';
  }
  if (record.status !== ReorganizationStatus.Completed) {
    return record.status as 'cancelled' | 'interrupted' | 'paused';
  }
  if (record.isUndo) {
    return record.movedCount + record.failedCount + record.undoSkippedCount > 0 ? 'partially_undone' : 'undone';
  }
  return record.failedCount > 0 ? 'partial' : 'completed';
};

/** Whether continuing would do anything: a run that stopped early, or one with photos that failed. */
export const canResume = (record: ReorganizationResponseDto) => {
  if (isRunning(record)) {
    return false;
  }
  return record.status !== ReorganizationStatus.Completed || record.failedCount > 0;
};

/** Whether there is anything to move back, including photos an earlier undo had to leave. */
export const canUndo = (record: ReorganizationResponseDto) =>
  !isRunning(record) && record.movedCount + record.undoSkippedCount > 0;

/** How many photos a run has dealt with, out of how many it has to. */
export const getProgress = (record: ReorganizationResponseDto) => {
  const total =
    record.pendingCount + record.movedCount + record.failedCount + record.undoneCount + record.undoSkippedCount;
  const done = record.isUndo
    ? record.undoneCount + record.undoSkippedCount + record.failedCount
    : record.movedCount + record.failedCount;
  return { done, total };
};
