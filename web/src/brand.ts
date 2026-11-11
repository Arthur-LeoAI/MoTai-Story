import brand from "../../shared/brand.json";

// The only place the frontend learns the product name. Both names are
// provisional; change them in shared/brand.json.
export const CODENAME: string = brand.codename;

const names: Record<string, string> = brand.name;

export function brandName(locale: string): string {
  return names[locale] ?? names.default;
}

// Neutral, brand-independent key for browser storage.
export function storageKey(name: string): string {
  return `${CODENAME}:${name}`;
}
