import {
  normalizeCategory,
  extractRfqCategorySignals,
  matchVendorAgainstSignals,
  getCategoryMatchedProcucevVendors,
  selectVendorsForCategories,
} from '@/lib/vendorMatching';
import type { VendorEntry } from '@/lib/types';

describe('vendorMatching module', () => {
  describe('normalizeCategory', () => {
    it('normalizes casing, ampersands, whitespace and punctuation', () => {
      expect(normalizeCategory('Hoses, Valves & Fittings')).toBe('hoses valves and fittings');
      expect(normalizeCategory('  MECHANICAL / ELECTRICAL  ')).toBe('mechanical electrical');
      expect(normalizeCategory('')).toBe('');
      expect(normalizeCategory(null)).toBe('');
    });
  });

  describe('extractRfqCategorySignals', () => {
    it('extracts unique category signals from header and line items', () => {
      const form = {
        majorCategory: 'Mechanical',
        minorCategory: 'Centrifugal Pumps',
        category: 'Pumps',
        lineItems: [
          { majorCategory: 'Mechanical', minorCategory: 'Centrifugal Pumps' },
          { majorCategory: 'Electrical', minorCategory: 'Motors & Drives' },
        ],
      };

      const { signals, rawSignals } = extractRfqCategorySignals(form);
      expect(rawSignals).toContain('Mechanical');
      expect(rawSignals).toContain('Centrifugal Pumps');
      expect(rawSignals).toContain('Motors & Drives');
      expect(signals).toContain('mechanical');
      expect(signals).toContain('centrifugal pumps');
      expect(signals).toContain('motors and drives');
    });

    it('handles empty forms safely', () => {
      const { signals, rawSignals } = extractRfqCategorySignals({});
      expect(signals).toEqual([]);
      expect(rawSignals).toEqual([]);
    });
  });

  describe('matchVendorAgainstSignals', () => {
    const mockVendor = {
      id: 'proc-1',
      name: 'Apex Pumps & Valves Ltd',
      majorCategory: 'Engineering Spares - Mechanical',
      minorCategories: ['Centrifugal Pumps', 'Gate Valves'],
      vendorSelectedCategories: ['Industrial Fluid Handling'],
      clientMappedCategories: [],
      rating: 4.8,
      source: 'procucev_network',
      status: 'PREFERRED ENTERPRISE SUPPLIER',
      contactPerson: 'Apex Contact',
      phone: '+91 9876543210',
      email: 'sales@apexpumps.com',
      location: 'Mumbai',
    } as unknown as VendorEntry;

    it('matches when vendor minor category matches signal with high score', () => {
      const result = matchVendorAgainstSignals(mockVendor, ['centrifugal pumps']);
      expect(result.isMatch).toBe(true);
      expect(result.matchScore).toBe(98);
      expect(result.matchedCategories).toContain('Centrifugal Pumps');
    });

    it('matches when vendor major category matches signal', () => {
      const result = matchVendorAgainstSignals(mockVendor, ['engineering spares mechanical']);
      expect(result.isMatch).toBe(true);
      expect(result.matchScore).toBe(95);
    });

    it('matches client mapped categories and vendor selected categories with exact and partial matches', () => {
      const vendorWithAllCategories: VendorEntry = {
        id: 'proc-all',
        name: 'Omni Supplier',
        majorCategory: 'Mechanical Engineering',
        minorCategories: ['Centrifugal Pumps'],
        clientMappedCategories: ['Industrial Turbines'],
        vendorSelectedCategories: ['Safety Valves'],
        rating: 4.9,
      } as unknown as VendorEntry;

      // Partial minor match
      const minorPartial = matchVendorAgainstSignals(vendorWithAllCategories, ['centrifugal']);
      expect(minorPartial.isMatch).toBe(true);
      expect(minorPartial.matchScore).toBe(92);

      // Exact mapped match
      const mappedExact = matchVendorAgainstSignals(vendorWithAllCategories, ['industrial turbines']);
      expect(mappedExact.isMatch).toBe(true);
      expect(mappedExact.matchScore).toBe(96);

      // Partial mapped match
      const mappedPartial = matchVendorAgainstSignals(vendorWithAllCategories, ['turbines']);
      expect(mappedPartial.isMatch).toBe(true);
      expect(mappedPartial.matchScore).toBe(90);

      // Partial major match
      const majorPartial = matchVendorAgainstSignals(vendorWithAllCategories, ['mechanical']);
      expect(majorPartial.isMatch).toBe(true);
      expect(majorPartial.matchScore).toBe(88);

      // Exact selected match
      const selExact = matchVendorAgainstSignals(vendorWithAllCategories, ['safety valves']);
      expect(selExact.isMatch).toBe(true);
      expect(selExact.matchScore).toBe(94);

      // Partial selected match
      const selPartial = matchVendorAgainstSignals(vendorWithAllCategories, ['valves']);
      expect(selPartial.isMatch).toBe(true);
      expect(selPartial.matchScore).toBe(86);
    });

    it('returns isMatch false when no category signals overlap or inputs are invalid', () => {
      const result = matchVendorAgainstSignals(mockVendor, ['civil and structural steel', 'cement']);
      expect(result.isMatch).toBe(false);
      expect(result.matchScore).toBe(0);
      expect(result.matchedCategories).toEqual([]);

      expect(matchVendorAgainstSignals(null as any, ['cat']).isMatch).toBe(false);
      expect(matchVendorAgainstSignals(mockVendor, []).isMatch).toBe(false);
      expect(matchVendorAgainstSignals(mockVendor, ['']).isMatch).toBe(false);
    });
  });

  describe('getCategoryMatchedProcucevVendors', () => {
    const vendors: VendorEntry[] = [
      {
        id: 'proc-1',
        name: 'Apex Pumps',
        majorCategory: 'Mechanical',
        minorCategories: ['Centrifugal Pumps'],
        rating: 4.8,
        source: 'procucev_network',
      } as unknown as VendorEntry,
      {
        id: 'proc-2',
        name: 'BuildCon Cement',
        majorCategory: 'Civil Works',
        minorCategories: ['Ready Mix Concrete'],
        rating: 4.5,
        source: 'procucev_network',
      } as unknown as VendorEntry,
      {
        id: 'proc-3',
        name: 'Beta Pumps',
        majorCategory: 'Mechanical',
        minorCategories: ['Centrifugal Pumps'],
        rating: 4.2,
        source: 'procucev_network',
      } as unknown as VendorEntry,
      {
        id: 'buyer-v-1',
        name: 'Private Roster Vendor',
        majorCategory: 'Mechanical',
        source: 'buyer_uploaded',
      } as unknown as VendorEntry,
    ];

    it('filters strictly to category-matched Procucev vendors and sorts by score and rating', () => {
      const matched = getCategoryMatchedProcucevVendors(vendors, ['mechanical', 'centrifugal pumps'], 80);
      expect(matched.length).toBeGreaterThanOrEqual(2);
      expect(matched[0].vendor.id).toBe('proc-1');
      expect(matched[1].vendor.id).toBe('proc-3');
    });

    it('returns empty array if no Procucev vendors cover the category or array is empty', () => {
      const matched = getCategoryMatchedProcucevVendors(vendors, ['aerospace composites'], 80);
      expect(matched).toHaveLength(0);
      expect(getCategoryMatchedProcucevVendors(null as any, ['cat'])).toHaveLength(0);
    });
  });

  describe('selectVendorsForCategories', () => {
    const pool: VendorEntry[] = [
      { id: 'v1', name: 'Cat 1 Vendor A', majorCategory: 'Cat1', rating: 4.9 } as unknown as VendorEntry,
      { id: 'v2', name: 'Cat 1 Vendor B', majorCategory: 'Cat1', rating: 4.5 } as unknown as VendorEntry,
      { id: 'v3', name: 'Cat 2 Vendor A', majorCategory: 'Cat2', rating: 4.8 } as unknown as VendorEntry,
      { id: 'v4', name: 'Cat 3 Vendor A', majorCategory: 'Cat3', rating: 4.7 } as unknown as VendorEntry,
      { id: 'v5', name: 'Cat 4 Vendor A', majorCategory: 'Cat4', rating: 4.6 } as unknown as VendorEntry,
      { id: 'v6', name: 'Cat 5 Vendor A', majorCategory: 'Cat5', rating: 4.5 } as unknown as VendorEntry,
    ];

    it('selects up to maxPerCategory per category when distinct categories > 3', () => {
      const result = selectVendorsForCategories(pool, ['Cat1', 'Cat2', 'Cat3', 'Cat4', 'Cat5'], 5);
      expect(result.length).toBe(6);
      const ids = result.map((r) => r.vendor.id);
      expect(ids).toContain('v1');
      expect(ids).toContain('v2');
      expect(ids).toContain('v3');
      expect(ids).toContain('v4');
      expect(ids).toContain('v5');
      expect(ids).toContain('v6');
    });

    it('selects and ranks all matched vendors when categories <= 3', () => {
      const result = selectVendorsForCategories(pool, ['Cat1', 'Cat2']);
      expect(result.length).toBe(3);
      expect(result[0].vendor.id).toBe('v1');
      expect(result[1].vendor.id).toBe('v3');
      expect(result[2].vendor.id).toBe('v2');
    });

    it('sorts matching vendors with equal scores by rating and falls back to vendor email', () => {
      const tiePool: VendorEntry[] = [
        { email: 'low@rating.com', name: 'Low Rated', majorCategory: 'Cat1', rating: 3.5 } as unknown as VendorEntry,
        { email: 'high@rating.com', name: 'High Rated', majorCategory: 'Cat1', rating: 4.8 } as unknown as VendorEntry,
        { email: 'norating@test.com', name: 'No Rating', majorCategory: 'Cat1' } as unknown as VendorEntry,
      ];
      const result = selectVendorsForCategories(tiePool, ['Cat1', 'Cat2', 'Cat3', 'Cat4', 'Cat5'], 2);
      expect(result.length).toBe(2);
      expect(result[0].vendor.email).toBe('high@rating.com');
      expect(result[1].vendor.email).toBe('low@rating.com');

      const directMatches = selectVendorsForCategories(tiePool, ['Cat1']);
      expect(directMatches[0].vendor.email).toBe('high@rating.com');
      expect(directMatches[1].vendor.email).toBe('low@rating.com');
      expect(directMatches[2].vendor.email).toBe('norating@test.com');
    });

    it('handles empty inputs safely', () => {
      expect(selectVendorsForCategories([], ['Cat1'])).toEqual([]);
      expect(selectVendorsForCategories(null as any, ['Cat1'])).toEqual([]);
      expect(selectVendorsForCategories(pool, [])).toEqual([]);
    });
  });
});

