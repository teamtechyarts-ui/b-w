import { IconName } from '../components/AppIcon';

/**
 * Standard neutral fallback icon for categories without a specific mapping.
 * Avoids reusing unrelated icons (such as 'sparkles', 'wash', or 'package')
 * and avoids displaying broken/error question mark glyphs.
 */
export const DEFAULT_CATEGORY_ICON: IconName = 'tag';

/**
 * Normalized canonical slug to IconName dictionary.
 * Maps backend-defined canonical category slugs to their intended semantic icon.
 */
export const CANONICAL_CATEGORY_ICON_MAP: Record<string, IconName> = {
  // Wash & Fold: laundry washing and folding representation
  'wash-fold': 'wash-fold',
  'wash-and-fold': 'wash-fold',

  // Wash & Steam Iron: washing and steam ironing representation
  'wash-steam-iron': 'wash-iron',
  'wash-and-steam-iron': 'wash-iron',

  // Premium Laundry: premium clothing and garment care
  'premium-laundry': 'shirt',
  'premium-garment-care': 'shirt',

  // Wash & Iron: washing and ironing representation
  'wash-iron': 'wash-iron',
  'wash-and-iron': 'wash-iron',

  // Steam Ironing: professional steam iron
  'steam-ironing': 'iron',
  'steam-iron': 'iron',

  // Dry Cleaning: professional dry cleaning & garment hanger care
  'dry-cleaning': 'hanger',
  'dry-clean': 'hanger',

  // Household & Linen Care: bedding, sheets, curtains & linens
  'household-linen-care': 'bed',
  'household-linen': 'bed',
  'linen-care': 'bed',
  'household-and-linen-care': 'bed',

  // Shoe Cleaning: shoe and sneaker restoration
  'shoe-cleaning': 'shoe',
  'shoe-care': 'shoe',
  'sneaker-cleaning': 'shoe',

  // Add-On Services: plus / add-on laundry treatments
  'add-on-services': 'plus',
  'add-ons': 'plus',
  'addon-services': 'plus',
  'add-on': 'plus',
};

/**
 * Normalizes a category name or slug into a clean comparison key.
 * e.g., "Household & Linen Care" -> "household-linen-care"
 */
export function normalizeCategorySlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export type CategoryInput =
  | { id?: string | null; name: string }
  | string
  | null
  | undefined;

/**
 * Centralized, type-safe category icon mapping utility.
 *
 * Resolves recognizable, semantically appropriate icons:
 * - Wash & Fold: 'wash' (washing machine)
 * - Wash & Steam Iron / Wash & Iron / Steam Ironing: 'iron'
 * - Premium Laundry: 'shirt' (clothing / garment care)
 * - Dry Cleaning: 'hanger' (garment care)
 * - Household & Linen Care: 'bed' (linen / bed)
 * - Shoe Cleaning: 'shoe' (sneaker / footwear)
 * - Add-On Services: 'plus' (plus / add-on)
 * - Unmapped / testing / custom categories: 'tag' (neutral category fallback)
 *
 * Preserves dynamic category support without hardcoding list of categories.
 */
export function getCategoryIconName(category: CategoryInput): IconName {
  if (!category) {
    return DEFAULT_CATEGORY_ICON;
  }

  const rawName = typeof category === 'string' ? category : category.name;
  if (!rawName || typeof rawName !== 'string') {
    return DEFAULT_CATEGORY_ICON;
  }

  const trimmed = rawName.trim();
  if (!trimmed) {
    return DEFAULT_CATEGORY_ICON;
  }

  // 1. Direct canonical slug match
  const slug = normalizeCategorySlug(trimmed);
  if (CANONICAL_CATEGORY_ICON_MAP[slug]) {
    return CANONICAL_CATEGORY_ICON_MAP[slug];
  }

  // 2. Direct slug without 'and'
  const slugNoAnd = slug.replace(/-and-/g, '-');
  if (CANONICAL_CATEGORY_ICON_MAP[slugNoAnd]) {
    return CANONICAL_CATEGORY_ICON_MAP[slugNoAnd];
  }

  // 3. Semantic keyword matching for dynamically defined or custom categories
  const lower = trimmed.toLowerCase();

  // Wash & Fold combinations (laundry washing + folding)
  if (lower.includes('wash') && lower.includes('fold')) {
    return 'wash-fold';
  }

  // Wash & Iron / Steam Iron combinations (laundry washing + ironing)
  if (
    lower.includes('wash') &&
    (lower.includes('iron') || lower.includes('press') || lower.includes('steam'))
  ) {
    return 'wash-iron';
  }

  // General laundry washing
  if (lower.includes('wash') || lower.includes('laundry')) {
    return 'wash';
  }

  // Pure Iron / Steam ironing
  if (lower.includes('iron') || lower.includes('steam')) {
    return 'iron';
  }

  // Shoe & Sneaker cleaning
  if (lower.includes('shoe') || lower.includes('sneaker') || lower.includes('footwear')) {
    return 'shoe';
  }

  // Bedding & Linens
  if (
    lower.includes('linen') ||
    lower.includes('bed') ||
    lower.includes('curtain') ||
    lower.includes('carpet') ||
    lower.includes('quilt') ||
    lower.includes('blanket') ||
    lower.includes('sheet') ||
    lower.includes('upholstery') ||
    lower.includes('pillow') ||
    lower.includes('household')
  ) {
    return 'bed';
  }

  // Dry cleaning & Garment care (suits, coats, blazers, gowns)
  if (
    lower.includes('dry clean') ||
    lower.includes('dry-clean') ||
    lower.includes('dryclean') ||
    (/\bdry\b/.test(lower) && !lower.includes('wash')) ||
    lower.includes('hanger') ||
    lower.includes('garment') ||
    lower.includes('coat') ||
    lower.includes('suit') ||
    lower.includes('jacket') ||
    lower.includes('blazer') ||
    lower.includes('saree') ||
    lower.includes('lehenga') ||
    lower.includes('gown')
  ) {
    return 'hanger';
  }

  // Premium laundry / specialized clothing care
  if (lower.includes('premium')) {
    return 'shirt';
  }

  // Add-on services / extras
  if (
    lower.includes('add') ||
    lower.includes('extra') ||
    lower.includes('plus') ||
    lower.includes('special request')
  ) {
    return 'plus';
  }

  // Folded laundry / Wash & Fold
  if (lower.includes('fold')) {
    return 'wash';
  }

  // General laundry washing
  if (
    lower.includes('wash') ||
    lower.includes('laundry') ||
    lower.includes('clean') ||
    lower.includes('clothes') ||
    lower.includes('apparel')
  ) {
    return 'wash';
  }

  // Intentional neutral category fallback (never reuse unrelated sparkles, question mark, or box)
  return DEFAULT_CATEGORY_ICON;
}
