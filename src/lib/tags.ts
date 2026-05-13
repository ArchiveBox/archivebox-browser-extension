export function matchingTagSuggestions(tags: string[], value: string, excludedTags: string[] = []): string[] {
  const prefix = value.trim().toLowerCase();
  if (!prefix) return [];
  return tags
    .filter((tag) => tag.toLowerCase().startsWith(prefix))
    .filter((tag) => !excludedTags.includes(tag))
    .slice(0, 6);
}
