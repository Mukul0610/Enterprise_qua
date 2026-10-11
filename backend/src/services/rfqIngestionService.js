/**
 * RFQ Ingestion Service
 *
 * Server-side half of the AI RFQ ingestion flow. The browser extracts raw rows
 * from a BOQ spreadsheet (or an email body), and this module turns those rows
 * into review-ready line items: it normalises the loose field names an upload
 * produces, repairs missing quantities and units, classifies every item into the
 * shared major/minor taxonomy, and derives the draft RFQ header.
 *
 * Ported from the Java p2pservices pipeline (EmailProcessorService +
 * CategoryClassificationService + RFQBuilderService). The behaviours kept
 * deliberately identical to that service, because buyers already rely on them:
 *   - quantity <= 0 becomes 1, a blank unit becomes 'Nos'
 *   - classification precedence is explicit category, then keyword, then default
 *   - the RFQ title is derived from the first line item, capped at 100 chars
 *   - a missing delivery date defaults to today + 5 days
 *   - duplicate rows within one ingest are collapsed on a composite key
 */

const { RFQ_CATEGORY_CLASSIFICATION, RFQ_INGESTION_CONFIG } = require('../config/constants');
const buyerProfileQueries = require('../db/buyerProfileQueries');
const { logger } = require('./loggerService');

const {
  CONFIDENCE,
  STATUS,
  GENERIC_CATEGORY_TOKENS,
  DOMAIN_KEYWORD_MAP,
  TAXONOMY_CACHE_TTL_MS,
} = RFQ_CATEGORY_CLASSIFICATION;

const {
  DEFAULT_UNIT,
  DEFAULT_QUANTITY,
  DELIVERY_DATE_OFFSET_DAYS,
  MAX_TITLE_LENGTH,
  TITLE_SUFFIX_SINGLE,
  TITLE_SUFFIX_MULTIPLE,
} = RFQ_INGESTION_CONFIG;

// Keywords are matched longest-first so a specific phrase wins over a substring
// of it, e.g. 'circuit breaker' must beat the bare 'breaker'-style entries.
const KEYWORDS_BY_LENGTH = Object.keys(DOMAIN_KEYWORD_MAP).sort((a, b) => b.length - a.length);

// ==============================================================================
// SHARED TAXONOMY INDEX
// ==============================================================================
// The review grid builds its two dropdowns from the same taxonomy this index is
// built from: the major select lists the majors, and the minor select lists only
// the minors belonging to the chosen major. A pair outside the taxonomy therefore
// cannot be displayed — the select finds no matching option and renders blank,
// which is what made an extracted item arrive with both category fields
// apparently empty.
//
// The taxonomy is read from the `category_division` table rather than a bundled
// categories.json. There used to be two copies of that file, one under
// backend/src/config and one under frontend/lib, with nothing keeping them in
// step with each other or with the database the buyer's saved selection is
// actually written to. Classification is what routes an RFQ to a vendor pool, so
// it has to agree with the master the pool is defined against.
//
// The model reliably names a *minor* ("Motors", "Fasteners") and rarely names a
// major, so the major is looked up from the minor here instead of being replaced
// with a placeholder. Both indexes are keyed on a normalised form and store the
// master's own spelling, so classification always emits values the grid can
// render.

/** Trim, collapse whitespace and casefold, so 'Storage  Racks' matches. */
function taxonomyKey(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

// Cached rather than read per ingest: the master is a few hundred short rows that
// change rarely, and an ingest classifies every line item against it. Starts
// empty — an unloaded index is not a reason to invent categories, it just means
// classification falls through to keyword matching.
const taxonomyIndex = {
  majorByKey: new Map(),
  byMinorKey: new Map(),
  loadedAt: 0,
  groupCount: 0,
};

/** Build the two lookup maps from the grouped taxonomy shape. */
function primeTaxonomyIndex(groups) {
  taxonomyIndex.majorByKey = new Map();
  taxonomyIndex.byMinorKey = new Map();
  (Array.isArray(groups) ? groups : []).forEach((group) => {
    if (!group || !group.majorCategory) return;
    taxonomyIndex.majorByKey.set(taxonomyKey(group.majorCategory), group.majorCategory);
    (group.minorCategories || []).forEach((minor) => {
      // First major wins for a minor that appears under several ('Refractories',
      // 'Panels', 'Conveyors'), matching the order a buyer sees in the dropdown.
      const key = taxonomyKey(minor);
      if (!taxonomyIndex.byMinorKey.has(key)) {
        taxonomyIndex.byMinorKey.set(key, { major: group.majorCategory, minor });
      }
    });
  });
  taxonomyIndex.loadedAt = Date.now();
  taxonomyIndex.groupCount = taxonomyIndex.majorByKey.size;
  return taxonomyIndex;
}

/**
 * The category names the taxonomy master holds, for constraining model output.
 * Only meaningful after ensureTaxonomyLoaded(); empty before that.
 */
function taxonomyCategoryNames() {
  const majors = [...taxonomyIndex.majorByKey.values()];
  const minors = [...new Set([...taxonomyIndex.byMinorKey.values()].map((pair) => pair.minor))];
  return { majors, minors };
}

/** Drop the cached index so the next ingest reloads it. */
function resetTaxonomyIndex() {
  taxonomyIndex.majorByKey = new Map();
  taxonomyIndex.byMinorKey = new Map();
  taxonomyIndex.loadedAt = 0;
  taxonomyIndex.groupCount = 0;
}

/**
 * Load the taxonomy index if it is empty or stale.
 *
 * A read failure is logged and swallowed: the previously cached index keeps
 * serving, and if there is none, classification degrades to keyword matching and
 * flags the rest for review. Refusing the whole ingest because the master could
 * not be re-read would be a worse outcome than an item the buyer has to
 * categorise by hand.
 */
async function ensureTaxonomyLoaded() {
  const isFresh =
    taxonomyIndex.loadedAt > 0 && Date.now() - taxonomyIndex.loadedAt < TAXONOMY_CACHE_TTL_MS;
  if (isFresh) return taxonomyIndex;

  try {
    const groups = await buyerProfileQueries.findCategoryTaxonomy();
    primeTaxonomyIndex(groups);
    logger.info(
      'Category taxonomy index loaded for RFQ classification',
      { majorCount: taxonomyIndex.majorByKey.size, minorCount: taxonomyIndex.byMinorKey.size },
      'RFQ_INGESTION'
    );
  } catch (err) {
    logger.error('Could not load the category taxonomy for RFQ classification', err, 'RFQ_INGESTION');
  }

  return taxonomyIndex;
}

/** The taxonomy's own spelling of a major, or null when it is not one. */
function canonicalMajor(value) {
  return taxonomyIndex.majorByKey.get(taxonomyKey(value)) || null;
}

/** The taxonomy pair owning a minor category, or null when it is not one. */
function taxonomyPairForMinor(value) {
  return taxonomyIndex.byMinorKey.get(taxonomyKey(value)) || null;
}

/**
 * Settle a stated category into a pair the review grid can render.
 *
 * Succeeds only when the stated minor is a real taxonomy minor. The major is then
 * the stated one if that is itself a real major — which disambiguates a minor
 * living under more than one, such as 'Panels' — and otherwise the major that
 * owns the minor.
 *
 * Returns null when the stated minor is not in the taxonomy, so the caller falls
 * through to keyword matching. That matters for the umbrella labels a model likes
 * to produce: 'Valves', 'PPE' and 'Hand Protection' are not minors, but the item
 * text routes them to 'Hoses, Valves & Fittings', 'Hemlets' and 'Gloves'. Keeping
 * the model's word instead would put a value in the row that the minor dropdown
 * has no option for, and the buyer would see an empty select.
 */
function resolveStatedCategory(statedMinor, statedMajor) {
  const pair = taxonomyPairForMinor(statedMinor);
  if (!pair) return null;
  return { major: canonicalMajor(statedMajor) || pair.major, minor: pair.minor };
}

/**
 * A category string that reads like a placeholder carries no routing value, so
 * it must not short-circuit keyword matching.
 */
function isGenericCategory(value) {
  if (!value || typeof value !== 'string') return true;
  const normalized = value.trim().toLowerCase();
  if (normalized === '') return true;
  return GENERIC_CATEGORY_TOKENS.some(
    (token) => normalized === token || normalized.startsWith(`${token} `) || normalized.endsWith(` ${token}`)
  );
}

/**
 * Resolve a major/minor pair from free text by domain keyword.
 * Returns null when nothing matches, so the caller can fall through.
 */
function matchByKeyword(text) {
  if (!text) return null;
  const haystack = String(text).toLowerCase();
  const hit = KEYWORDS_BY_LENGTH.find((keyword) => haystack.includes(keyword));
  return hit ? { ...DOMAIN_KEYWORD_MAP[hit], keyword: hit } : null;
}

/**
 * Classify a single line item, mirroring the Java precedence chain.
 *
 * @param {Object} item raw or partially normalised line item
 * @param {string} [payloadCategory] category stated once for the whole payload
 * @returns {{majorCategory: string, minorCategory: string, category: string,
 *   categoryConfidence: number, classificationStatus: string}}
 */
function classifyLineItem(item, payloadCategory) {
  // Resolved up front rather than inside step 3, because the stated-category
  // steps use its major when the model named a minor but no major.
  const keywordMatch = matchByKeyword(`${item.itemName || ''} ${item.technicalSpecs || ''}`);

  // 1. An explicit, meaningful category on the item itself wins outright.
  const explicitMinor = item.minorCategory || item.category;
  if (!isGenericCategory(explicitMinor)) {
    const resolved = resolveStatedCategory(explicitMinor, item.majorCategory);
    if (resolved) {
      return {
        majorCategory: resolved.major,
        minorCategory: resolved.minor,
        category: resolved.minor,
        categoryConfidence: CONFIDENCE.EXPLICIT,
        classificationStatus: STATUS.EXPLICIT,
      };
    }
    // No major could be resolved for it, so the pair would arrive at the review
    // grid unrenderable. Fall through instead of stamping a placeholder.
  }

  // 2. A category stated once for the whole payload applies to every item.
  if (!isGenericCategory(payloadCategory)) {
    const resolved = resolveStatedCategory(payloadCategory, item.majorCategory);
    if (resolved) {
      return {
        majorCategory: resolved.major,
        minorCategory: resolved.minor,
        category: resolved.minor,
        categoryConfidence: CONFIDENCE.EXPLICIT,
        classificationStatus: STATUS.EXPLICIT,
      };
    }
  }

  // 3. Keyword match across the description and the technical specification.
  if (keywordMatch) {
    return {
      majorCategory: keywordMatch.major,
      minorCategory: keywordMatch.minor,
      category: keywordMatch.minor,
      categoryConfidence: CONFIDENCE.KEYWORD,
      classificationStatus: STATUS.KEYWORD,
    };
  }

  // 4. Nothing matched. Left unclassified and flagged, which is what STATUS.DEFAULT
  // already feeds into the `needsReview` count the wizard shows.
  //
  // This used to stamp 'General Procurement' / 'General Industrial Goods'. Neither
  // exists in the category master, so the pair could not be rendered by either
  // dropdown: the row arrived looking blank anyway, but with a value underneath
  // that validation accepted — so an unclassified item could be dispatched to
  // vendors under a category that matches no vendor at all. Blank is honest, and
  // the required-field rules then ask the buyer to choose.
  return {
    majorCategory: '',
    minorCategory: '',
    category: '',
    categoryConfidence: CONFIDENCE.DEFAULT,
    classificationStatus: STATUS.DEFAULT,
  };
}

/**
 * ISO date (yyyy-mm-dd) a fixed number of days from now, used when an ingested
 * row carries no target date of its own.
 */
function defaultTargetDate(offsetDays = DELIVERY_DATE_OFFSET_DAYS) {
  const due = new Date();
  due.setDate(due.getDate() + offsetDays);
  return due.toISOString().slice(0, 10);
}

/**
 * Coerce a spreadsheet quantity into a usable positive number.
 * Anything absent, non-numeric or <= 0 becomes the documented default of 1.
 */
function normalizeQuantity(raw) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_QUANTITY;
  return parsed;
}

/**
 * Coerce a monetary field into a usable positive number, or null when the
 * document did not state one.
 *
 * Accepts the shapes real documents produce: a plain number, or a string still
 * carrying a currency word, symbol or grouping separators ("Rs. 1,45,000/-").
 * Zero and negative figures count as "not stated" so they can never overwrite a
 * genuine total further down the pipeline.
 */
function normalizeAmount(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? raw : null;
  if (typeof raw !== 'string') return null;

  // Isolate the first number rather than stripping non-digits, because stripping
  // would turn the abbreviation dot in "Rs. 4,500" into a decimal point and read
  // the amount as 0.45. Grouping commas are dropped afterwards, which handles
  // both 1,45,000 (Indian) and 145,000 (Western) layouts.
  const match = raw.match(/-?\d[\d,]*(?:\.\d+)?/);
  if (!match) return null;

  const parsed = Number(match[0].replace(/,/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Value of one line: the stated line total when the document printed one, else
 * the stated unit rate multiplied by the quantity. Null when neither was priced,
 * which keeps an unpriced line out of the budget instead of contributing zero.
 */
function lineItemValue(raw, quantity) {
  const total = normalizeAmount(raw.totalPrice ?? raw.amount);
  if (total !== null) return total;

  const unitPrice = normalizeAmount(raw.unitPrice ?? raw.rate);
  return unitPrice === null ? null : unitPrice * quantity;
}

/**
 * Estimated budget for the whole requirement.
 *
 * A total stated on the document wins, because a grand total may include freight
 * or taxes that the individual lines do not. Otherwise the priced lines are
 * summed. Returns null when the document carried no pricing at all, so the buyer
 * is shown an empty field to fill in rather than a fabricated figure.
 */
function deriveEstimatedBudget(statedTotal, valuedLines) {
  const stated = normalizeAmount(statedTotal);
  if (stated !== null) return stated;

  const priced = valuedLines.filter((value) => value !== null);
  if (priced.length === 0) return null;

  // Rounded to whole currency units: a summed float can otherwise land on
  // 145000.00000000003 and render with a spurious decimal tail.
  return Math.round(priced.reduce((sum, value) => sum + value, 0));
}

/**
 * Composite key used to collapse duplicate rows inside a single ingest, matching
 * the Java buildDeduplicationKey field order.
 */
function buildDeduplicationKey(item) {
  return [item.itemName, item.quantity, item.unit, item.targetDate, item.technicalSpecs]
    .map((part) => String(part == null ? '' : part).trim().toLowerCase())
    .join('|');
}

/**
 * Normalise, deduplicate and classify a batch of extracted rows.
 *
 * @param {Array<Object>} rawItems rows as extracted from a document or email
 * @param {Object} [options]
 * @param {string} [options.category] category stated once for the whole payload
 * @returns {{entities: Array<Object>, duplicatesRemoved: number,
 *   lineValues: Array<number|null>}} lineValues is index-aligned with entities
 */
function normalizeLineItems(rawItems, options = {}) {
  const items = Array.isArray(rawItems) ? rawItems : [];
  const seen = new Set();
  const entities = [];
  // Only accepted rows are valued, so a collapsed duplicate cannot be counted twice.
  const lineValues = [];
  let duplicatesRemoved = 0;

  items.forEach((raw, index) => {
    // A sparse spreadsheet can yield null or primitive rows; skipping them keeps
    // one malformed cell from failing the whole ingest with a 500.
    if (!raw || typeof raw !== 'object') return;

    const itemName = String(raw.itemName || raw.itemDescription || raw.description || '').trim();
    // A row with no description cannot be quoted against, so it is dropped
    // rather than surfaced as a blank line for the buyer to clean up.
    if (!itemName) return;

    if (options.requireValidQuantity) {
      const qNum = Number(raw.quantity);
      if (raw.quantity === null || raw.quantity === undefined || raw.quantity === '' || !Number.isFinite(qNum) || qNum <= 0) {
        return;
      }
    }

    const normalized = {
      id: raw.id || `ent-ingested-${Date.now()}-${index}`,
      itemName,
      quantity: normalizeQuantity(raw.quantity),
      unit: String(raw.unit || raw.uom || '').trim() || DEFAULT_UNIT,
      targetDate: String(raw.targetDate || '').trim() || defaultTargetDate(),
      technicalSpecs: String(raw.technicalSpecs || raw.specifications || raw.specification || '').trim(),
      brand: String(raw.brand || '').trim(),
      deliveryCity: String(raw.deliveryCity || '').trim(),
      deliveryState: String(raw.deliveryState || '').trim(),
      deliveryPincode: String(raw.deliveryPincode || '').trim(),
      deliveryLocation: String(raw.deliveryLocation || '').trim(),
    };

    const key = buildDeduplicationKey(normalized);
    if (seen.has(key)) {
      duplicatesRemoved += 1;
      return;
    }
    seen.add(key);

    const classification = classifyLineItem({ ...raw, ...normalized }, options.category);
    entities.push({
      ...normalized,
      ...classification,
      confidence: Math.round(classification.categoryConfidence * 1000) / 10,
    });
    lineValues.push(lineItemValue(raw, normalized.quantity));
  });

  return { entities, duplicatesRemoved, lineValues };
}

/**
 * Derive the RFQ title from its line items, the way RFQBuilderService does:
 * the first item's description, pluralised when the RFQ covers several items,
 * and truncated so it fits the RFQ header.
 */
function deriveTitle(entities) {
  if (entities.length === 0) return '';
  const lead = entities[0].itemName;
  const suffix = entities.length > 1 ? TITLE_SUFFIX_MULTIPLE : TITLE_SUFFIX_SINGLE;
  const title = `${lead}${suffix}`;
  return title.length > MAX_TITLE_LENGTH ? `${title.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…` : title;
}

/**
 * Turn raw extracted rows into a review-ready RFQ draft.
 *
 * This is the endpoint-facing entry point: it returns the classified line items
 * plus the header fields the wizard pre-fills, and a breakdown the buyer can use
 * to judge how much of the extraction needs manual attention.
 *
 * @param {Object} payload
 * @param {Array<Object>} payload.lineItems raw extracted rows
 * @param {string} [payload.category] category stated once for the whole payload
 * @param {string} [payload.title] explicit title, else derived from the items
 * @param {number|string} [payload.estimatedBudget] overall value stated on the
 *   document, else derived by summing the priced line items
 * @param {string} [payload.source] where the rows came from
 * @param {string} [payload.sourceFileName]
 * @param {string} [payload.sourceEmail]
 * @param {boolean} [payload.requireValidQuantity] enforce valid positive quantities
 */
async function buildRFQDraft(payload = {}) {
  // Loaded once here rather than per line item, so classification below stays
  // synchronous and one ingest costs at most one taxonomy read.
  await ensureTaxonomyLoaded();

  const { entities, duplicatesRemoved, lineValues } = normalizeLineItems(payload.lineItems, {
    category: payload.category,
    requireValidQuantity: Boolean(payload.requireValidQuantity),
  });

  // A declared major category (e.g. the email's "Category: Civil Works") is the
  // buyer's own statement of what the RFQ is for, so it decides the RFQ header.
  // Items with no major of their own take it; items whose own classification
  // conflicts with it are kept as classified but flagged for review.
  // A declared minor (the model may return either level) resolves to its own major.
  const declaredMajor =
    canonicalMajor(payload.category) || taxonomyPairForMinor(payload.category)?.major || '';
  if (declaredMajor) {
    entities.forEach((entity) => {
      if (!entity.majorCategory) {
        entity.majorCategory = declaredMajor;
      } else if (entity.majorCategory !== declaredMajor) {
        entity.categoryMismatch = true;
      }
    });
  }

  const needsReview = entities.filter(
    (e) => e.classificationStatus === STATUS.DEFAULT || e.categoryMismatch
  ).length;
  const title = String(payload.title || '').trim() || deriveTitle(entities);

  // The RFQ header category follows the majority of its line items rather than
  // just the first, so a mixed BOQ lands in the category it mostly belongs to.
  // Unclassified items are excluded from the vote — otherwise a BOQ that mostly
  // failed to classify would give the RFQ header a blank category even when some
  // items did resolve. If nothing classified, the header category is blank and
  // the buyer picks it in the review step.
  const majorCounts = entities.reduce((acc, e) => {
    if (!e.majorCategory) return acc;
    acc[e.majorCategory] = (acc[e.majorCategory] || 0) + 1;
    return acc;
  }, {});
  const dominantMajor = Object.keys(majorCounts).sort((a, b) => majorCounts[b] - majorCounts[a])[0] || '';

  const estimatedBudget = deriveEstimatedBudget(payload.estimatedBudget, lineValues);

  const draft = {
    title,
    category: declaredMajor || dominantMajor,
    targetDeliveryDate:
      payload.targetDeliveryDate ||
      (entities.length > 0 && entities[0].targetDate ? entities[0].targetDate : defaultTargetDate()),
    // Null rather than a placeholder figure: the wizard shows an empty budget
    // field so the buyer supplies the number the document did not state.
    estimatedBudget,
    extractedEntities: entities,
    deliveryLocation:
      (entities.length > 0 && entities[0].deliveryLocation) || payload.deliveryLocation || '',
    deliveryCity:
      (entities.length > 0 && entities[0].deliveryCity) || payload.deliveryCity || '',
    deliveryState:
      (entities.length > 0 && entities[0].deliveryState) || payload.deliveryState || '',
    deliveryPincode:
      (entities.length > 0 && entities[0].deliveryPincode) || payload.deliveryPincode || '',
    source: payload.source || 'web_portal',
    ...(payload.sourceFileName ? { sourceFileName: payload.sourceFileName } : {}),
    ...(payload.sourceEmail ? { sourceEmail: payload.sourceEmail } : {}),
  };

  const classification = {
    totalExtracted: Array.isArray(payload.lineItems) ? payload.lineItems.length : 0,
    accepted: entities.length,
    duplicatesRemoved,
    needsReview,
    autoClassified: entities.length - needsReview,
  };

  logger.info(
    `Ingested ${classification.accepted} line items (${classification.needsReview} need review)`,
    classification,
    'RFQ_INGESTION'
  );

  return { draft, classification };
}

module.exports = {
  taxonomyKey,
  primeTaxonomyIndex,
  resetTaxonomyIndex,
  ensureTaxonomyLoaded,
  taxonomyCategoryNames,
  canonicalMajor,
  taxonomyPairForMinor,
  isGenericCategory,
  matchByKeyword,
  classifyLineItem,
  defaultTargetDate,
  normalizeQuantity,
  normalizeAmount,
  lineItemValue,
  deriveEstimatedBudget,
  buildDeduplicationKey,
  normalizeLineItems,
  deriveTitle,
  buildRFQDraft,
};
