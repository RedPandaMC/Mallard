/**
 * Snapshot helpers shared with production. The events → UsageSnapshot assembly
 * lives in the store (EventReader.readFilteredSnapshot) + UsageService, which is
 * the single production snapshot engine; the only piece needed here is the
 * incremental-update detector.
 */
import { UsageSnapshot } from './types';

export function isIncrementalUpdate(prev: UsageSnapshot | undefined, next: UsageSnapshot): boolean {
  if (!prev) return false;
  if (JSON.stringify(prev.filter) !== JSON.stringify(next.filter)) return false;
  const prevPts = prev.chartData.dailyBars.points;
  const nextPts = next.chartData.dailyBars.points;
  if (prevPts.length !== nextPts.length) return false;
  for (let i = 0; i < prevPts.length - 1; i++) {
    const prevPoint = prevPts[i]!;
    const nextPoint = nextPts[i]!;
    if (prevPoint.date !== nextPoint.date || prevPoint.credits !== nextPoint.credits) return false;
  }
  const prevLastPoint = prevPts[prevPts.length - 1];
  const nextLastPoint = nextPts[nextPts.length - 1];
  return !!prevLastPoint && !!nextLastPoint && prevLastPoint.date === nextLastPoint.date;
}
