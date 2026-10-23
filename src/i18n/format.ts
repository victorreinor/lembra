import { INTL_TAG, type Locale } from "./locale";

// Locale-aware formatting shared by the catalogs, core/text.ts and the page (no Node imports here).

export const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export const formatNumber = (n: number, locale: Locale) => n.toLocaleString(INTL_TAG[locale]);

export function formatBytes(n: number, locale: Locale): string {
  const units = ["B", "KB", "MB", "GB"];
  let value = n;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toLocaleString(INTL_TAG[locale], { maximumFractionDigits: 1 })} ${units[unit]}`;
}
