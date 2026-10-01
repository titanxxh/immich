import { ReorganizationStatus, type ReorganizationResponseDto } from '@immich/sdk';
import { canResume, canUndo, getProgress, getReasonKey, getRecordState, normalizeFolder } from './reorganize';

const record = (extra: Partial<ReorganizationResponseDto> = {}) =>
  ({
    status: ReorganizationStatus.Completed,
    isUndo: false,
    pendingCount: 0,
    movedCount: 0,
    failedCount: 0,
    stayedCount: 0,
    undoneCount: 0,
    undoSkippedCount: 0,
    ...extra,
  }) as ReorganizationResponseDto;

describe('reorganize', () => {
  it('should name the translation key of a reason', () => {
    expect(getReasonKey('target-exists')).toBe('reorganize_reason_target_exists');
  });

  it('should normalize a folder', () => {
    expect(normalizeFolder('external/photos/')).toBe('/external/photos');
    expect(normalizeFolder('/external/photos')).toBe('/external/photos');
    expect(normalizeFolder('/')).toBe('/');
  });

  describe(getRecordState.name, () => {
    it('should tell a run from an undo in progress', () => {
      expect(getRecordState(record({ status: ReorganizationStatus.Running }))).toBe('running');
      expect(getRecordState(record({ status: ReorganizationStatus.Queued, isUndo: true }))).toBe('undoing');
    });

    it('should tell a clean run from one with failures', () => {
      expect(getRecordState(record({ movedCount: 3 }))).toBe('completed');
      expect(getRecordState(record({ movedCount: 3, failedCount: 1 }))).toBe('partial');
    });

    it('should tell a full undo from a partial one', () => {
      expect(getRecordState(record({ isUndo: true, undoneCount: 3 }))).toBe('undone');
      expect(getRecordState(record({ isUndo: true, undoneCount: 2, undoSkippedCount: 1 }))).toBe('partially_undone');
    });

    it('should pass on a run that stopped early', () => {
      expect(getRecordState(record({ status: ReorganizationStatus.Interrupted }))).toBe('interrupted');
      expect(getRecordState(record({ status: ReorganizationStatus.Paused, isUndo: true }))).toBe('paused');
    });
  });

  it('should allow continuing a run that stopped early or has failures', () => {
    expect(canResume(record({ status: ReorganizationStatus.Cancelled }))).toBe(true);
    expect(canResume(record({ failedCount: 1 }))).toBe(true);
    expect(canResume(record({ movedCount: 3 }))).toBe(false);
    expect(canResume(record({ status: ReorganizationStatus.Running }))).toBe(false);
  });

  it('should allow undoing while photos are in their new place', () => {
    expect(canUndo(record({ movedCount: 3 }))).toBe(true);
    expect(canUndo(record({ isUndo: true, undoneCount: 3 }))).toBe(false);
    expect(canUndo(record({ isUndo: true, undoneCount: 2, undoSkippedCount: 1 }))).toBe(true);
    expect(canUndo(record({ status: ReorganizationStatus.Running, movedCount: 3 }))).toBe(false);
  });

  it('should measure the progress of a run and of an undo', () => {
    expect(getProgress(record({ pendingCount: 6, movedCount: 3, failedCount: 1 }))).toEqual({ done: 4, total: 10 });
    expect(getProgress(record({ isUndo: true, movedCount: 6, undoneCount: 3, undoSkippedCount: 1 }))).toEqual({
      done: 4,
      total: 10,
    });
  });
});
