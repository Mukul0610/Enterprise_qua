const {
  evaluateQuotes,
  calculate360Evaluation,
  calculateRevisedRating,
} = require('../src/services/evaluationService');

describe('Evaluation Service & Scoring Math', () => {
  describe('evaluateQuotes', () => {
    test('identifies lowest price and assigns isBestPrice', () => {
      const quotes = [
        { vendorName: 'Vendor A', totalPrice: 50000, leadTimeDays: 14 },
        { vendorName: 'Vendor B', totalPrice: 42000, leadTimeDays: 10 },
        { vendorName: 'Vendor C', totalPrice: 60000, leadTimeDays: 21 },
      ];

      const ranked = evaluateQuotes(quotes);
      expect(ranked[1].isBestPrice).toBe(true);
      expect(ranked[0].isBestPrice).toBe(false);
      expect(ranked[1].rankLabel).toBe('L1');
      expect(ranked[0].rankLabel).toBe('L2');
      expect(ranked[2].rankLabel).toBe('L3');
      expect(ranked[1].aiMatchScore).toBeGreaterThan(ranked[2].aiMatchScore);
    });

    test('assigns L1, L2 ranking in ascending order based on comparable total including taxes and charges', () => {
      const quotes = [
        { vendorName: 'Vendor A', unitPrice: 50000, totalPrice: 50000000, taxes: 9000000, deliveryCharges: 0 },
        { vendorName: 'Vendor B', unitPrice: 1000, totalPrice: 1000000, taxes: 0, deliveryCharges: 0 },
      ];
      const ranked = evaluateQuotes(quotes);
      expect(ranked[1].rankLabel).toBe('L1');
      expect(ranked[1].isBestPrice).toBe(true);
      expect(ranked[0].rankLabel).toBe('L2');
      expect(ranked[0].isBestPrice).toBe(false);
    });

    test('handles empty quotes array gracefully', () => {
      expect(evaluateQuotes([])).toEqual([]);
      expect(evaluateQuotes(null)).toEqual([]);
    });
  });

  describe('calculate360Evaluation', () => {
    test('calculates weighted 6-pillar score for Mode 3 qualification', () => {
      const modules = {
        commercial: { score: 95 },
        technical: { score: 90 },
        quality: { score: 92 },
        delivery: { score: 88 },
        financial: { score: 85 },
        governance: { score: 90 },
      };

      const result = calculate360Evaluation(modules);
      expect(result.overallScore).toBeGreaterThan(85);
      expect(result.status).toBe('PREFERRED ENTERPRISE SUPPLIER');
      expect(result.moduleScores.commercial.weight).toBe(25);
    });

    test('marks status conditional when score is below 75', () => {
      const lowModules = {
        commercial: { score: 65 },
        technical: { score: 60 },
        quality: { score: 70 },
        delivery: { score: 65 },
        financial: { score: 60 },
        governance: { score: 65 },
      };

      const result = calculate360Evaluation(lowModules);
      expect(result.overallScore).toBeLessThan(75);
      expect(result.status).toBe('PROBATIONARY / CONDITIONAL');
    });

    test('marks status rejected when score is below 60', () => {
      const failModules = {
        commercial: { score: 40 },
        technical: { score: 50 },
        quality: { score: 40 },
        delivery: { score: 50 },
        financial: { score: 40 },
        governance: { score: 40 },
      };

      const result = calculate360Evaluation(failModules);
      expect(result.overallScore).toBeLessThan(60);
      expect(result.status).toBe('NON-COMPLIANT / REJECTED');
    });
  });

  describe('calculateRevisedRating', () => {
    test('calculates composite score blending historical and buyer audit scores', () => {
      const res = calculateRevisedRating({
        qualityScore: 90,
        costScore: 90,
        deliveryScore: 90,
        previousScore: 80,
      });

      expect(res.buyerAverage).toBe(90.0);
      // 80 * 0.6 + 90 * 0.4 = 48 + 36 = 84.0
      expect(res.newCompositeScore).toBe(84.0);
      expect(res.newRating).toBe(4.2);
    });
  });
});
