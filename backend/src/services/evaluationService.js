/**
 * Parametric Quote Evaluation & 360° Vendor Scoring Service
 */

/**
 * Normalize and compare quotes for an RFQ
 * @param {Array} quotes - Array of vendor quotes
 * @returns {Array} - Ranked and enriched quotes
 */
function evaluateQuotes(quotes = []) {
  if (!Array.isArray(quotes) || quotes.length === 0) return [];

  // Comparable total quotation amount including applicable taxes and charges
  const getComparableAmount = (q) => {
    const base = Number(q.totalPrice) > 0 ? Number(q.totalPrice) : Number(q.unitPrice || 0);
    const taxes = Number(q.taxes || 0);
    const delivery = Number(q.deliveryCharges || 0);
    return base + taxes + delivery;
  };

  const validPrices = quotes.map(getComparableAmount).filter((p) => p > 0);
  const minPrice = validPrices.length > 0 ? Math.min(...validPrices) : 0;

  // Rank in ascending order of comparable total quotation amount (L1 = lowest price, L2 = 2nd lowest)
  const sortedQuotes = [...quotes].sort((a, b) => {
    const diff = getComparableAmount(a) - getComparableAmount(b);
    if (diff !== 0) return diff;
    return (Number(a.leadTimeDays) || 0) - (Number(b.leadTimeDays) || 0);
  });

  const quoteRanks = new Map();
  sortedQuotes.forEach((q, idx) => {
    const key = q.vendorId || q.id || q.vendorName || String(idx);
    quoteRanks.set(key, {
      rank: idx + 1,
      rankLabel: `L${idx + 1}`,
    });
  });

  return quotes.map((q, idx) => {
    const currentPrice = getComparableAmount(q);
    const isBestPrice = currentPrice === minPrice && minPrice > 0;
    const key = q.vendorId || q.id || q.vendorName || String(idx);
    const rankInfo = quoteRanks.get(key) || { rank: 1, rankLabel: 'L1' };

    // Price Score: Inverse ratio to minimum price
    const priceScore = currentPrice > 0 ? Math.min(100, Math.round((minPrice / currentPrice) * 100)) : 80;
    
    // Lead time score (faster is better; decays to 0 for excessive delays)
    const leadTime = Number(q.leadTimeDays !== undefined && q.leadTimeDays !== null ? q.leadTimeDays : 14);
    const leadTimeScore = Math.max(0, Math.min(100, Math.round(100 - leadTime * 2)));

    // Warranty score (more years of coverage yields higher score)
    const warranty = Number(q.warrantyYears !== undefined && q.warrantyYears !== null ? q.warrantyYears : 1);
    const warrantyScore = Math.min(100, Math.max(0, 50 + warranty * 10));

    // Weighted composite AI Match Score
    const priceWeight = Math.round(priceScore * 0.45);
    const leadTimeWeight = Math.round(leadTimeScore * 0.3);
    const warrantyWeight = Math.round(warrantyScore * 0.25);
    const aiMatchScore = Math.min(100, Math.max(0, priceWeight + leadTimeWeight + warrantyWeight));

    return {
      ...q,
      isBestPrice,
      rank: rankInfo.rank,
      rankLabel: rankInfo.rankLabel,
      comparableTotal: currentPrice,
      aiMatchScore,
      scoreBreakdown: {
        price: { score: priceScore, weighted: priceWeight, maxWeight: 45 },
        leadTime: { score: leadTimeScore, weighted: leadTimeWeight, maxWeight: 30 },
        warranty: { score: warrantyScore, weighted: warrantyWeight, maxWeight: 25 },
      },
      complianceStatus: q.complianceStatus || 'Pending Review',
      warrantyYears: q.warrantyYears !== undefined && q.warrantyYears !== null ? q.warrantyYears : 2,
    };
  });
}

/**
 * Calculate 360° 6-Pillar Evaluation for Mode 3 Sourcing
 * @param {object} moduleScores - Raw module scores (0-100)
 * @returns {object} - Weighted evaluation breakdown & overall score
 */
function calculate360Evaluation(moduleScores = {}) {
  const weights = {
    commercial: 0.25, // 25%
    technical: 0.15,  // 15%
    quality: 0.20,    // 20%
    delivery: 0.20,   // 20%
    financial: 0.10,  // 10%
    governance: 0.10, // 10%
  };

  const commercial = Number(moduleScores.commercial?.score ?? 90);
  const technical = Number(moduleScores.technical?.score ?? 88);
  const quality = Number(moduleScores.quality?.score ?? 92);
  const delivery = Number(moduleScores.delivery?.score ?? 90);
  const financial = Number(moduleScores.financial?.score ?? 85);
  const governance = Number(moduleScores.governance?.score ?? 90);

  const breakdown = {
    commercial: { score: commercial, maxScore: 100, weight: 25, weightedScore: commercial * weights.commercial },
    technical: { score: technical, maxScore: 100, weight: 15, weightedScore: technical * weights.technical },
    quality: { score: quality, maxScore: 100, weight: 20, weightedScore: quality * weights.quality },
    delivery: { score: delivery, maxScore: 100, weight: 20, weightedScore: delivery * weights.delivery },
    financial: { score: financial, maxScore: 100, weight: 10, weightedScore: financial * weights.financial },
    governance: { score: governance, maxScore: 100, weight: 10, weightedScore: governance * weights.governance },
  };

  const overallScore = parseFloat(
    (
      breakdown.commercial.weightedScore +
      breakdown.technical.weightedScore +
      breakdown.quality.weightedScore +
      breakdown.delivery.weightedScore +
      breakdown.financial.weightedScore +
      breakdown.governance.weightedScore
    ).toFixed(2)
  );

  let status = 'PREFERRED ENTERPRISE SUPPLIER';
  let systemAction = 'Full Qualification Approved - Circulate High-Value RFQs with Automated PO Issuance';

  if (overallScore < 60) {
    status = 'NON-COMPLIANT / REJECTED';
    systemAction = 'Qualification Rejected - Remediation plan required';
  } else if (overallScore < 75) {
    status = 'PROBATIONARY / CONDITIONAL';
    systemAction = 'Conditional Qualification - Require Category Manager Approval for RFQs';
  }

  return {
    overallScore,
    status,
    systemAction,
    moduleScores: breakdown,
  };
}

/**
 * Calculate revised composite vendor score and rating
 * @param {object} params
 * @param {number} params.qualityScore
 * @param {number} params.costScore
 * @param {number} params.deliveryScore
 * @param {number} params.previousScore
 * @returns {object} - Revised score and rating
 */
function calculateRevisedRating({ qualityScore, costScore, deliveryScore, previousScore = 85.0 }) {
  const buyerAverage = parseFloat(((qualityScore + costScore + deliveryScore) / 3).toFixed(2));
  // 60% historical platform weight + 40% latest buyer audit weight
  const newCompositeScore = parseFloat((previousScore * 0.6 + buyerAverage * 0.4).toFixed(2));
  const newRating = parseFloat((Math.min(5.0, (newCompositeScore / 100) * 5)).toFixed(1));

  return {
    buyerAverage,
    newCompositeScore,
    newRating,
  };
}

module.exports = {
  evaluateQuotes,
  calculate360Evaluation,
  calculateRevisedRating,
};
