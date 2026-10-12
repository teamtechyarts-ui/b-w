/**
 * Category data quality and validation utility.
 *
 * Prevents blank or malformed category labels (such as single-letter test
 * placeholders like 'e') from being rendered as valid customer category cards,
 * while preserving legitimate custom category names exactly as stored.
 */

export function isMalformedCategoryName(name: string | null | undefined): boolean {
  if (!name) return true;
  const trimmed = name.trim();
  // Must have at least 2 characters (rejects single-character test entries such as 'e', 'a', etc.)
  if (trimmed.length < 2) return true;
  // Must contain at least one alphanumeric character (rejects purely punctuation/whitespace entries)
  if (!/[a-zA-Z0-9]/.test(trimmed)) return true;
  return false;
}
