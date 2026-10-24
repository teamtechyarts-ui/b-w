import {
  DEFAULT_CATEGORY_ICON,
  CANONICAL_CATEGORY_ICON_MAP,
  getCategoryIconName,
  normalizeCategorySlug,
} from './categoryIconMapping';

describe('categoryIconMapping audit & verification suite', () => {
  describe('normalizeCategorySlug', () => {
    it('normalizes category strings to clean hyphenated slugs', () => {
      expect(normalizeCategorySlug('Wash & Fold')).toBe('wash-and-fold');
      expect(normalizeCategorySlug('Wash & Steam Iron')).toBe('wash-and-steam-iron');
      expect(normalizeCategorySlug('Premium Laundry')).toBe('premium-laundry');
      expect(normalizeCategorySlug('Household & Linen Care')).toBe('household-and-linen-care');
      expect(normalizeCategorySlug('Shoe Cleaning')).toBe('shoe-cleaning');
      expect(normalizeCategorySlug('Add-On Services')).toBe('add-on-services');
    });
  });

  describe('canonical seeded categories icon mapping', () => {
    it('maps Wash & Fold to wash-fold (laundry washing & folding)', () => {
      expect(getCategoryIconName('Wash & Fold')).toBe('wash-fold');
      expect(getCategoryIconName({ id: 'cat-1', name: 'Wash & Fold' })).toBe('wash-fold');
      expect(getCategoryIconName('wash-fold')).toBe('wash-fold');
    });

    it('maps Wash & Iron and Wash & Steam Iron to wash-iron (washing & ironing)', () => {
      expect(getCategoryIconName('Wash & Iron')).toBe('wash-iron');
      expect(getCategoryIconName('Wash & Steam Iron')).toBe('wash-iron');
      expect(getCategoryIconName({ id: 'cat-2', name: 'Wash & Iron' })).toBe('wash-iron');
    });

    it('maps Steam Ironing to iron (steam pressing)', () => {
      expect(getCategoryIconName('Steam Ironing')).toBe('iron');
      expect(getCategoryIconName({ id: 'cat-3', name: 'Steam Ironing' })).toBe('iron');
    });

    it('maps Premium Laundry to shirt (garment care)', () => {
      expect(getCategoryIconName('Premium Laundry')).toBe('shirt');
      expect(getCategoryIconName({ id: 'cat-4', name: 'Premium Laundry' })).toBe('shirt');
    });

    it('maps Dry Cleaning to hanger (garment hanger care)', () => {
      expect(getCategoryIconName('Dry Cleaning')).toBe('hanger');
      expect(getCategoryIconName({ id: 'cat-5', name: 'Dry Cleaning' })).toBe('hanger');
      expect(getCategoryIconName('dry-cleaning')).toBe('hanger');
    });

    it('maps Household & Linen Care to bed (bed / linen)', () => {
      expect(getCategoryIconName('Household & Linen Care')).toBe('bed');
      expect(getCategoryIconName({ id: 'cat-6', name: 'Household & Linen Care' })).toBe('bed');
      expect(getCategoryIconName('household-linen-care')).toBe('bed');
    });

    it('maps Shoe Cleaning to shoe (sneaker / shoe)', () => {
      expect(getCategoryIconName('Shoe Cleaning')).toBe('shoe');
      expect(getCategoryIconName({ id: 'cat-7', name: 'Shoe Cleaning' })).toBe('shoe');
      expect(getCategoryIconName('shoe-cleaning')).toBe('shoe');
    });

    it('maps Add-On Services to plus (plus / add-on)', () => {
      expect(getCategoryIconName('Add-On Services')).toBe('plus');
      expect(getCategoryIconName({ id: 'cat-8', name: 'Add-On Services' })).toBe('plus');
      expect(getCategoryIconName('add-ons')).toBe('plus');
    });
  });

  describe('dynamic and custom category semantics', () => {
    it('maps custom iron and steam services to iron', () => {
      expect(getCategoryIconName('Express Steam Press')).toBe('iron');
      expect(getCategoryIconName('Heavy Curtain Ironing')).toBe('iron');
    });

    it('maps custom footwear services to shoe', () => {
      expect(getCategoryIconName('Designer Sneaker Spa')).toBe('shoe');
      expect(getCategoryIconName('Leather Footwear Care')).toBe('shoe');
    });

    it('maps custom bedding and curtains to bed', () => {
      expect(getCategoryIconName('Duvet & Quilt Sanitization')).toBe('bed');
      expect(getCategoryIconName('Hotel Linen Service')).toBe('bed');
      expect(getCategoryIconName('Bedsheets & Pillow Covers')).toBe('bed');
    });

    it('maps custom traditional or formal garments to hanger', () => {
      expect(getCategoryIconName('Silk Saree Care')).toBe('hanger');
      expect(getCategoryIconName('Wedding Lehenga & Sherwani')).toBe('hanger');
      expect(getCategoryIconName('Tuxedo & Suit Dry Clean')).toBe('hanger');
    });

    it('maps general laundry to wash', () => {
      expect(getCategoryIconName('Everyday Wash & Dry')).toBe('wash');
      expect(getCategoryIconName('Campus Laundry Bag')).toBe('wash');
    });
  });

  describe('intentional neutral fallback behavior', () => {
    it('uses neutral tag fallback for unmapped custom and test categories', () => {
      expect(DEFAULT_CATEGORY_ICON).toBe('tag');
      expect(getCategoryIconName('new testing category edited')).toBe('tag');
      expect(getCategoryIconName('Miscellaneous')).toBe('tag');
      expect(getCategoryIconName('Unknown Service X')).toBe('tag');
      expect(getCategoryIconName('Special Projects')).toBe('tag');
    });

    it('does NOT fallback to sparkles, question mark, or cardboard box', () => {
      const fallback = getCategoryIconName('Unrelated Test Category 123');
      expect(fallback).not.toBe('sparkles');
      expect(fallback).not.toBe('box');
      expect(fallback).not.toBe('package');
      expect(fallback).toBe('tag');
    });

    it('handles null, undefined, empty, and invalid inputs safely', () => {
      expect(getCategoryIconName(null)).toBe('tag');
      expect(getCategoryIconName(undefined)).toBe('tag');
      expect(getCategoryIconName('')).toBe('tag');
      expect(getCategoryIconName('   ')).toBe('tag');
      expect(getCategoryIconName({ name: '' })).toBe('tag');
      expect(getCategoryIconName({ name: '   ' })).toBe('tag');
    });
  });
});
