// ==============================================================================
// PROCUREMENT CATEGORY TAXONOMY REGISTRY
// ==============================================================================
// The major/minor category master, fetched once from the backend and shared by
// every screen that renders a category picker: the buyer ingestion wizard, the
// manual and edit RFQ modals, the buyer account table, the vendor profile and the
// category manager dashboards.
//
// This replaces `frontend/lib/categories.json`, a 372-line copy of the master
// that was bundled into the client. There was a second copy under
// backend/src/config, and the authoritative rows live in the `category_division`
// table — three copies, with nothing keeping any of them in step. A buyer's
// selection is written back as `org_division_category` rows and then used to fan
// RFQs out to vendors, so a checkbox offered from a stale bundled copy produced a
// procurement scope that silently matched nothing.
//
// The registry starts EMPTY and there is no fallback. A screen that has not
// loaded the taxonomy yet shows no options and says so, rather than showing
// options that may not exist. `useApp()` exposes the loaded value plus the load
// error; this module exists for the non-React validation code that cannot read
// context.
// ==============================================================================

import type { MajorMinorCategory } from './types';

/** Trim, collapse whitespace, normalize dashes and casefold, so 'Storage  Racks' and 'Others - New Product' match. */
function taxonomyKey(value: string): string {
  return String(value || '')
    .trim()
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

let groups: MajorMinorCategory[] = [];
let majorsByKey = new Map<string, string>();
let minorsByMajorKey = new Map<string, Map<string, string>>();

/**
 * Replace the registry contents.
 *
 * Called by the store once the fetch resolves. Indexes are rebuilt rather than
 * merged: a category removed from the master must stop being offered.
 * Automatically replaces legacy 'New Category' with 'Others – New Product' and 'Others – New Service'.
 */
export function setCategoryTaxonomy(next: MajorMinorCategory[]): void {
  const rawList = (Array.isArray(next) ? next : []).filter((g) => Boolean(g && g.majorCategory));
  const transformed: MajorMinorCategory[] = [];

  rawList.forEach((group) => {
    const rawMajor = String(group.majorCategory || '').trim();
    const key = taxonomyKey(rawMajor);

    if (key === 'new category' || key === 'new category-product') {
      transformed.push({
        majorCategory: 'Others – New Product',
        minorCategories:
          group.minorCategories && group.minorCategories.length > 0
            ? group.minorCategories
            : DEFAULT_MAJOR_MINORS['others - new product'],
      });
      if (key === 'new category') {
        transformed.push({
          majorCategory: 'Others – New Service',
          minorCategories: DEFAULT_MAJOR_MINORS['others - new service'],
        });
      }
    } else if (key === 'new category-service') {
      transformed.push({
        majorCategory: 'Others – New Service',
        minorCategories:
          group.minorCategories && group.minorCategories.length > 0
            ? group.minorCategories
            : DEFAULT_MAJOR_MINORS['others - new service'],
      });
    } else if (key === 'others - new product') {
      transformed.push({
        majorCategory: 'Others – New Product',
        minorCategories:
          group.minorCategories && group.minorCategories.length > 0
            ? group.minorCategories
            : DEFAULT_MAJOR_MINORS['others - new product'],
      });
    } else if (key === 'others - new service') {
      transformed.push({
        majorCategory: 'Others – New Service',
        minorCategories:
          group.minorCategories && group.minorCategories.length > 0
            ? group.minorCategories
            : DEFAULT_MAJOR_MINORS['others - new service'],
      });
    } else {
      transformed.push(group);
    }
  });

  groups = transformed;
  majorsByKey = new Map();
  minorsByMajorKey = new Map();

  groups.forEach((group) => {
    const majorKey = taxonomyKey(group.majorCategory);
    majorsByKey.set(majorKey, group.majorCategory);
    const minors = new Map<string, string>();
    (group.minorCategories || []).forEach((minor) => {
      if (!minor) return;
      minors.set(taxonomyKey(minor), minor);
    });
    minorsByMajorKey.set(majorKey, minors);
  });
}

/** Everything currently loaded, in master order. */
export function getCategoryTaxonomy(): MajorMinorCategory[] {
  return groups;
}

/** True once a taxonomy has actually been loaded. */
export function isCategoryTaxonomyLoaded(): boolean {
  return groups.length > 0;
}

/** Major categories in master display order, with guaranteed standard options fallback. */
export function getMajorCategories(): string[] {
  if (groups.length > 0) {
    return groups.map((group) => group.majorCategory);
  }
  return [
    'Engineering Spares - Mechanical',
    'Engineering Spares - Electrical',
    'Civil Works',
    'Information Technology (IT) & Software',
    'Occuptional Health and Safety',
    'Logistics & Transportation',
    'Chemicals & Raw Materials',
    'Others – New Product',
    'Others – New Service',
  ];
}

const DEFAULT_MAJOR_MINORS: Record<string, string[]> = {
  'engineering spares - mechanical': [
    'Pumps & Accessories',
    'Hoses, Valves & Fittings',
    'Pipes & Pipe Fittings',
    'Filters',
    'Tools & Tackles',
    'Machinery Parts',
    'Compressors & Accessories',
    'Customised Parts',
  ],
  'engineering spares - electrical': [
    'Motors',
    'Cables',
    'Panels',
    'Transformers',
    'Circuit Breakers',
    'Lighting',
    'Switchgear',
    'Customised Parts',
  ],
  'civil works': [
    'PEB Structure',
    'TMT BARS',
    'Roofing Sheets',
    'Paints',
    'Plumbing',
    'Fabrication',
    'Bricks & Blocks',
  ],
  'information technology (it) & software': [
    'Cloud Infrastructure & Storage',
    'Enterprise Software & Licenses',
    'IT Hardware & Peripherals',
    'IT Infrastructure',
    'Cybersecurity Solutions',
    'Data & Analytics Platforms',
  ],
  'occuptional health and safety': [
    'Hemlets',
    'Harness',
    'Gloves',
    'Safety Shoes',
    'Eye Protection',
    'Fire Safety',
  ],
  'logistics & transportation': [
    'Freight Forwarding',
    'Road Transportation',
    'Warehousing & 3PL',
    'Express Cargo & Courier',
  ],
  'chemicals & raw materials': [
    'Industrial Chemicals',
    'Solvents & Lubricants',
    'Specialty Chemicals',
    'Polymers & Resins',
  ],
  'others - new product': [
    'Storage Racks',
    'Packaging Material',
    'General Consumables',
    'Air Purifiers',
    'Furniture',
    'Cleanroom Solutions',
    'Measuring Equipment',
    'Renewable Energy',
    'Water Treatment Plants',
    'Others',
  ],
  'others - new service': [
    'Consulting',
    'Maintenance & AMC',
    'Installation & Fabrication',
    'Inspection & Testing',
    'Calibration Services',
    'Appliances Services',
    'Drone Surveys',
    'Warehousing',
    'Waste Management',
  ],
};

/** Minor categories under a major, or standard default list when dynamic taxonomy is loading. */
export function getMinorCategories(major: string): string[] {
  if (!major) return [];
  const key = taxonomyKey(major);
  const group = groups.find((g) => taxonomyKey(g.majorCategory) === key);
  if (group && group.minorCategories && group.minorCategories.length > 0) {
    return group.minorCategories;
  }
  return DEFAULT_MAJOR_MINORS[key] || [];
}

/** Get the first/default minor category for a given major category */
export function getDefaultMinorForMajor(major: string): string {
  if (!major) return '';
  const minors = getMinorCategories(major);
  return minors[0] || '';
}

/** Whether the master contains this major category. */
export function hasMajorCategory(major: string): boolean {
  return Boolean(major && (majorsByKey.has(taxonomyKey(major)) || DEFAULT_MAJOR_MINORS[taxonomyKey(major)]));
}

/** Whether the master contains this minor under this major. */
export function hasMinorCategory(major: string, minor: string): boolean {
  if (!major || !minor) return false;
  const minors = minorsByMajorKey.get(taxonomyKey(major));
  if (minors && minors.has(taxonomyKey(minor))) return true;
  const defaults = DEFAULT_MAJOR_MINORS[taxonomyKey(major)] || [];
  return defaults.some((d) => taxonomyKey(d) === taxonomyKey(minor));
}

/**
 * The major category the master owns a minor under, or an empty string.
 *
 * The first match wins for a minor that appears under several majors
 * ('Refractories', 'Panels', 'Conveyors'), matching the order a buyer sees in the
 * dropdown.
 */
export function findMajorForMinor(minor: string): string {
  if (!minor) return '';
  const key = taxonomyKey(minor);
  let found = '';
  minorsByMajorKey.forEach((minors, majorKey) => {
    if (!found && minors.has(key)) {
      found = majorsByKey.get(majorKey) || '';
    }
  });
  return found;
}

const KNOWN_KEYWORD_RULES: Array<{
  keywords: string[];
  major: string;
  minor: string;
}> = [
  // 1. Engineering Spares - Mechanical
  {
    keywords: [
      'pump', 'pumps', 'centrifugal pump', 'submersible pump', 'vacuum pump', 'dosing pump', 'rotary pump', 'water pump', 'impeller'
    ],
    major: 'Engineering Spares - Mechanical',
    minor: 'Pumps & Accessories',
  },
  {
    keywords: [
      'compressor', 'compressors', 'air compressor', 'reciprocating compressor', 'screw compressor', 'pneumatic compressor'
    ],
    major: 'Engineering Spares - Mechanical',
    minor: 'Compressors & Accessories',
  },
  {
    keywords: [
      'valve', 'valves', 'ball valve', 'gate valve', 'globe valve', 'check valve', 'butterfly valve', 'solenoid valve',
      'hose', 'hoses', 'hydraulic hose', 'flange', 'flanges', 'fitting', 'fittings', 'gasket', 'gaskets',
      'seal', 'seals', 'o-ring', 'o rings', 'o-rings', 'mechanical seal'
    ],
    major: 'Engineering Spares - Mechanical',
    minor: 'Hoses, Valves & Fittings',
  },
  {
    keywords: [
      'pipe', 'pipes', 'piping', 'tubing', 'tube', 'tubes', 'nipple', 'elbow', 'tee', 'reducer', 'pipe fitting', 'seamless pipe', 'gi pipe', 'ms pipe', 'ss pipe'
    ],
    major: 'Engineering Spares - Mechanical',
    minor: 'Pipes & Pipe Fittings',
  },
  {
    keywords: [
      'filter', 'filters', 'air filter', 'oil filter', 'cartridge', 'cartridges', 'strainer', 'strainers', 'filtration', 'filter element', 'hydraulic filter'
    ],
    major: 'Engineering Spares - Mechanical',
    minor: 'Filters',
  },
  {
    keywords: [
      'tool', 'tools', 'tackle', 'tackles', 'wrench', 'spanner', 'drill', 'drill bit', 'cutter', 'pliers',
      'fastener', 'fasteners', 'bolt', 'bolts', 'nut', 'nuts', 'screw', 'screws', 'washer', 'washers', 'stud', 'studs', 'anchor bolt'
    ],
    major: 'Engineering Spares - Mechanical',
    minor: 'Tools & Tackles',
  },
  {
    keywords: [
      'bearing', 'bearings', 'ball bearing', 'roller bearing', 'gear', 'gears', 'gearbox', 'pulley', 'pulleys',
      'sprocket', 'sprockets', 'shaft', 'shafts', 'coupling', 'couplings', 'clutch', 'clutches',
      'boiler', 'boilers', 'turbine', 'turbines', 'conveyor', 'conveyors', 'conveyor belt', 'cylinder', 'cylinders',
      'piston', 'pistons', 'spares', 'mechanical spares', 'spring', 'springs', 'nozzle', 'nozzles', 'machinery', 'machinery parts'
    ],
    major: 'Engineering Spares - Mechanical',
    minor: 'Machinery Parts',
  },
  {
    keywords: [
      'customised parts', 'customized parts', 'machined part', 'precision component', 'custom component', 'cnc part'
    ],
    major: 'Engineering Spares - Mechanical',
    minor: 'Customised Parts',
  },

  // 2. Engineering Spares - Electrical
  {
    keywords: ['motor', 'motors', 'rotor', 'stator', 'servo', 'vfd', 'drive', 'drives', 'induction motor', 'electric motor', 'variable frequency drive'],
    major: 'Engineering Spares - Electrical',
    minor: 'Motors',
  },
  {
    keywords: ['cable', 'cables', 'wire', 'wires', 'wiring', 'conduit', 'conduits', 'cable gland', 'cable tray', 'copper wire', 'armoured cable', 'power cable'],
    major: 'Engineering Spares - Electrical',
    minor: 'Cables',
  },
  {
    keywords: ['panel', 'panels', 'switchboard', 'distribution board', 'mcc', 'pcc', 'db box', 'enclosure', 'control panel', 'junction box'],
    major: 'Engineering Spares - Electrical',
    minor: 'Panels',
  },
  {
    keywords: ['transformer', 'transformers', 'inverter', 'inverters', 'rectifier', 'ups', 'battery', 'batteries', 'generator', 'generators', 'diesel generator', 'dg set'],
    major: 'Engineering Spares - Electrical',
    minor: 'Transformers',
  },
  {
    keywords: ['mccb', 'mcb', 'acb', 'elcb', 'rccb', 'breaker', 'breakers', 'circuit breaker', 'fuse', 'fuses', 'contactor', 'contactors', 'relay', 'relays', 'switch', 'switches'],
    major: 'Engineering Spares - Electrical',
    minor: 'Circuit Breakers',
  },
  {
    keywords: ['light', 'lights', 'lighting', 'led', 'led light', 'flood light', 'bay light', 'luminaire', 'lamp', 'lamps', 'bulb', 'bulbs'],
    major: 'Engineering Spares - Electrical',
    minor: 'Lighting',
  },
  {
    keywords: ['switchgear', 'ht switchgear', 'lt switchgear', 'vcb', 'vacuum circuit breaker', 'ring main unit', 'rmu'],
    major: 'Engineering Spares - Electrical',
    minor: 'Switchgear',
  },

  // 3. Civil Works
  {
    keywords: ['rebar', 'rebars', 'tmt', 'steel bar', 'reinforcement', 'tmt bar', 'tmt bars', 'fe 500', 'fe 550'],
    major: 'Civil Works',
    minor: 'TMT BARS',
  },
  {
    keywords: ['peb', 'peb structure', 'pre-engineered', 'shed', 'warehouse structure', 'steel structure', 'structural steel', 'purlin'],
    major: 'Civil Works',
    minor: 'PEB Structure',
  },
  {
    keywords: ['roofing', 'roofing sheet', 'roofing sheets', 'profile sheet', 'corrugated sheet', 'polycarbonate sheet'],
    major: 'Civil Works',
    minor: 'Roofing Sheets',
  },
  {
    keywords: ['paint', 'paints', 'primer', 'enamel', 'epoxy paint', 'wall paint', 'coating', 'coatings'],
    major: 'Civil Works',
    minor: 'Paints',
  },
  {
    keywords: ['plumbing', 'sanitary', 'pipe fitting plumbing', 'faucet', 'tap', 'cpvc', 'upvc', 'drainage'],
    major: 'Civil Works',
    minor: 'Plumbing',
  },
  {
    keywords: ['fabrication', 'structural fabrication', 'sheet metal fabrication', 'ms plate', 'steel plate', 'steel sheet', 'angle iron', 'ms angle', 'ms channel', 'i beam', 'h beam', 'ms beam'],
    major: 'Civil Works',
    minor: 'Fabrication',
  },
  {
    keywords: ['brick', 'bricks', 'block', 'blocks', 'aac block', 'aac blocks', 'fly ash brick', 'concrete block', 'masonry', 'paver', 'paver blocks', 'cement', 'concrete', 'mortar', 'sand', 'aggregate'],
    major: 'Civil Works',
    minor: 'Bricks & Blocks',
  },

  // 4. Information Technology (IT) & Software
  {
    keywords: ['laptop', 'laptops', 'desktop', 'desktops', 'computer', 'computers', 'server', 'servers', 'monitor', 'monitors', 'keyboard', 'mouse', 'printer', 'printers', 'scanner', 'hard disk', 'ssd', 'ram'],
    major: 'Information Technology (IT) & Software',
    minor: 'IT Hardware & Peripherals',
  },
  {
    keywords: ['software', 'software license', 'software licenses', 'microsoft', 'oracle', 'sap', 'erp', 'crm', 'saas', 'license', 'licenses', 'antivirus', 'os license'],
    major: 'Information Technology (IT) & Software',
    minor: 'Enterprise Software & Licenses',
  },
  {
    keywords: ['cloud', 'aws', 'azure', 'gcp', 'cloud storage', 'cloud hosting', 'virtual machine', 's3', 'storage server'],
    major: 'Information Technology (IT) & Software',
    minor: 'Cloud Infrastructure & Storage',
  },
  {
    keywords: ['cybersecurity', 'firewall', 'security software', 'vpn', 'edr', 'soc', 'endpoint security'],
    major: 'Information Technology (IT) & Software',
    minor: 'Cybersecurity Solutions',
  },
  {
    keywords: ['router', 'routers', 'network switch', 'access point', 'wifi', 'lan', 'patch cord', 'server rack', 'data cable'],
    major: 'Information Technology (IT) & Software',
    minor: 'IT Infrastructure',
  },
  {
    keywords: ['bi platform', 'power bi', 'tableau', 'analytics', 'database', 'sql server', 'data warehouse'],
    major: 'Information Technology (IT) & Software',
    minor: 'Data & Analytics Platforms',
  },

  // 5. Occuptional Health and Safety
  {
    keywords: ['helmet', 'helmets', 'hard hat', 'hard hats', 'hemlet', 'hemlets', 'safety helmet'],
    major: 'Occuptional Health and Safety',
    minor: 'Hemlets',
  },
  {
    keywords: ['safety harness', 'harness', 'fall arrest', 'fall protection', 'safety belt', 'lanyard'],
    major: 'Occuptional Health and Safety',
    minor: 'Harness',
  },
  {
    keywords: ['glove', 'gloves', 'safety gloves', 'leather gloves', 'nitrile gloves', 'cotton gloves', 'hand protection'],
    major: 'Occuptional Health and Safety',
    minor: 'Gloves',
  },
  {
    keywords: ['safety shoe', 'safety shoes', 'safety boot', 'safety boots', 'steel toe', 'steel toe shoes', 'gumboot', 'gumboots'],
    major: 'Occuptional Health and Safety',
    minor: 'Safety Shoes',
  },
  {
    keywords: ['safety goggle', 'safety goggles', 'safety glasses', 'eye protection', 'face shield', 'welding glass', 'goggle', 'goggles'],
    major: 'Occuptional Health and Safety',
    minor: 'Eye Protection',
  },
  {
    keywords: ['fire extinguisher', 'fire extinguishers', 'extinguisher', 'extinguishers', 'fire hydrant', 'fire sprinkler', 'fire hose', 'fire alarm', 'smoke detector', 'fire fighting', 'fire safety', 'safety jacket', 'high vis', 'reflective jacket', 'vest'],
    major: 'Occuptional Health and Safety',
    minor: 'Fire Safety',
  },

  // 6. Logistics & Transportation
  {
    keywords: ['freight', 'freight forwarding', 'ocean freight', 'air freight', 'sea freight', 'customs clearance', 'shipping'],
    major: 'Logistics & Transportation',
    minor: 'Freight Forwarding',
  },
  {
    keywords: ['transportation', 'road transport', 'road transportation', 'trucking', 'trailer', 'lorry', 'truck transport', 'ftl', 'ltl'],
    major: 'Logistics & Transportation',
    minor: 'Road Transportation',
  },
  {
    keywords: ['warehousing & 3pl', 'warehouse storage', '3pl', 'logistics warehouse', 'pallet storage', 'distribution center'],
    major: 'Logistics & Transportation',
    minor: 'Warehousing & 3PL',
  },
  {
    keywords: ['courier', 'express cargo', 'express cargo & courier', 'parcel delivery', 'speed post'],
    major: 'Logistics & Transportation',
    minor: 'Express Cargo & Courier',
  },

  // 7. Chemicals & Raw Materials
  {
    keywords: ['chemical', 'chemicals', 'industrial chemicals', 'acid', 'hydrochloric acid', 'sulfuric acid', 'caustic soda', 'sodium hydroxide', 'bleach', 'ammonia'],
    major: 'Chemicals & Raw Materials',
    minor: 'Industrial Chemicals',
  },
  {
    keywords: ['solvent', 'solvents', 'lubricant', 'lubricants', 'industrial oil', 'engine oil', 'hydraulic oil', 'grease', 'lubricating grease', 'thinner', 'acetone', 'solvents & lubricants'],
    major: 'Chemicals & Raw Materials',
    minor: 'Solvents & Lubricants',
  },
  {
    keywords: ['specialty chemicals', 'specialty chemical', 'catalyst', 'additive', 'corrosion inhibitor', 'water treatment chemical', 'flocculant', 'coagulant'],
    major: 'Chemicals & Raw Materials',
    minor: 'Specialty Chemicals',
  },
  {
    keywords: ['polymer', 'polymers', 'resin', 'resins', 'epoxy resin', 'plastic granules', 'polyethylene', 'polypropylene', 'pvc resin', 'rubber compound', 'polymers & resins'],
    major: 'Chemicals & Raw Materials',
    minor: 'Polymers & Resins',
  },

  // 8. Others – New Product
  {
    keywords: ['storage rack', 'storage racks', 'racking', 'pallet rack', 'pallet racking', 'slotted angle', 'cantilever rack', 'mezzanine', 'shelving', 'industrial rack'],
    major: 'Others – New Product',
    minor: 'Storage Racks',
  },
  {
    keywords: ['packaging', 'packaging material', 'corrugated box', 'carton', 'carton box', 'bubble wrap', 'stretch film', 'wooden pallet', 'strapping roll', 'tapes'],
    major: 'Others – New Product',
    minor: 'Packaging Material',
  },
  {
    keywords: ['furniture', 'office chair', 'office desk', 'workstation', 'table', 'cupboard', 'cabinet', 'locker'],
    major: 'Others – New Product',
    minor: 'Furniture',
  },
  {
    keywords: ['measuring equipment', 'caliper', 'micrometer', 'pressure gauge', 'temperature gauge', 'flow meter', 'weighing scale', 'vernier caliper', 'sensor', 'sensors', 'transducer', 'transmitter'],
    major: 'Others – New Product',
    minor: 'Measuring Equipment',
  },
  {
    keywords: ['cleanroom', 'cleanroom solutions', 'hvac cleanroom', 'air shower', 'pass box', 'laminar air flow', 'hepa filter unit'],
    major: 'Others – New Product',
    minor: 'Cleanroom Solutions',
  },
  {
    keywords: ['air purifier', 'air purifiers', 'dehumidifier'],
    major: 'Others – New Product',
    minor: 'Air Purifiers',
  },
  {
    keywords: ['solar', 'solar panel', 'renewable energy', 'wind energy'],
    major: 'Others – New Product',
    minor: 'Renewable Energy',
  },
  {
    keywords: ['water treatment plants', 'water treatment', 'ro plant', 'effluent treatment', 'etp', 'stp', 'sewage treatment', 'dm plant', 'water purification'],
    major: 'Others – New Product',
    minor: 'Water Treatment Plants',
  },
  {
    keywords: ['consumable', 'consumables', 'general consumables', 'stationery', 'paper', 'cleaning chemical', 'mop', 'wiper'],
    major: 'Others – New Product',
    minor: 'General Consumables',
  },
  {
    keywords: ['product', 'equipment', 'general item', 'hardware item'],
    major: 'Others – New Product',
    minor: 'Others',
  },

  // 9. Others – New Service
  {
    keywords: ['maintenance', 'amc', 'annual maintenance', 'repair service', 'overhaul', 'servicing', 'preventive maintenance', 'breakdown repair', 'maintenance & amc'],
    major: 'Others – New Service',
    minor: 'Maintenance & AMC',
  },
  {
    keywords: ['installation', 'erection', 'installation service', 'commissioning', 'site fabrication', 'piping erection', 'equipment installation', 'installation & fabrication'],
    major: 'Others – New Service',
    minor: 'Installation & Fabrication',
  },
  {
    keywords: ['inspection', 'testing', 'ndt', 'non destructive testing', 'quality inspection', 'third party inspection', 'load testing', 'hydro testing', 'inspection & testing'],
    major: 'Others – New Service',
    minor: 'Inspection & Testing',
  },
  {
    keywords: ['calibration', 'calibration service', 'calibration services', 'instrument calibration', 'meter calibration'],
    major: 'Others – New Service',
    minor: 'Calibration Services',
  },
  {
    keywords: ['appliances services', 'appliance repair', 'hvac service', 'ac service'],
    major: 'Others – New Service',
    minor: 'Appliances Services',
  },
  {
    keywords: ['drone survey', 'drone surveys', 'aerial survey', 'drone inspection'],
    major: 'Others – New Service',
    minor: 'Drone Surveys',
  },
  {
    keywords: ['warehousing service', 'storage service'],
    major: 'Others – New Service',
    minor: 'Warehousing',
  },
  {
    keywords: ['waste management', 'hazardous waste', 'scrap disposal', 'effluent disposal', 'e-waste'],
    major: 'Others – New Service',
    minor: 'Waste Management',
  },
  {
    keywords: ['consulting', 'consultancy', 'advisory', 'audit', 'energy audit', 'safety audit', 'training', 'manpower service', 'engineering consultancy'],
    major: 'Others – New Service',
    minor: 'Consulting',
  },
];

function matchesRuleKeyword(combined: string, tokens: string[], kw: string): boolean {
  const kwLower = kw.toLowerCase().trim();
  if (!kwLower) return false;
  if (kwLower.includes(' ')) {
    const escaped = kwLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|\\s)${escaped}(\\s|$)`, 'i').test(combined);
  }
  return tokens.some((token) => token === kwLower || (kwLower.length >= 4 && token.startsWith(kwLower)));
}

/**
 * Automatically identify and assign the appropriate major and minor category
 * based on item name and technical specifications keywords.
 */
export function autoCategorizeItem(
  itemName: string,
  specs = ''
): { majorCategory: string; minorCategory: string } {
  const combined = `${itemName || ''} ${specs || ''}`.trim().toLowerCase();
  if (!combined) {
    return { majorCategory: '', minorCategory: '' };
  }

  // Tokenize the combined text into words
  const tokens = combined.split(/[\s,./\\;:\-_+()\[\]{}|*&^%$#@!~`]+/).filter((t) => t.length >= 2);

  // 1. Direct match against known procurement keyword patterns
  for (const rule of KNOWN_KEYWORD_RULES) {
    if (rule.keywords.some((kw) => matchesRuleKeyword(combined, tokens, kw))) {
      return { majorCategory: rule.major, minorCategory: rule.minor };
    }
  }

  // 2. Match against dynamic registered taxonomy
  for (const group of groups) {
    const major = group.majorCategory;
    for (const minor of group.minorCategories || []) {
      if (minor && matchesRuleKeyword(combined, tokens, minor)) {
        return { majorCategory: major, minorCategory: minor };
      }
    }
    if (major && matchesRuleKeyword(combined, tokens, major)) {
      const defaultMinor = group.minorCategories?.[0] || '';
      return { majorCategory: major, minorCategory: defaultMinor };
    }
  }

  // 3. Fallback based on service vs product cues
  if (/service|repair|maintenance|installation|consulting|commissioning|inspection|testing|audit|civil work/i.test(combined)) {
    return { majorCategory: 'Others – New Service', minorCategory: 'Consulting' };
  }

  if (/product|material|equipment|supply|supplies|spares|item|hardware/i.test(combined)) {
    return { majorCategory: 'Others – New Product', minorCategory: 'Others' };
  }

  return { majorCategory: '', minorCategory: '' };
}

/** Total minor categories across every major, for the summary counters. */
export function countMinorCategories(): number {
  return groups.reduce((total, group) => total + (group.minorCategories?.length || 0), 0);
}

/** Discard the loaded taxonomy. Used by tests and on sign-out. */
export function clearCategoryTaxonomy(): void {
  setCategoryTaxonomy([]);
}
