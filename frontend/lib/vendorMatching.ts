// ==============================================================================
// VENDOR CATEGORY MATCHING & SCORING MODULE
// ==============================================================================
// Resolves category signals from RFQs / line items and matches candidate vendors
// for Mode 1 (Private Roster), Mode 2 (Hybrid Sourcing), and Mode 3 (AI Discovery).
// ==============================================================================

import type { VendorEntry } from './types';
import { isProcucevVendor } from '../app/buyer/vendor-summary';

export interface CategoryMatchResult {
  isMatch: boolean;
  matchScore: number;
  matchedCategories: string[];
  matchedMajor: string;
}

export interface MatchedVendorResult {
  vendor: VendorEntry;
  matchScore: number;
  matchedCategories: string[];
  matchedMajor: string;
}

/**
 * Normalizes category strings for comparison by lowercasing, trimming,
 * and normalizing ampersands and punctuation.
 */
export function normalizeCategory(cat?: string | null): string {
  if (!cat) return '';
  return String(cat)
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[/_.,-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract all unique normalized category signals from an RFQ form or payload.
 */
export function extractRfqCategorySignals(form: {
  majorCategory?: string | null;
  minorCategory?: string | null;
  category?: string | null;
  lineItems?: Array<{ majorCategory?: string | null; minorCategory?: string | null; category?: string | null }>;
  extractedEntities?: Array<{ majorCategory?: string | null; minorCategory?: string | null; category?: string | null }>;
}): { signals: string[]; rawSignals: string[] } {
  const rawSet = new Set<string>();

  if (form.majorCategory?.trim()) rawSet.add(form.majorCategory.trim());
  if (form.minorCategory?.trim()) rawSet.add(form.minorCategory.trim());
  if (form.category?.trim()) rawSet.add(form.category.trim());

  const items = form.lineItems || form.extractedEntities || [];
  for (const item of items) {
    if (item.majorCategory?.trim()) rawSet.add(item.majorCategory.trim());
    if (item.minorCategory?.trim()) rawSet.add(item.minorCategory.trim());
    if (item.category?.trim()) rawSet.add(item.category.trim());
  }

  const rawSignals = Array.from(rawSet);
  const signals = Array.from(new Set(rawSignals.map(normalizeCategory).filter(Boolean)));

  return { signals, rawSignals };
}

/**
 * Checks if a vendor's categories match the given RFQ category signals.
 */
export function matchVendorAgainstSignals(
  vendor: VendorEntry,
  signals: string[]
): CategoryMatchResult {
  if (!vendor || !signals || signals.length === 0) {
    return { isMatch: false, matchScore: 0, matchedCategories: [], matchedMajor: vendor?.majorCategory || 'General Industrial' };
  }

  const matched = new Set<string>();
  let highestScore = 0;

  const vendorMajor = vendor.majorCategory ? normalizeCategory(vendor.majorCategory) : '';
  const vendorMinors = (Array.isArray(vendor.minorCategories) ? vendor.minorCategories : [])
    .map(normalizeCategory)
    .filter(Boolean);
  const vendorSelected = (Array.isArray(vendor.vendorSelectedCategories) ? vendor.vendorSelectedCategories : [])
    .map(normalizeCategory)
    .filter(Boolean);
  const vendorMapped = (Array.isArray(vendor.clientMappedCategories) ? vendor.clientMappedCategories : [])
    .map(normalizeCategory)
    .filter(Boolean);

  for (const signal of signals) {
    if (!signal) continue;

    // 1. Check Minor Categories match (highest specificity -> 98%)
    for (let i = 0; i < vendorMinors.length; i++) {
      const vMinor = vendorMinors[i];
      if (vMinor === signal) {
        matched.add(vendor.minorCategories![i]);
        highestScore = Math.max(highestScore, 98);
      } else if (vMinor.includes(signal) || signal.includes(vMinor)) {
        matched.add(vendor.minorCategories![i]);
        highestScore = Math.max(highestScore, 92);
      }
    }

    // 2. Check Client Mapped Categories (from PO history -> 96%)
    for (let i = 0; i < vendorMapped.length; i++) {
      const vMapped = vendorMapped[i];
      if (vMapped === signal) {
        matched.add(vendor.clientMappedCategories![i]);
        highestScore = Math.max(highestScore, 96);
      } else if (vMapped.includes(signal) || signal.includes(vMapped)) {
        matched.add(vendor.clientMappedCategories![i]);
        highestScore = Math.max(highestScore, 90);
      }
    }

    // 3. Check Major Category match (95%)
    if (vendorMajor) {
      if (vendorMajor === signal) {
        matched.add(vendor.majorCategory!);
        highestScore = Math.max(highestScore, 95);
      } else if (vendorMajor.includes(signal) || signal.includes(vendorMajor)) {
        matched.add(vendor.majorCategory!);
        highestScore = Math.max(highestScore, 88);
      }
    }

    // 4. Check Vendor Profile Selected Categories (94%)
    for (let i = 0; i < vendorSelected.length; i++) {
      const vSel = vendorSelected[i];
      if (vSel === signal) {
        matched.add(vendor.vendorSelectedCategories![i]);
        highestScore = Math.max(highestScore, 94);
      } else if (vSel.includes(signal) || signal.includes(vSel)) {
        matched.add(vendor.vendorSelectedCategories![i]);
        highestScore = Math.max(highestScore, 86);
      }
    }
  }

  const matchedList = Array.from(matched);
  const isMatch = matchedList.length > 0 && highestScore >= 80;

  return {
    isMatch,
    matchScore: isMatch ? highestScore : 0,
    matchedCategories: matchedList,
    matchedMajor: vendor.majorCategory || matchedList[0] || 'General Industrial',
  };
}

/** A Procucev vendor ranked by the V3 360° evaluation (category + location). */
export interface RankedProcucevVendor {
  vendor: VendorEntry;
  /** Combined 0–100 score used for ordering. */
  overallScore: number;
  /** The category-relevance component (0–100). */
  categoryScore: number;
  /** The delivery-location component (0–100). */
  locationScore: number;
  matchedCategories: string[];
  /** Human label describing why the vendor ranked where it did. */
  locationReason: string;
}

/**
 * Score how well a vendor's location serves a delivery destination.
 *
 * A deterministic, data-only heuristic — no external geocoding — so it is
 * stable in tests and offline:
 *   • Same 6-digit PIN prefix (first 3 digits = same postal district): 100
 *   • Same first PIN digit (same broad postal region/zone): 70
 *   • City or state name appears in the vendor's location string: 85 / 60
 *   • Nothing matched / no data: 40 (neutral — never zero, so a strong
 *     category match is not wiped out by missing location data)
 */
export function scoreVendorLocation(
  vendor: VendorEntry,
  destination: { location?: string | null; pincode?: string | null }
): { score: number; reason: string } {
  const vendorPin = String(vendor.pincode || '').replace(/\D/g, '');
  const destPin = String(destination.pincode || '').replace(/\D/g, '');

  if (vendorPin.length === 6 && destPin.length === 6) {
    if (vendorPin.slice(0, 3) === destPin.slice(0, 3)) {
      return { score: 100, reason: 'Same delivery district (PIN)' };
    }
    if (vendorPin[0] === destPin[0]) {
      return { score: 70, reason: 'Same postal region' };
    }
  }

  const destText = String(destination.location || '').toLowerCase();
  const vendorText = `${vendor.location || ''} ${vendor.city || ''} ${vendor.state || ''}`.toLowerCase();

  if (destText && vendor.city && destText.includes(String(vendor.city).toLowerCase())) {
    return { score: 85, reason: `Based in ${vendor.city}` };
  }
  if (destText && vendor.state && destText.includes(String(vendor.state).toLowerCase())) {
    return { score: 60, reason: `In ${vendor.state}` };
  }
  // Reverse: the vendor's location text mentions the destination.
  if (vendorText.trim() && destText && destText.split(/[\s,/]+/).some((tok) => tok.length >= 4 && vendorText.includes(tok))) {
    return { score: 60, reason: 'Regional overlap' };
  }

  return { score: 40, reason: 'Nationwide supplier' };
}

/**
 * Rank Procucev network vendors for a V3 (Autonomous) RFQ by a 360° evaluation
 * that blends category relevance with delivery-location proximity (and rating
 * as a final tie-break), returning at most `limit` vendors.
 *
 * Weighting: category relevance is the primary driver (70%), delivery location
 * secondary (30%) — a geographically close supplier that cannot supply the
 * category is useless, but between two capable suppliers the closer one wins.
 */
export function rankProcucevVendorsForV3(
  vendors: VendorEntry[],
  signals: string[],
  destination: { location?: string | null; pincode?: string | null },
  limit = 10
): RankedProcucevVendor[] {
  if (!Array.isArray(vendors)) return [];

  const procucevPool = vendors.filter(isProcucevVendor);
  const ranked: RankedProcucevVendor[] = [];

  for (const vendor of procucevPool) {
    const match = matchVendorAgainstSignals(vendor, signals);
    // With no category signals yet, fall back to a neutral baseline so the
    // panel still shows the network's top-rated suppliers rather than nothing.
    const categoryScore = signals.length === 0 ? 60 : match.matchScore;
    if (signals.length > 0 && categoryScore <= 0) continue;

    const loc = scoreVendorLocation(vendor, destination);
    const overallScore = Math.round(categoryScore * 0.7 + loc.score * 0.3);

    ranked.push({
      vendor,
      overallScore,
      categoryScore,
      locationScore: loc.score,
      matchedCategories: match.matchedCategories,
      locationReason: loc.reason,
    });
  }

  ranked.sort((a, b) => {
    if (b.overallScore !== a.overallScore) return b.overallScore - a.overallScore;
    if (b.categoryScore !== a.categoryScore) return b.categoryScore - a.categoryScore;
    return (b.vendor.rating || 0) - (a.vendor.rating || 0);
  });

  return ranked.slice(0, Math.max(0, limit));
}

/**
 * Filters Procucev marketplace vendors to only those that match the RFQ's categories.
 */
export function getCategoryMatchedProcucevVendors(
  vendors: VendorEntry[],
  signals: string[],
  minScore = 80
): MatchedVendorResult[] {
  if (!Array.isArray(vendors)) return [];

  const procucevPool = vendors.filter(isProcucevVendor);
  const results: MatchedVendorResult[] = [];

  for (const vendor of procucevPool) {
    const match = matchVendorAgainstSignals(vendor, signals);
    if (match.isMatch && match.matchScore >= minScore) {
      results.push({
        vendor,
        matchScore: match.matchScore,
        matchedCategories: match.matchedCategories,
        matchedMajor: match.matchedMajor,
      });
    }
  }

  // Sort by match score descending, then rating descending
  return results.sort((a, b) => {
    if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
    return (b.vendor.rating || 0) - (a.vendor.rating || 0);
  });
}

/**
 * Selects candidate vendors considering the rule:
 * If there are more than 3 categories, up to 5 vendors per category should be selected.
 */
export function selectVendorsForCategories(
  vendors: VendorEntry[],
  signals: string[],
  maxPerCategory = 5
): MatchedVendorResult[] {
  if (!Array.isArray(vendors) || !signals || signals.length === 0) return [];

  const rawSignals = Array.from(new Set(signals.map(normalizeCategory).filter(Boolean)));

  if (rawSignals.length > 3) {
    const selectedMap = new Map<string, MatchedVendorResult>();
    for (const signal of rawSignals) {
      const catMatches: MatchedVendorResult[] = [];
      for (const vendor of vendors) {
        const match = matchVendorAgainstSignals(vendor, [signal]);
        if (match.isMatch) {
          catMatches.push({
            vendor,
            matchScore: match.matchScore,
            matchedCategories: match.matchedCategories,
            matchedMajor: match.matchedMajor,
          });
        }
      }
      catMatches.sort((a, b) => {
        if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
        return (b.vendor.rating || 0) - (a.vendor.rating || 0);
      });
      for (const item of catMatches.slice(0, maxPerCategory)) {
        const key = item.vendor.id || item.vendor.email;
        if (key && !selectedMap.has(key)) {
          selectedMap.set(key, item);
        }
      }
    }
    return Array.from(selectedMap.values());
  }

  const results: MatchedVendorResult[] = [];
  for (const vendor of vendors) {
    const match = matchVendorAgainstSignals(vendor, rawSignals);
    if (match.isMatch) {
      results.push({
        vendor,
        matchScore: match.matchScore,
        matchedCategories: match.matchedCategories,
        matchedMajor: match.matchedMajor,
      });
    }
  }
  return results.sort((a, b) => {
    if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
    return (b.vendor.rating || 0) - (a.vendor.rating || 0);
  });
}
