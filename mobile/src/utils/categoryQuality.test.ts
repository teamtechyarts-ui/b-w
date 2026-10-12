import {isMalformedCategoryName} from './categoryQuality';

describe('category quality validator', () => {
  it('identifies blank, null, and undefined as malformed', () => {
    expect(isMalformedCategoryName(null)).toBe(true);
    expect(isMalformedCategoryName(undefined)).toBe(true);
    expect(isMalformedCategoryName('')).toBe(true);
    expect(isMalformedCategoryName('   ')).toBe(true);
  });

  it('identifies single-character labels such as "e" as malformed', () => {
    expect(isMalformedCategoryName('e')).toBe(true);
    expect(isMalformedCategoryName('E')).toBe(true);
    expect(isMalformedCategoryName('a')).toBe(true);
    expect(isMalformedCategoryName('1')).toBe(true);
    expect(isMalformedCategoryName('  e  ')).toBe(true);
  });

  it('identifies symbols-only strings as malformed', () => {
    expect(isMalformedCategoryName('---')).toBe(true);
    expect(isMalformedCategoryName('...')).toBe(true);
    expect(isMalformedCategoryName('!@#')).toBe(true);
  });

  it('preserves valid and legitimate custom category names', () => {
    expect(isMalformedCategoryName('Wash & Fold')).toBe(false);
    expect(isMalformedCategoryName('Wash & Steam Iron')).toBe(false);
    expect(isMalformedCategoryName('Dry Cleaning')).toBe(false);
    expect(isMalformedCategoryName('Household & Linen Care')).toBe(false);
    expect(isMalformedCategoryName('Shoe Cleaning')).toBe(false);
    expect(isMalformedCategoryName('Add-On Services')).toBe(false);
    expect(isMalformedCategoryName('Leather Care')).toBe(false);
    expect(isMalformedCategoryName('Wedding Gowns')).toBe(false);
    expect(isMalformedCategoryName('Spa')).toBe(false);
    expect(isMalformedCategoryName('Rug')).toBe(false);
    expect(isMalformedCategoryName('Cap')).toBe(false);
  });
});
