import { t } from './i18n';
import type { ArchiveDepth } from './types';

export function submissionMessage(depth: ArchiveDepth): string {
  return depth === 0 ? t("Submitted") : depth === 1
    ? t("Submitted + will crawl URLs 1 hop out")
    : t("Submitted + will crawl URLs $1 hops out", depth);
}

export function submissionAge(submittedAt?: string, now = Date.now()): string {
  const timestamp = submittedAt ? Date.parse(submittedAt) : NaN;
  const elapsed = Math.max(0, now - timestamp);
  if (!Number.isFinite(timestamp)) return t("Submitted");
  if (elapsed > 86_400_000) {
    const date = new Date(timestamp);
    const pad = (value: number) => String(value).padStart(2, '0');
    const formatted = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${date.getHours() % 12 || 12}:${pad(date.getMinutes())}${date.getHours() < 12 ? 'am' : 'pm'}`;
    return t("Previously submitted on $1", formatted);
  }
  if (elapsed < 60_000) return t("Submitted $1s ago", Math.floor(elapsed / 1000));
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes === 1) return t("Submitted 1 minute ago");
  if (minutes < 60) return t("Submitted $1 minutes ago", minutes);
  const hours = Math.floor(minutes / 60);
  return hours === 1 ? t("Submitted 1 hour ago") : t("Submitted $1 hours ago", hours);
}

