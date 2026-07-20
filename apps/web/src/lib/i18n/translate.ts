// Pure translation lookup (Claude Final Complete Architecture §9).
// No React here so it can be unit-tested. Resolution order:
//   active dict → English fallback dict → the key itself (so a missing
// translation degrades to a visible, greppable key, never blank UI).
// Supports {name} interpolation.

export type Dict = Record<string, string>;

export function translate(
  dict: Dict,
  key: string,
  vars?: Record<string, string | number>,
  fallbackDict?: Dict,
): string {
  const template = dict[key] ?? fallbackDict?.[key] ?? key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match,
  );
}
