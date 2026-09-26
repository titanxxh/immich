import type { TimelineManager } from '$lib/managers/timeline-manager/timeline-manager.svelte';

const DAY_COLORS = [
  '#e6194b',
  '#3cb44b',
  '#4363d8',
  '#f58231',
  '#911eb4',
  '#42d4f4',
  '#f032e6',
  '#9a6324',
  '#469990',
  '#800000',
];

export const getDayColor = (index: number) => DAY_COLORS[(index - 1) % DAY_COLORS.length];

/** e.g. "5月3日周六" or "Sat, May 3", for a local date (YYYY-MM-DD). */
export const formatDayDate = (date: string, locale: string | undefined) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString(locale, {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    timeZone: 'UTC',
  });

/** The date of the first day shown at the top of the timeline. */
export const getDateAtTop = (timelineManager: TimelineManager) => {
  const top = timelineManager.visibleWindow.top;
  for (const month of timelineManager.months) {
    if (month.top + month.height < top) {
      continue;
    }

    for (const day of month.timelineDays) {
      if (month.top + day.top + day.height > top) {
        const { year, month: monthOfYear } = month.yearMonth;
        return `${year}-${String(monthOfYear).padStart(2, '0')}-${String(day.day).padStart(2, '0')}`;
      }
    }
  }
};

/** Where a day starts in the timeline, if its month is loaded. */
export const getDayTop = (timelineManager: TimelineManager, date: string) => {
  const [year, month, day] = date.split('-').map(Number);
  const timelineMonth = timelineManager.months.find(
    ({ yearMonth }) => yearMonth.year === year && yearMonth.month === month,
  );
  const timelineDay = timelineMonth?.timelineDays.find((timelineDay) => timelineDay.day === day);
  return timelineMonth && timelineDay ? timelineMonth.top + timelineDay.top : undefined;
};
