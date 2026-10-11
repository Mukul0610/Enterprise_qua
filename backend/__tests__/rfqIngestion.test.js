const request = require('supertest');

const app = require('../src/app');
const ingestion = require('../src/services/rfqIngestionService');
const storeService = require('../src/services/storeService');
const rfqSummaryService = require('../src/services/rfqSummaryService');
const { RFQ_CATEGORY_CLASSIFICATION, RFQ_INGESTION_CONFIG } = require('../src/config/constants');
const { CATEGORY_TAXONOMY_FIXTURE: taxonomy } = require('./fixtures/categoryTaxonomy');
const { authHeader } = require('./testHelpers');

const { STATUS, CONFIDENCE, DOMAIN_KEYWORD_MAP } = RFQ_CATEGORY_CLASSIFICATION;

// classifyLineItem resolves against an index the service loads from
// `category_division`. The suite must not reach a real database, so the index is
// primed from the captured master before each test and cleared afterwards.
beforeEach(() => {
  ingestion.primeTaxonomyIndex(taxonomy);
});

afterEach(() => {
  ingestion.resetTaxonomyIndex();
});

describe('RFQ ingestion service (AI line-item classification)', () => {
  // ── Generic category detection ─────────────────────────────────────────────
  describe('isGenericCategory', () => {
    test.each(['', '   ', 'various', 'Multiple', 'NOT SPECIFIED', 'n/a', 'misc', 'general goods'])(
      'treats %s as carrying no routing value',
      (value) => {
        expect(ingestion.isGenericCategory(value)).toBe(true);
      }
    );

    test.each([null, undefined, 42, {}])('treats the non-string %p as generic', (value) => {
      expect(ingestion.isGenericCategory(value)).toBe(true);
    });

    test.each(['Pumps & Accessories', 'Cables', 'TMT BARS'])('accepts the real category %s', (value) => {
      expect(ingestion.isGenericCategory(value)).toBe(false);
    });
  });

  // ── Keyword matching ───────────────────────────────────────────────────────
  describe('matchByKeyword', () => {
    test('prefers the longest keyword so a specific phrase wins', () => {
      // 'circuit breaker' and 'breaker'-like entries both appear; the specific
      // phrase must decide the minor category.
      expect(ingestion.matchByKeyword('400A Circuit Breaker MCCB').minor).toBe('Circuit Breakers');
      expect(ingestion.matchByKeyword('Centrifugal Pump 500 GPM').minor).toBe('Pumps & Accessories');
    });

    test.each([
      ['Flanged Gate Valve 4-inch', 'Hoses, Valves & Fittings'],
      ['XLPE Armoured Copper Cable', 'Cables'],
      ['Fe500D TMT Rebar 16mm', 'TMT BARS'],
      ['Rotary Screw Compressor', 'Compressors & Accessories'],
      ['Form 4b LV Switchgear', 'Electrical-Lv Switch Gears'],
    ])('maps %s to %s', (text, expected) => {
      expect(ingestion.matchByKeyword(text).minor).toBe(expected);
    });

    test('returns null when nothing matches so the caller can fall through', () => {
      expect(ingestion.matchByKeyword('Assorted unclassifiable widget')).toBeNull();
      expect(ingestion.matchByKeyword('')).toBeNull();
      expect(ingestion.matchByKeyword(null)).toBeNull();
    });
  });

  // ── Classification precedence, mirroring the Java service ──────────────────
  describe('classifyLineItem precedence', () => {
    test('1. an explicit item category wins over any keyword in the text', () => {
      const result = ingestion.classifyLineItem({
        itemName: 'Centrifugal Pump 500 GPM',
        majorCategory: 'Engineering Spares - Mechanical',
        minorCategory: 'Bearings & Accessories',
      });
      expect(result.minorCategory).toBe('Bearings & Accessories');
      expect(result.classificationStatus).toBe(STATUS.EXPLICIT);
      expect(result.categoryConfidence).toBe(CONFIDENCE.EXPLICIT);
    });

    test('2. a payload-level category applies when the item has none', () => {
      const result = ingestion.classifyLineItem({ itemName: 'Unclassifiable widget' }, 'Panels');
      expect(result.minorCategory).toBe('Panels');
      expect(result.classificationStatus).toBe(STATUS.EXPLICIT);
    });

    test('2b. a generic payload category does not short-circuit keyword matching', () => {
      const result = ingestion.classifyLineItem({ itemName: 'Centrifugal Pump' }, 'various');
      expect(result.minorCategory).toBe('Pumps & Accessories');
      expect(result.classificationStatus).toBe(STATUS.KEYWORD);
    });

    test('3. keyword matching reads the technical specification too', () => {
      const result = ingestion.classifyLineItem({
        itemName: 'Unnamed assembly',
        technicalSpecs: 'ANSI 150 flanged gate valve body',
      });
      expect(result.minorCategory).toBe('Hoses, Valves & Fittings');
      expect(result.categoryConfidence).toBe(CONFIDENCE.KEYWORD);
    });

    // Left blank rather than stamped with a placeholder. The previous default,
    // 'General Procurement' / 'General Industrial Goods', is not a row in
    // category_division, so neither dropdown could render it: the row arrived
    // looking empty but carried a value validation accepted, which let an
    // unclassified item be dispatched under a category no vendor is mapped to.
    test('4. leaves an unmatched item unclassified and flags it for review', () => {
      const result = ingestion.classifyLineItem({ itemName: 'Assorted unclassifiable widget' });
      expect(result).toMatchObject({
        majorCategory: '',
        minorCategory: '',
        category: '',
        classificationStatus: STATUS.DEFAULT,
        categoryConfidence: CONFIDENCE.DEFAULT,
      });
    });

    test('4b. leaves an item unclassified when the taxonomy index has not loaded', () => {
      // A failed taxonomy read degrades to keyword matching and flags the rest;
      // it never invents a category.
      ingestion.resetTaxonomyIndex();
      const result = ingestion.classifyLineItem({ itemName: 'Assorted unclassifiable widget' });
      expect(result.majorCategory).toBe('');
      expect(result.classificationStatus).toBe(STATUS.DEFAULT);
    });

    test('keeps an explicit major category alongside a payload-level minor', () => {
      const result = ingestion.classifyLineItem(
        { itemName: 'Widget', majorCategory: 'Civil Works' },
        'Roofing Sheets'
      );
      expect(result.majorCategory).toBe('Civil Works');
      expect(result.minorCategory).toBe('Roofing Sheets');
    });
  });

  // ── Every emitted pair must exist in the shared taxonomy ───────────────────
  // The review grid builds its two dropdowns from categories.json: the major
  // select lists the majors and the minor select lists only the minors under the
  // chosen major. A pair outside that file has no matching option, so the select
  // renders blank — which is how extracted items reached the buyer with both
  // category fields apparently empty.
  describe('classification resolves against the shared taxonomy', () => {
    const majors = new Set(taxonomy.map((group) => group.majorCategory));
    const pairs = new Set(
      taxonomy.flatMap((group) =>
        group.minorCategories.map((minor) => `${group.majorCategory}||${minor}`)
      )
    );
    const isRenderable = (result) =>
      pairs.has(`${result.majorCategory}||${result.minorCategory}`);

    test('every domain keyword maps to a pair that exists in the taxonomy', () => {
      const broken = Object.entries(DOMAIN_KEYWORD_MAP)
        .filter(([, pair]) => !pairs.has(`${pair.major}||${pair.minor}`))
        .map(([keyword]) => keyword);
      expect(broken).toEqual([]);
    });

    // The model names a minor and almost never a major, which used to leave the
    // major stamped with a placeholder that is not in the taxonomy at all.
    test('derives the major from the taxonomy when only a minor was extracted', () => {
      const result = ingestion.classifyLineItem({
        itemName: 'Industrial Electric Motor, 15 HP',
        category: 'Motors',
      });
      expect(result).toMatchObject({
        majorCategory: 'Engineering Spares - Electrical',
        minorCategory: 'Motors',
        classificationStatus: STATUS.EXPLICIT,
      });
      expect(majors.has(result.majorCategory)).toBe(true);
    });

    test('matches a minor case-insensitively and returns the taxonomy spelling', () => {
      const result = ingestion.classifyLineItem({ itemName: 'Rack', category: 'storage  racks' });
      expect(result).toMatchObject({
        majorCategory: 'Others – New Product',
        minorCategory: 'Storage Racks',
      });
    });

    // 'Panels' exists under both Engineering Spares - Electrical and CAPEX, so a
    // major the model did supply has to win.
    test('lets a real stated major disambiguate a minor shared by several', () => {
      const result = ingestion.classifyLineItem({
        itemName: 'Control panel',
        majorCategory: 'CAPEX - Equipment & Machinery',
        minorCategory: 'Panels',
      });
      expect(result.majorCategory).toBe('CAPEX - Equipment & Machinery');
      expect(isRenderable(result)).toBe(true);
    });

    test('ignores a stated major that is not in the taxonomy', () => {
      const result = ingestion.classifyLineItem({
        itemName: 'Cable drum',
        majorCategory: 'Sundries',
        minorCategory: 'Cables',
      });
      expect(result.majorCategory).toBe('Engineering Spares - Electrical');
      expect(isRenderable(result)).toBe(true);
    });

    // 'Valves', 'PPE' and 'Hand Protection' are umbrella words the model likes but
    // the taxonomy does not have. The item text has to route them instead of the
    // model's word being kept and rendered as an empty dropdown.
    test.each([
      ['Industrial Ball Valve, 2 inch', 'Valves', 'Engineering Spares - Mechanical', 'Hoses, Valves & Fittings'],
      ['Safety Helmet', 'PPE', 'Occuptional Health and Safety', 'Hemlets'],
      ['Nitrile Industrial Gloves, size L', 'Hand Protection', 'Occuptional Health and Safety', 'Gloves'],
    ])('routes %s past the umbrella label "%s"', (itemName, stated, major, minor) => {
      const result = ingestion.classifyLineItem({ itemName, category: stated });
      expect(result).toMatchObject({
        majorCategory: major,
        minorCategory: minor,
        classificationStatus: STATUS.KEYWORD,
      });
    });

    test('classifies a whole extracted document into renderable pairs', () => {
      const extracted = [
        { itemName: 'Industrial Electric Motor, 15 HP', quantity: 5, unit: 'Nos', category: 'Motors' },
        { itemName: 'Mild Steel Storage Rack, heavy duty', quantity: 20, unit: 'Nos', category: 'Storage Racks' },
        { itemName: 'Stainless Steel Fasteners, M10 x 50 mm', quantity: 500, unit: 'Nos', category: 'Fasteners' },
        { itemName: 'Industrial Ball Valve, 2 inch', quantity: 15, unit: 'Nos', category: 'Valves' },
        { itemName: 'PVC Electrical Cable, 4 sq.mm', quantity: 1000, unit: 'Mtr', category: 'Cables' },
        { itemName: 'Safety Helmet', quantity: 100, unit: 'Nos', category: 'PPE' },
        { itemName: 'Nitrile Industrial Gloves, size L', quantity: 250, unit: 'Pairs', category: 'Hand Protection' },
        { itemName: 'Industrial Air Filter', quantity: 30, unit: 'Nos', category: 'Filters' },
      ];

      const { entities } = ingestion.normalizeLineItems(extracted, {});

      expect(entities).toHaveLength(8);
      const unrenderable = entities
        .filter((entity) => !isRenderable(entity))
        .map((entity) => `${entity.itemName}: ${entity.majorCategory} / ${entity.minorCategory}`);
      expect(unrenderable).toEqual([]);
    });
  });

  // ── Field normalisation ────────────────────────────────────────────────────
  describe('normalizeQuantity', () => {
    test.each([
      [12, 12],
      ['24', 24],
      [2.5, 2.5],
    ])('keeps the usable quantity %p', (input, expected) => {
      expect(ingestion.normalizeQuantity(input)).toBe(expected);
    });

    test.each([0, -5, 'abc', null, undefined, ''])('defaults the unusable quantity %p to 1', (input) => {
      expect(ingestion.normalizeQuantity(input)).toBe(RFQ_INGESTION_CONFIG.DEFAULT_QUANTITY);
    });
  });

  // ── Monetary normalisation & budget derivation ─────────────────────────────
  describe('normalizeAmount', () => {
    test.each([
      [145000, 145000],
      ['145000', 145000],
      ['₹ 1,45,000', 145000],
      ['Rs. 4,500/-', 4500],
      ['INR 2500.50', 2500.5],
    ])('reads %p as a usable amount', (input, expected) => {
      expect(ingestion.normalizeAmount(input)).toBe(expected);
    });

    // Zero and negatives mean "not stated", so they never overwrite a real total.
    test.each([0, -5, '0', 'not quoted', '', '.', null, undefined, {}, NaN, Infinity])(
      'treats %p as no amount at all',
      (input) => {
        expect(ingestion.normalizeAmount(input)).toBeNull();
      }
    );
  });

  describe('lineItemValue', () => {
    test('prefers the stated line total over the unit rate', () => {
      expect(ingestion.lineItemValue({ totalPrice: 240000, unitPrice: 1 }, 12)).toBe(240000);
    });

    test('accepts the amount and rate column aliases a BOQ may use', () => {
      expect(ingestion.lineItemValue({ amount: 5000 }, 2)).toBe(5000);
      expect(ingestion.lineItemValue({ rate: 250 }, 4)).toBe(1000);
    });

    test('multiplies the unit rate by the quantity when only a rate is stated', () => {
      expect(ingestion.lineItemValue({ unitPrice: 4500 }, 24)).toBe(108000);
    });

    test('returns null for an unpriced line', () => {
      expect(ingestion.lineItemValue({ itemName: 'Gasket Set' }, 10)).toBeNull();
    });
  });

  describe('deriveEstimatedBudget', () => {
    test('a stated total wins over the sum of the lines', () => {
      expect(ingestion.deriveEstimatedBudget(890000, [1000, 2000])).toBe(890000);
    });

    test('sums the priced lines and ignores the unpriced ones', () => {
      expect(ingestion.deriveEstimatedBudget(null, [240000, null, 108000])).toBe(348000);
    });

    test('rounds a float sum to whole currency units', () => {
      expect(ingestion.deriveEstimatedBudget(null, [0.1, 0.2])).toBe(0);
      expect(ingestion.deriveEstimatedBudget(null, [1500.4, 1500.4])).toBe(3001);
    });

    test('returns null when nothing was priced', () => {
      expect(ingestion.deriveEstimatedBudget(null, [null, null])).toBeNull();
      expect(ingestion.deriveEstimatedBudget(undefined, [])).toBeNull();
    });
  });

  test('defaultTargetDate returns an ISO date the configured number of days out', () => {
    const expected = new Date();
    expected.setDate(expected.getDate() + RFQ_INGESTION_CONFIG.DELIVERY_DATE_OFFSET_DAYS);
    expect(ingestion.defaultTargetDate()).toBe(expected.toISOString().slice(0, 10));
    expect(ingestion.defaultTargetDate(0)).toBe(new Date().toISOString().slice(0, 10));
  });

  test('buildDeduplicationKey is case and whitespace insensitive', () => {
    const a = { itemName: ' Pump ', quantity: 2, unit: 'Nos', targetDate: '2026-09-15', technicalSpecs: 'SS316' };
    const b = { itemName: 'pump', quantity: 2, unit: 'nos', targetDate: '2026-09-15', technicalSpecs: 'ss316' };
    expect(ingestion.buildDeduplicationKey(a)).toBe(ingestion.buildDeduplicationKey(b));
  });

  describe('normalizeLineItems', () => {
    test('applies the documented defaults for quantity, unit and target date', () => {
      const { entities } = ingestion.normalizeLineItems([
        { description: 'Centrifugal Pump', quantity: 0 },
      ]);
      expect(entities).toHaveLength(1);
      expect(entities[0]).toMatchObject({
        itemName: 'Centrifugal Pump',
        quantity: RFQ_INGESTION_CONFIG.DEFAULT_QUANTITY,
        unit: RFQ_INGESTION_CONFIG.DEFAULT_UNIT,
        minorCategory: 'Pumps & Accessories',
      });
      expect(entities[0].targetDate).toBe(ingestion.defaultTargetDate());
    });

    test('drops rows with no description rather than surfacing blank lines', () => {
      const { entities } = ingestion.normalizeLineItems([
        { itemName: '   ', quantity: 5 },
        {},
        { itemName: 'Gate Valve', quantity: 3 },
      ]);
      expect(entities).toHaveLength(1);
      expect(entities[0].itemName).toBe('Gate Valve');
    });

    test('collapses duplicate rows and reports how many were removed', () => {
      const row = { itemName: 'Cable', quantity: 100, unit: 'Meters', targetDate: '2026-09-20', technicalSpecs: 'XLPE' };
      const { entities, duplicatesRemoved } = ingestion.normalizeLineItems([row, { ...row }, { ...row }]);
      expect(entities).toHaveLength(1);
      expect(duplicatesRemoved).toBe(2);
    });

    test('accepts the specification alias used by spreadsheet exports', () => {
      const { entities } = ingestion.normalizeLineItems([
        { itemName: 'Bespoke assembly', specification: 'Gate valve, ANSI 150' },
      ]);
      expect(entities[0].technicalSpecs).toBe('Gate valve, ANSI 150');
      expect(entities[0].minorCategory).toBe('Hoses, Valves & Fittings');
    });

    test('tolerates a non-array payload', () => {
      expect(ingestion.normalizeLineItems(undefined).entities).toEqual([]);
      expect(ingestion.normalizeLineItems(null).entities).toEqual([]);
    });

    // A sparse sheet can produce null or primitive rows; one bad cell must not
    // fail the whole ingest.
    test('skips null and primitive rows instead of throwing', () => {
      const { entities } = ingestion.normalizeLineItems([
        null,
        undefined,
        'Centrifugal Pump',
        42,
        { itemName: 'Gate Valve', quantity: 3 },
      ]);
      expect(entities).toHaveLength(1);
      expect(entities[0].itemName).toBe('Gate Valve');
    });

    test('exposes confidence as a percentage for the review grid', () => {
      const { entities } = ingestion.normalizeLineItems([{ itemName: 'Centrifugal Pump' }]);
      expect(entities[0].confidence).toBe(90);
    });

    test('filters out invalid or non-positive quantities when requireValidQuantity is enabled', () => {
      const mixedItems = [];
      for (let i = 1; i <= 100; i++) {
        mixedItems.push({ itemName: `Valid Item ${i}`, quantity: i, unit: 'Nos' });
        mixedItems.push({ itemName: `Invalid Zero ${i}`, quantity: 0, unit: 'Nos' });
        mixedItems.push({ itemName: `Invalid Negative ${i}`, quantity: -1, unit: 'Nos' });
        mixedItems.push({ itemName: `Invalid Null ${i}`, quantity: null, unit: 'Nos' });
        mixedItems.push({ itemName: `Invalid NaN ${i}`, quantity: 'abc', unit: 'Nos' });
      }

      // Total 500 items, only 100 have valid positive quantities
      const { entities } = ingestion.normalizeLineItems(mixedItems, { requireValidQuantity: true });
      expect(entities).toHaveLength(100);
      expect(entities[0].itemName).toBe('Valid Item 1');
      expect(entities[99].itemName).toBe('Valid Item 100');
    });
  });

  describe('deriveTitle', () => {
    test('uses the single item description for a one-line RFQ', () => {
      expect(ingestion.deriveTitle([{ itemName: 'Centrifugal Pump' }])).toBe(
        `Centrifugal Pump${RFQ_INGESTION_CONFIG.TITLE_SUFFIX_SINGLE}`
      );
    });

    test('signals breadth when the RFQ covers several items', () => {
      expect(ingestion.deriveTitle([{ itemName: 'Pump' }, { itemName: 'Valve' }])).toBe(
        `Pump${RFQ_INGESTION_CONFIG.TITLE_SUFFIX_MULTIPLE}`
      );
    });

    test('truncates an over-long title to the RFQ header limit', () => {
      const title = ingestion.deriveTitle([{ itemName: 'X'.repeat(200) }]);
      expect(title).toHaveLength(RFQ_INGESTION_CONFIG.MAX_TITLE_LENGTH);
      expect(title.endsWith('…')).toBe(true);
    });

    test('returns an empty string when there are no items', () => {
      expect(ingestion.deriveTitle([])).toBe('');
    });
  });

  describe('buildRFQDraft', () => {
    test('produces a review-ready draft with a classification breakdown', async () => {
      const { draft, classification } = await ingestion.buildRFQDraft({
        lineItems: [
          { itemName: 'Centrifugal Pump 500 GPM', quantity: 12, unit: 'Units', targetDate: '2026-09-15' },
          { itemName: 'Flanged Gate Valve', quantity: 24, unit: 'Units', targetDate: '2026-09-18' },
          { itemName: 'Assorted unclassifiable widget', quantity: 4 },
        ],
        sourceFileName: 'BOQ.xlsx',
      });

      expect(draft.extractedEntities).toHaveLength(3);
      expect(draft.targetDeliveryDate).toBe('2026-09-15');
      expect(draft.sourceFileName).toBe('BOQ.xlsx');
      expect(draft.source).toBe('web_portal');
      expect(classification).toMatchObject({
        totalExtracted: 3,
        accepted: 3,
        duplicatesRemoved: 0,
        needsReview: 1,
        autoClassified: 2,
      });
    });

    test('sets the header category from the dominant major, not just the first item', async () => {
      const { draft } = await ingestion.buildRFQDraft({
        lineItems: [
          { itemName: 'Copper Cable' },
          { itemName: 'LV Panel' },
          { itemName: 'Centrifugal Pump' },
        ],
      });
      expect(draft.category).toBe('Engineering Spares - Electrical');
    });

    test('uses a declared major category for the header and fills items that have none', async () => {
      const { draft, classification } = await ingestion.buildRFQDraft({
        category: 'Civil Works',
        lineItems: [
          { itemName: 'Ordinary Portland Cement' },
          { itemName: 'River sand' },
          { itemName: 'Copper Cable' },
        ],
      });
      expect(draft.category).toBe('Civil Works');
      expect(draft.extractedEntities[0].majorCategory).toBe('Civil Works');
      expect(draft.extractedEntities[1].majorCategory).toBe('Civil Works');
      // The copper cable keeps its own classification and is flagged, not overridden.
      expect(draft.extractedEntities[2].majorCategory).toBe('Engineering Spares - Electrical');
      expect(draft.extractedEntities[2].categoryMismatch).toBe(true);
      expect(classification.needsReview).toBeGreaterThanOrEqual(1);
    });

    test('resolves a declared minor category to its own major', async () => {
      const { draft } = await ingestion.buildRFQDraft({
        category: 'Cement Bulkers',
        lineItems: [{ itemName: 'Centrifugal Pump' }],
      });
      expect(draft.category).toBe('CAPEX - Equipment & Machinery');
    });

    test('lists the taxonomy names for the model prompt', () => {
      const { majors, minors } = ingestion.taxonomyCategoryNames();
      expect(majors).toContain('Civil Works');
      expect(minors).toContain('Cement Bulkers');
      expect(new Set(minors).size).toBe(minors.length);
    });

    test('prefers an explicit title over the derived one', async () => {
      const { draft } = await ingestion.buildRFQDraft({
        title: 'Q3 Mechanical Spares',
        lineItems: [{ itemName: 'Centrifugal Pump' }],
      });
      expect(draft.title).toBe('Q3 Mechanical Spares');
    });

    test('carries the source email through for the email gateway path', async () => {
      const { draft } = await ingestion.buildRFQDraft({
        lineItems: [{ itemName: 'Centrifugal Pump' }],
        source: 'email_gateway',
        sourceEmail: 'plant@lt-heavy.com',
      });
      expect(draft.source).toBe('email_gateway');
      expect(draft.sourceEmail).toBe('plant@lt-heavy.com');
    });

    test('reports an empty result rather than throwing', async () => {
      const { draft, classification } = await ingestion.buildRFQDraft({ lineItems: [] });
      expect(draft.extractedEntities).toEqual([]);
      expect(draft.category).toBe('');
      expect(classification.accepted).toBe(0);
    });

    test('defaults to an empty payload when called with no arguments', async () => {
      expect((await ingestion.buildRFQDraft()).classification.accepted).toBe(0);
    });

    test('derives the estimated budget by summing the priced lines', async () => {
      const { draft } = await ingestion.buildRFQDraft({
        lineItems: [
          { itemName: 'Centrifugal Pump', quantity: 12, totalPrice: 240000 },
          { itemName: 'Flanged Gate Valve', quantity: 24, unitPrice: 4500 },
        ],
      });
      expect(draft.estimatedBudget).toBe(348000);
    });

    test('counts a collapsed duplicate once in the estimated budget', async () => {
      const { draft, classification } = await ingestion.buildRFQDraft({
        lineItems: [
          { itemName: 'Centrifugal Pump', quantity: 12, unit: 'Units', targetDate: '2026-09-15', totalPrice: 240000 },
          { itemName: 'Centrifugal Pump', quantity: 12, unit: 'Units', targetDate: '2026-09-15', totalPrice: 240000 },
        ],
      });
      expect(classification.duplicatesRemoved).toBe(1);
      expect(draft.estimatedBudget).toBe(240000);
    });

    test('leaves the estimated budget null when the document had no pricing', async () => {
      const { draft } = await ingestion.buildRFQDraft({ lineItems: [{ itemName: 'Centrifugal Pump' }] });
      expect(draft.estimatedBudget).toBeNull();
    });

    test('processes all 100 valid items from a 200-item batch when requireValidQuantity is enabled', async () => {
      const items = [];
      for (let i = 1; i <= 100; i++) {
        items.push({ itemName: `Procurement Valve ${i}`, quantity: i + 5, unit: 'Units' });
        items.push({ itemName: `Omitted Line ${i}`, quantity: 0, unit: 'Units' });
      }

      const { draft, classification } = await ingestion.buildRFQDraft({
        lineItems: items,
        title: 'Bulk 100 Valves',
        requireValidQuantity: true,
      });

      expect(classification.accepted).toBe(100);
      expect(draft.extractedEntities).toHaveLength(100);
      expect(draft.extractedEntities[0].itemName).toBe('Procurement Valve 1');
      expect(draft.extractedEntities[99].itemName).toBe('Procurement Valve 100');
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe('RFQ ingestion & summary HTTP routes', () => {
  describe('POST /api/rfqs/ingest', () => {
    test('classifies extracted rows into a review-ready draft', async () => {
      const res = await request(app)
        .post('/api/rfqs/ingest')
        .set(authHeader('buyer'))
        .send({
          lineItems: [
            { itemName: 'Centrifugal Water Pump 500 GPM', quantity: 12, unit: 'Units' },
            { itemName: 'Flanged Gate Valve 4-inch', quantity: 24, unit: 'Units' },
          ],
          sourceFileName: 'BOQ_Pumps.xlsx',
        });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.extractedEntities).toHaveLength(2);
      expect(res.body.data.extractedEntities[0].minorCategory).toBe('Pumps & Accessories');
      expect(res.body.classification.accepted).toBe(2);
    });

    test('requires authentication', async () => {
      const res = await request(app).post('/api/rfqs/ingest').send({ lineItems: [] });
      expect(res.statusCode).toBe(401);
    });

    test('rejects a payload with no lineItems array', async () => {
      const res = await request(app).post('/api/rfqs/ingest').set(authHeader('buyer')).send({});
      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.fieldErrors.lineItems).toBeDefined();
    });

    test('rejects a malformed source email at the boundary', async () => {
      const res = await request(app)
        .post('/api/rfqs/ingest')
        .set(authHeader('buyer'))
        .send({ lineItems: [{ itemName: 'Pump' }], sourceEmail: 'not-an-email' });
      expect(res.statusCode).toBe(400);
      expect(res.body.fieldErrors.sourceEmail).toBeDefined();
    });

    test('rejects an unknown source value', async () => {
      const res = await request(app)
        .post('/api/rfqs/ingest')
        .set(authHeader('buyer'))
        .send({ lineItems: [{ itemName: 'Pump' }], source: 'carrier_pigeon' });
      expect(res.statusCode).toBe(400);
    });

    // A document the parser could read but that yielded nothing quotable is a
    // failed ingestion, so the wizard must keep the buyer on the upload step.
    test('returns 422 when no usable line item could be extracted', async () => {
      const res = await request(app)
        .post('/api/rfqs/ingest')
        .set(authHeader('buyer'))
        .send({ lineItems: [{ quantity: 5 }, { itemName: '  ' }] });
      expect(res.statusCode).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.classification.accepted).toBe(0);
    });

    test('surfaces an unexpected failure through the error handler', async () => {
      const spy = jest.spyOn(rfqSummaryService, 'buildPortfolioSummary').mockImplementation(() => {
        throw new Error('boom');
      });
      try {
        const res = await request(app).get('/api/rfqs/summary').set(authHeader('buyer'));
        expect(res.statusCode).toBeGreaterThanOrEqual(500);
      } finally {
        // Restored in a finally block: when this assertion failed, the spy used
        // to leak into every later test in the file and throw 'boom' there.
        spy.mockRestore();
      }
    });
  });

  describe('GET /api/rfqs/summary', () => {
    test('aggregates the buyer RFQ portfolio', async () => {
      const res = await request(app).get('/api/rfqs/summary').set(authHeader('buyer'));

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);

      const s = res.body.data;
      expect(typeof s.totalRFQs).toBe('number');
      expect(typeof s.awaitingQuotes).toBe('number');
      expect(typeof s.totalBudget).toBe('number');
      expect(typeof s.averageQuotesPerRFQ).toBe('number');
      expect(s.byStatus).toBeDefined();
      expect(s.bySourcingMode).toBeDefined();
      // followUps is gone. Every figure in it was fabricated by createRFQ for
      // RFQs that had no vendors at all, so the dashboard reported outreach
      // that had never happened.
      expect(s.followUps).toBeUndefined();
    });

    test('requires a session', async () => {
      const res = await request(app).get('/api/rfqs/summary');
      expect(res.statusCode).toBe(401);
    });

    // 'summary' must not be captured by the '/:id' route below it.
    test('is not shadowed by the RFQ-by-id route', async () => {
      const res = await request(app).get('/api/rfqs/summary').set(authHeader('buyer'));
      expect(res.body.data.byStatus).toBeDefined();
      expect(res.body.error).toBeUndefined();
    });
  });

  describe('GET /api/rfqs/all (category-manager All RFQs console)', () => {
    test('returns the full cross-buyer list to a category manager', async () => {
      const res = await request(app).get('/api/rfqs/all').set(authHeader('category_manager'));
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBe(storeService.getRFQs().length);
    });

    test('is also open to an admin', async () => {
      const res = await request(app).get('/api/rfqs/all').set(authHeader('admin'));
      expect(res.statusCode).toBe(200);
    });

    test('orders the list newest first', async () => {
      const spy = jest.spyOn(storeService, 'getRFQs').mockReturnValue([
        { id: 'a', createdAt: '2026-01-01T00:00:00Z' },
        { id: 'b', createdAt: '2026-03-01T00:00:00Z' },
        { id: 'c', createdAt: '2026-02-01T00:00:00Z' },
      ]);
      try {
        const res = await request(app).get('/api/rfqs/all').set(authHeader('admin'));
        expect(res.body.data.map((r) => r.id)).toEqual(['b', 'c', 'a']);
      } finally {
        spy.mockRestore();
      }
    });

    test('rejects a buyer with 403', async () => {
      const res = await request(app).get('/api/rfqs/all').set(authHeader('buyer'));
      expect(res.statusCode).toBe(403);
    });

    test('rejects a vendor with 403', async () => {
      const res = await request(app).get('/api/rfqs/all').set(authHeader('vendor'));
      expect(res.statusCode).toBe(403);
    });

    test('requires a session', async () => {
      const res = await request(app).get('/api/rfqs/all');
      expect(res.statusCode).toBe(401);
    });

    test('is not shadowed by the RFQ-by-id route', async () => {
      const res = await request(app).get('/api/rfqs/all').set(authHeader('category_manager'));
      expect(res.body.success).toBe(true);
      expect(res.body.error).toBeUndefined();
    });

    test('surfaces an unexpected failure through the error handler', async () => {
      const spy = jest.spyOn(storeService, 'getRFQs').mockImplementation(() => {
        throw new Error('boom');
      });
      try {
        const res = await request(app).get('/api/rfqs/all').set(authHeader('admin'));
        expect(res.statusCode).toBeGreaterThanOrEqual(500);
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe('GET /api/rfqs — vendor visibility requires a CM invite', () => {
    // The default test vendor (vendor@apexsupplies.com) gets a category profile
    // and two RFQs, one in its category and one not — category alone no longer
    // grants visibility, so `inCat` is explicitly invited via the CM endpoint and
    // `outCat` is left uninvited throughout.
    let inCatId;
    let inCatNumber;
    let outCatId;
    let outCatNumber;
    let vendorId;

    beforeAll(async () => {
      const vendorRes = await request(app)
        .post('/api/vendors')
        .set(authHeader('vendor'))
        .send({ name: 'Scoping Test Vendor', majorCategory: 'Vendor-Scope-Cat' });
      vendorId = vendorRes.body.data.id;

      const buyerRes = await request(app).post('/api/buyer-accounts').set(authHeader('buyer')).send({
        organizationName: 'Scoping Test Buyer',
        corporateEmail: 'buyer@procucev.com',
      });
      // A fresh account defaults to free_trial (mode_1 only) — granted the top
      // tier so this block's mode_2 RFQs aren't gated by the new entitlement check.
      storeService.updateBuyerAccount(buyerRes.body.data.id, { subscriptionPlan: 'version_3' });

      // mode_3 deliberately, not mode_2: createRFQ now auto-invites
      // category-matched vendors for mode_1/mode_2 (2026-09-18), which would
      // defeat the whole point of this block — mode_3 is the one mode still
      // requiring an explicit CM invite, which is what's under test here.
      const inCat = await request(app).post('/api/rfqs').set(authHeader('buyer')).send({
        title: 'Vendor-visible scoped enquiry',
        category: 'Vendor-Scope-Cat',
        budget: 1000,
        targetDeliveryDate: '2026-12-01',
        deadline: '2026-12-01',
        sourcingMode: 'mode_3',
        deliveryLocation: 'Plant A',
        deliveryPincode: '400001',
      });
      inCatId = inCat.body.data.id;
      inCatNumber = inCat.body.data.rfqNumber;

      const outCat = await request(app).post('/api/rfqs').set(authHeader('buyer')).send({
        title: 'Vendor-hidden scoped enquiry',
        category: 'Some-Other-Scope-Cat',
        budget: 1000,
        targetDeliveryDate: '2026-12-01',
        deadline: '2026-12-01',
        sourcingMode: 'mode_3',
        deliveryLocation: 'Plant A',
        deliveryPincode: '400001',
      });
      outCatId = outCat.body.data.id;
      outCatNumber = outCat.body.data.rfqNumber;
    });

    test('before any invite, the vendor sees neither RFQ', async () => {
      const res = await request(app).get('/api/rfqs').set(authHeader('vendor'));
      expect(res.statusCode).toBe(200);
      const numbers = res.body.data.map((r) => r.rfqNumber);
      expect(numbers).not.toContain(inCatNumber);
      expect(numbers).not.toContain(outCatNumber);
    });

    test('GET /api/rfqs/:id/vendor-candidates lists the category-matched vendor, rejects buyer/vendor callers', async () => {
      const cmRes = await request(app).get(`/api/rfqs/${inCatId}/vendor-candidates`).set(authHeader('category_manager'));
      expect(cmRes.statusCode).toBe(200);
      const candidate = cmRes.body.data.find((c) => c.id === vendorId);
      expect(candidate).toMatchObject({ alreadyInvited: false });

      expect((await request(app).get(`/api/rfqs/${inCatId}/vendor-candidates`).set(authHeader('buyer'))).statusCode).toBe(403);
      expect((await request(app).get(`/api/rfqs/${inCatId}/vendor-candidates`).set(authHeader('vendor'))).statusCode).toBe(403);
    });

    test('POST /api/rfqs/:id/invite-vendors rejects non-CM/admin callers and a bad body', async () => {
      expect(
        (await request(app).post(`/api/rfqs/${inCatId}/invite-vendors`).set(authHeader('buyer')).send({ vendorIds: [vendorId] }))
          .statusCode
      ).toBe(403);
      expect(
        (await request(app).post(`/api/rfqs/${inCatId}/invite-vendors`).set(authHeader('vendor')).send({ vendorIds: [vendorId] }))
          .statusCode
      ).toBe(403);
      const badBody = await request(app)
        .post(`/api/rfqs/${inCatId}/invite-vendors`)
        .set(authHeader('category_manager'))
        .send({ vendorIds: [] });
      expect(badBody.statusCode).toBe(400);
    });

    test('CM invites the vendor to inCat only — vendor now sees inCat, still not outCat', async () => {
      const invite = await request(app)
        .post(`/api/rfqs/${inCatId}/invite-vendors`)
        .set(authHeader('category_manager'))
        .send({ vendorIds: [vendorId] });
      expect(invite.statusCode).toBe(200);
      expect(invite.body.invitedCount).toBe(1);

      const res = await request(app).get('/api/rfqs').set(authHeader('vendor'));
      const numbers = res.body.data.map((r) => r.rfqNumber);
      expect(numbers).toContain(inCatNumber);
      expect(numbers).not.toContain(outCatNumber);
    });

    test('a vendor whose email has no vendor record sees nothing', async () => {
      const orphanToken = require('../src/services/authService').generateSessionToken({
        id: 'usr-orphan-vendor',
        email: 'orphan-vendor@nowhere.test',
        name: 'Orphan',
        role: 'vendor',
        orgId: 'o',
        orgName: 'O',
      });
      const res = await request(app).get('/api/rfqs').set({ Authorization: `Bearer ${orphanToken}` });
      expect(res.statusCode).toBe(200);
      expect(res.body.data).toEqual([]);
    });

    test('GET /api/rfqs/:id 404s a vendor for the never-invited RFQ', async () => {
      const res = await request(app).get(`/api/rfqs/${outCatNumber}`).set(authHeader('vendor'));
      expect(res.statusCode).toBe(404);
    });

    test('POST /api/rfqs/:id/quotes 404s a vendor for the never-invited RFQ', async () => {
      const res = await request(app)
        .post(`/api/rfqs/${outCatNumber}/quotes`)
        .set(authHeader('vendor'))
        .send({ unitPrice: 100 });
      expect(res.statusCode).toBe(404);
    });

    test('a vendor can read and quote the RFQ they were invited to', async () => {
      const read = await request(app).get(`/api/rfqs/${inCatNumber}`).set(authHeader('vendor'));
      expect(read.statusCode).toBe(200);
      const quote = await request(app)
        .post(`/api/rfqs/${inCatNumber}/quotes`)
        .set(authHeader('vendor'))
        .send({ unitPrice: 100, totalPrice: 100 });
      expect(quote.statusCode).toBe(200);
    });

    test('GET /api/rfqs/:id/vendor-candidates 404s for an unknown RFQ', async () => {
      const res = await request(app).get('/api/rfqs/does-not-exist/vendor-candidates').set(authHeader('category_manager'));
      expect(res.statusCode).toBe(404);
    });

    test('POST /api/rfqs/:id/invite-vendors 404s for an unknown RFQ', async () => {
      const res = await request(app)
        .post('/api/rfqs/does-not-exist/invite-vendors')
        .set(authHeader('category_manager'))
        .send({ vendorIds: [vendorId] });
      expect(res.statusCode).toBe(404);
    });

    test('re-inviting the same vendor is a no-op (invitedCount 0)', async () => {
      const res = await request(app)
        .post(`/api/rfqs/${inCatId}/invite-vendors`)
        .set(authHeader('category_manager'))
        .send({ vendorIds: [vendorId] });
      expect(res.statusCode).toBe(200);
      expect(res.body.invitedCount).toBe(0);
    });
  });

  // The roll-up moved off storeService, which reduced over a single global array,
  // and onto rfqSummaryService, which is handed one organisation's rows.
  describe('rfqSummaryService.buildPortfolioSummary', () => {
    test('counts an empty portfolio without dividing by zero', () => {
      const summary = rfqSummaryService.buildPortfolioSummary([]);
      expect(summary).toMatchObject({
        totalRFQs: 0,
        awaitingQuotes: 0,
        totalQuotesReceived: 0,
        totalBudget: 0,
        totalLineItems: 0,
        averageQuotesPerRFQ: 0,
      });
      expect(summary.byStatus).toEqual({});
    });

    test.each([[undefined], [null], ['not-an-array']])(
      'treats %p as an empty portfolio rather than throwing',
      (input) => {
        expect(rfqSummaryService.buildPortfolioSummary(input).totalRFQs).toBe(0);
      }
    );

    test('rolls up statuses, modes, sources, budget and line items', () => {
      const s = rfqSummaryService.buildPortfolioSummary([
        {
          rfqId: 'RFQ260409000001',
          status: 'Quotes Pending',
          sourcingMode: 'mode_1',
          source: 'web_portal',
          budget: 1000,
          quotesCount: 2,
          extractedEntities: [{ itemName: 'Pump' }, { itemName: 'Valve' }],
        },
        {
          rfqId: 'RFQ260409000002',
          status: 'Quotes Pending',
          sourcingMode: 'mode_3',
          source: 'email_gateway',
          budget: 500,
          quotesCount: 0,
          extractedEntities: [],
        },
      ]);

      expect(s.totalRFQs).toBe(2);
      expect(s.awaitingQuotes).toBe(1);
      expect(s.totalQuotesReceived).toBe(2);
      expect(s.totalBudget).toBe(1500);
      expect(s.totalLineItems).toBe(2);
      expect(s.averageQuotesPerRFQ).toBe(1);
      expect(s.byStatus).toEqual({ 'Quotes Pending': 2 });
      expect(s.bySourcingMode).toEqual({ mode_1: 1, mode_3: 1 });
      expect(s.bySource).toEqual({ web_portal: 1, email_gateway: 1 });
    });

    // Missing fields are bucketed explicitly rather than dropped, so the counts
    // in each breakdown always add up to totalRFQs.
    test('buckets missing status, mode and source explicitly', () => {
      const s = rfqSummaryService.buildPortfolioSummary([{ rfqId: 'RFQ260409000003', budget: 0 }]);
      expect(s.byStatus).toEqual({ Unknown: 1 });
      expect(s.bySourcingMode).toEqual({ unspecified: 1 });
      expect(s.bySource).toEqual({ unspecified: 1 });
      expect(s.totalRFQs).toBe(1);
    });

    test('averages quotes to two decimal places', () => {
      const s = rfqSummaryService.buildPortfolioSummary([
        { quotesCount: 1 },
        { quotesCount: 2 },
        { quotesCount: 0 },
      ]);
      expect(s.averageQuotesPerRFQ).toBe(1);
      expect(rfqSummaryService.buildPortfolioSummary([{ quotesCount: 1 }, { quotesCount: 0 }])
        .averageQuotesPerRFQ).toBe(0.5);
    });
  });

  describe('POST /api/rfqs/:id/validate-vendor-categories', () => {
    test('validates vendor categories, excludes mismatched vendors, and sends email', async () => {
      const vMatch = storeService.addVendor({ name: 'Match V', email: 'vmatch@ex.com', majorCategory: 'Mechanical' });
      const vMismatch = storeService.addVendor({ name: 'Mismatch V', email: 'vmismatch@ex.com', majorCategory: 'Civil Works' });
      const rfq = storeService.createRFQ({ title: 'Machining', category: 'Mechanical' });

      const res = await request(app)
        .post(`/api/rfqs/${rfq.id}/validate-vendor-categories`)
        .set(authHeader('category_manager'))
        .send({ vendorIds: [vMatch.id, vMismatch.id] });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.shortlisted.map((v) => v.id)).toContain(vMatch.id);
      expect(res.body.excluded.map((v) => v.id)).toContain(vMismatch.id);
    });

    test('rejects non-array or missing vendorIds', async () => {
      const rfq = storeService.createRFQ({ title: 'Test RFQ', category: 'Mechanical' });
      const res = await request(app)
        .post(`/api/rfqs/${rfq.id}/validate-vendor-categories`)
        .set(authHeader('category_manager'))
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });
});
