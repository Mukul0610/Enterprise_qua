/**
 * Centralized UI Strings & Screen Text Constants (i18n Ready)
 * Single source of truth for UI typography, headings, labels, actions, and template messages.
 */

export const UI_STRINGS = {
  appName: 'Procucev Enterprise',
  engineVersion: 'QUA AI 2.0',
  tagline: 'Autonomous Industrial Procurement & Supplier Telemetry Orchestration',

  screens: {
    commandCenter: {
      title: 'Buyer Dashboard',
      screenTag: 'Screen 1.1',
      subtitle: 'Real-time multi-channel supplier chasing & automated quote evaluation telemetry.',
    },
    ingestionWizard: {
      title: 'Multi-Modal RFQ Ingestion Wizard',
      screenTag: 'Screen 1.2',
      subtitle: 'Parse structured, tabular, and unstructured industrial BOM requirements.',
    },
    rfqSummary: {
      title: 'RFQ Summary',
      screenTag: 'Screen 1.3',
      subtitle: 'Every RFQ raised by this organisation with intake source, sourcing mode and quote progress.',
    },
    quoteMatrix: {
      title: 'Comparative Quote Evaluation Matrix',
      screenTag: 'Screen 1.4',
      subtitle: 'Side-by-side parametric evaluation of line-item vendor bids synthesized by QUA AI.',
    },
    vendorEvaluation: {
      title: 'Vendor Comprehensive Evaluation Summary',
      screenTag: 'Screen 2.3',
      subtitle: 'Comprehensive 6-pillar vendor scorecards with verifiable OCR audit trails.',
    },
    categoryDashboard: {
      title: 'Category Manager Spend & Sourcing Console',
      screenTag: 'Screen 3.1',
      subtitle: 'Spend distribution, mode-allocation metrics, and buyer portfolio governance.',
    },
    infraControl: {
      title: 'Enterprise Infrastructure & Health Control Plane',
      screenTag: 'Screen 4.1',
      subtitle: 'Real-time Azure cloud telemetry, PostgreSQL pool monitoring, and AI inference latency tracking.',
    },
    auditLogs: {
      title: 'Enterprise Audit Trail & Security Ledger',
      screenTag: 'Screen 4.2',
      subtitle: 'Immutable record of system changes, procurement actions, and user activities.',
    },
  },

  actions: {
    backToDashboard: 'Back to Command Center',
    approveAndGeneratePO: '[ APPROVE & GENERATE PO ]',
    exportToExcel: 'Export Comparison Matrix',
    deepDiveTelemetry: 'Deep Dive Telemetry',
    pauseChasing: 'Pause AI Chasing',
    resumeChasing: 'Resume AI Chasing',
    saveChanges: 'Save Configuration',
    retrySync: 'Retry Synchronization',
    submit: 'Submit',
    cancel: 'Cancel',
    confirm: 'Confirm',
    downloadTemplate: 'Download CSV Template',
    hideDetails: 'Hide Details',
    reviewRfqDetails: 'Review RFQ Details',
    reviewVendorPerformance: 'Review Performance',
  },

  badges: {
    aiChasingActive: 'AI Chasing Active',
    aiChasingPaused: 'AI Chasing Paused',
    fullyCompliant: 'Fully Compliant',
    preferredVendor: 'Preferred Vendor (AI Recommended)',
    liveTelemetry: 'Live Telemetry',
    online: 'ONLINE',
    healthy: 'HEALTHY',
    aesEncrypted: 'AES-256-GCM Encrypted',
    aesGcmProtected: 'AES-256 AEAD Protected',
    cryptoVerified: 'Cryptographically Verified',
    emailQuoteSource: '✉️ Email',
    portalQuoteSource: '🌐 Portal',
  },


  navigation: {
    sidebarHeading: 'Workspace Modules',
    navLandmarkLabel: 'Role Workspace Sidebar Navigation',
    openMenu: 'Open Workspace Navigation',
    closeMenu: 'Close Workspace Navigation',
    dismissOverlay: 'Dismiss Navigation Overlay',
    activeModuleIndicator: 'Currently Active Module',
    signOut: 'Sign Out',
    signOutHint: 'Sign Out of Session',
    modulesCountTemplate: '{count} Modules',
    groups: {
      buyerSourcing: 'Sourcing Operations',
      buyerEvaluation: 'Evaluation & Vendors',
      buyerAccount: 'Account & Data',
      categoryOperations: 'Operational Desk',
      categoryConsoles: 'Buyer & Vendor Consoles',
      categoryGovernance: 'Category Governance',
      vendorOpportunities: 'Opportunities & Bids',
      vendorQualification: 'Qualification & Catalogue',
      vendorAccount: 'Subscription & Profile',
      adminPlatform: 'Platform Control Plane',
    },
    items: {
      commandCenter: {
        label: 'Dashboard',
        description: 'Live RFQ pipeline & AI chaser telemetry',
      },
      ingestionWizard: {
        label: 'AI RFQ Create',
        description: 'Parse BOM inputs & pick a sourcing version',
      },
      rfqSummary: {
        label: 'RFQ Summary',
        description: 'Portfolio of every RFQ raised & its quote status',
      },
      buyerEvaluationSummary: {
        label: 'Evaluation Summary',
        description: '6-pillar supplier scorecards with OCR trails',
      },
      vendorDirectory: {
        label: 'Vendor Directory',
        description: 'Empanelled roster & network suppliers',
      },
      sourcingSubscriptions: {
        label: 'Sourcing Subscriptions',
        description: 'Plan quotas & remaining free RFQs',
      },
      buyerProfile: {
        label: 'Buyer Profile',
        description: 'Organisation, tax identity & approvers',
      },
      buyerDbSync: {
        label: 'Buyer DB Sync',
        description: 'Integrated public database reconciliation',
      },
      vendorPoIngestion: {
        label: 'Vendor & PO Ingestion',
        description: 'Vendor master, PO history & AI categorisation',
      },
      operationalKanban: {
        label: 'Operational Kanban',
        description: 'Pipeline stages & chasing control board',
      },
      spendAnalytics: {
        label: 'Spend Analytics',
        description: 'Mode performance & spend distribution',
      },
      buyerRfqConsole: {
        label: 'Buyer RFQ Console',
        description: 'Buyer-wise enquiry governance',
      },
      modeEvaluations: {
        label: 'Mode 3 Evaluations',
        description: 'Autonomous sourcing evaluation reports',
      },
      vendorPerformance: {
        label: 'Vendor Performance',
        description: 'Supplier scorecards & bid reliability',
      },
      categoryTrends: {
        label: 'Categories & Trends',
        description: 'Demand-supply taxonomy analytics',
      },
      allRfqsConsole: {
        label: 'All RFQs',
        description: 'Every RFQ raised across all buyers',
      },
      opportunityFeed: {
        label: 'Opportunity Feed',
        description: 'Matched enquiries open for quoting',
      },
      bidQuotes: {
        label: 'Bid Quotes',
        description: 'Submit & track line-item quotations',
      },
      selfEvaluation: {
        label: '360° AI Self-Evaluation',
        description: 'Capability audit across 6 pillars',
      },
      itemCatalogue: {
        label: 'Item Catalogue',
        description: 'Published SKUs & pricing bands',
      },
      subscriptionPlans: {
        label: 'Subscription Plans',
        description: 'Access tiers, quotas & downloads',
      },
      billingHistory: {
        label: 'Billing History',
        description: 'Past payments & downloadable receipts',
      },
      supplierProfile: {
        label: 'Vendor Profile',
        description: 'Company credentials & banking vault',
      },
      azureInfrastructure: {
        label: 'Azure Infrastructure & AI',
        description: 'Cloud health, pools & inference latency',
      },
      immutableAuditLog: {
        label: 'Immutable Audit Log',
        description: 'SHA-256 chained compliance ledger',
      },
    },
  },

  templates: {
    rfqDispatched: 'RFQ #{rfqNumber} successfully dispatched to {vendorCount} qualified vendors.',
    poGenerated: 'Purchase Order #{poNumber} created and committed to ERP.',
    ratingUpdated: 'Vendor rating for {vendorName} revised to {newScore}/100.',
    welcomeUser: 'Welcome back, {userName} ({userRole})',
    totalSpendSummary: 'Total analyzed spend: ₹{amount} across {categoryCount} categories.',
  },
  /** Buyer RFQ Portfolio Summary (Screen 1.3). */
  /** AI document extraction inside the ingestion wizard (Screen 1.2). */
  /**
   * Manual RFQ entry. Every message names the offending field and says why the
   * value is needed, because "invalid input" tells a buyer nothing about what to
   * type instead.
   */
  manualRfq: {
    defaultStatus: 'Quotes Pending',

    // Line item
    itemNameRequired: 'Describe the item. Vendors quote against this text, so it cannot be blank.',
    quantityRequired: 'Enter a quantity above zero.',
    unitRequired: 'Enter a unit, for example Nos, Kg or Mtr.',
    majorCategoryRequired: 'Choose a major category so the RFQ routes to the right vendors.',
    minorCategoryRequired: 'Choose a minor category.',

    // Header
    titleLength: 'The RFQ title must be between {min} and {max} characters, or left blank to use the first line item.',
    deliveryLocationRequired:
      'Enter the delivery location. Vendors price freight against it, so it cannot be left blank.',
    deliveryLocationLength: 'The delivery location must be between {min} and {max} characters.',
    deliveryPincodeRequired:
      'Enter the delivery pincode or zipcode. Freight is rated on it, so it cannot be left blank.',
    deliveryPincodeInvalid:
      'Enter a pincode or zipcode of 3 to 10 letters, digits, spaces or hyphens, for example 400701.',
    budgetNegative: 'An estimated budget cannot be negative. Leave it blank to publish no ceiling.',
    lineItemsRequired: 'Add at least one line item so vendors have something to quote against.',
    targetDateCannotBePast: 'Target date cannot be earlier than today.',
  },

  /** The Manual RFQ Entry dialog opened from the wizard's Manual tab. */
  manualRfqModal: {
    title: 'Manual RFQ Entry',
    subtitle:
      '',
    closeAria: 'Close manual RFQ entry',

    titleLabel: 'RFQ Title',
    titlePlaceholder: 'Leave blank to use the first line item',
    budgetLabel: 'Estimated Budget ({symbol})',
    budgetPlaceholder: 'Leave blank to publish no ceiling',
    optionalTag: 'Optional',
    deliveryLocationLabel: 'Delivery Location',
    deliveryLocationPlaceholder: 'Plant, warehouse or site address',
    deliveryPincodeLabel: 'Pincode / Zipcode',
    deliveryPincodePlaceholder: 'e.g. 400701',
    targetDateLabel: 'Target Delivery Date',
    sourcingModeLabel: 'Sourcing Mode',

    lineItemsHeading: 'Line Items ({count})',
    addItemAction: 'Add Line Item',
    noItemsMessage: 'No line items yet. Add at least one so vendors have something to quote against.',
    colItem: 'Item Description',
    colSpecs: 'Specification',
    colMajor: 'Major Category',
    colMinor: 'Minor Category',
    colQty: 'Quantity',
    colUnit: 'Unit',
    colTargetDate: 'Target Date',
    itemPlaceholder: 'e.g. Centrifugal water pump',
    specsPlaceholder: 'e.g. SS316 impeller',
    qtyPlaceholder: 'Qty',
    unitPlaceholder: 'Nos',
    selectPlaceholder: 'Select…',
    removeItemAria: 'Remove {item}',
    untitledItem: 'this line item',

    attachHeading: 'Supporting Documents',
    attachHint:
      'Attach a BOQ, drawings, specs, or signed requisition (.xlsx, .xls, .csv, .pdf, .docx, .txt, .eml, .msg up to 15 MB). They are stored with the RFQ, and you can optionally read the line items out of them into the table below.',
    attachAction: 'Attach Documents',
    attachingAction: 'Uploading…',
    extractAction: 'Extract Line Items',
    extractingAction: 'Reading…',
    removeAttachmentAria: 'Remove {fileName}',

    quotaExhaustedTitle: 'Free RFQ Limit Reached (0 of 5 Remaining)',
    quotaExhaustedMessage:
      'You have consumed all 5 free RFQs. Please upgrade your plan to continue creating and dispatching RFQs across Version 1, Version 2, or Version 3.',
    upgradePlanAction: 'Upgrade Plan',

    serverAllocatesNumber: 'The RFQ number is allocated when you save.',
    cancelAction: 'Cancel',
    saveAction: 'Create RFQ',
    savingAction: 'Creating…',
  },

  rfqExtraction: {
    quotaExhaustedTitle: 'Free RFQ Quota Exhausted (0 of 5 Remaining)',
    quotaExhaustedMessage:
      'You have used all 5 free RFQs shared across V1, V2, and V3. Please upgrade your plan to continue creating and dispatching new RFQs.',
    upgradePlanAction: 'Upgrade Plan',

    // Step 1
    noFileTitle: 'No Document Selected',
    noFileMessage: 'Upload a BOQ spreadsheet, PDF or scanned requirement before continuing.',
    extractAction: 'Extract Line Items with AI',
    extractingLabel: 'Reading your document with QUA AI…',
    extractingHint: 'Identifying line items, quantities, units and specifications.',

    // Step 2 outcome banners
    successTitle: 'AI Extraction Complete',
    successSummary:
      '{accepted} line items extracted by {model}. {needsReview} need a category review before dispatch.',
    successToast: '{accepted} line items extracted from {fileName}.',
    fallbackTitle: 'Line Items Could Not Be Read',
    fallbackHint: 'Add each line item below, assign its minor category, then continue to sourcing.',
    unreadableResponse:
      'The extraction service returned an unexpected response. Add the line items manually to continue.',
    /**
     * Shown for a transport failure rather than a model failure. A dev-proxy error
     * or a stopped API answers with HTML, and reporting `unreadableResponse` for
     * that blamed the AI for what was actually an unreachable backend.
     */
    apiUnavailable:
      'The RFQ service is not responding (HTTP {status}), so the document could not be sent for extraction. It may be restarting — wait a moment and retry. You can add the line items manually to carry on in the meantime.',

    // Step 2 line-item table placeholders. A row added by hand starts completely
    // blank, so each field states what belongs in it.
    itemNamePlaceholder: 'Item name, with any size or model that identifies it',
    itemSpecsPlaceholder: 'Material grade, standard, class or rating',
    itemQtyPlaceholder: 'Qty',
    itemUnitPlaceholder: 'e.g. Nos',
    categoryPlaceholder: 'Select major category',
    minorCategoryPlaceholder: 'Select minor category',
    confidenceUnset: '—',

    // Step 2 empty state
    emptyTitle: 'No Line Items Yet',
    emptyMessage: 'Add at least one line item so vendors have something to quote against.',
    addFirstItemAction: 'Add First Line Item',
    incompleteItemsTitle: 'Line Items Incomplete',
    incompleteItemsMessage:
      'Every line item needs a description, a quantity above zero, a unit and both categories before you can choose a sourcing mode. Vendors quote against these, so a blank field cannot be dispatched.',

    // Step 2 RFQ header fields
    budgetLabel: 'Estimated Budget ({symbol})',
    budgetOptionalTag: 'Optional',
    budgetFromDocumentHint: 'Read from {fileName}. Edit it if the document under-states the true value.',
    budgetMissingHint: 'Optional. Leave it at zero if you would rather not publish a ceiling to vendors.',
    /**
     * Delivery destination. Both fields are mandatory: vendors price freight
     * against the location and the pincode, so a quote raised without them
     * cannot be compared against one that has them.
     */
    /**
     * Decorative marker only. It is rendered aria-hidden because the inputs carry
     * aria-required, which is what a screen reader announces; showing the glyph to
     * assistive tech as well would just read out a stray asterisk.
     */
    deliveryRequiredMarker: '*',
    deliveryLocationLabel: 'Delivery Location',
    deliveryLocationPlaceholder: 'Plant, warehouse or site address',
    deliveryLocationRequiredMessage:
      'Enter the delivery location. Vendors price freight against it, so it cannot be left blank.',
    deliveryLocationSchemaMessage: 'Delivery location is required and must be 3 to 200 characters.',
    deliveryPincodeLabel: 'Pincode / Zipcode',
    deliveryPincodePlaceholder: 'e.g. 400701',
    deliveryPincodeRequiredMessage:
      'Enter the delivery pincode or zipcode. Freight is rated on it, so it cannot be left blank.',
    // Manual entry saves through its own dialog, so it reports its own outcome.
    manualCreatedTitle: 'RFQ Created',
    manualCreatedMessage: '{rfqNumber} was saved and is now in your RFQ portfolio.',

    // The uploaded document is stored alongside the RFQ so the details screen can
    // offer it back. A storage failure does not stop the RFQ being raised, so the
    // message says exactly what is missing and what still went through.
    attachmentStoreFailedTitle: 'Document Not Attached',

    // Document upload tab. This tab takes documents only — an emailed requisition
    // is picked up by the autonomous gateway, so no email container is offered here.
    boqTabLabel: 'BOQ Spreadsheet / Drawing (.xlsx, .pdf, .docx)',
    processingDocumentLabel: 'Processing Document & Extracting Line-Items with AI OCR...',
    dropZoneHeading: 'Click to Browse or Drag & Drop RFQ Document / BOQ Spreadsheet',
    dropZoneHint:
      'Supports Excel (.xlsx, .xls), CSV, PDF drawings, Word specifications (.docx), text files (.txt), or forwarded requisition emails (.eml, .msg) up to 15 MB.',
    extractFooterHint: 'Your document is read by Gemini AI, then you confirm the line items in Step 2.',
    attachmentStoreFailedMessage:
      'The RFQ was created, but {fileName} could not be stored with it, so it will not appear under Supporting Documents. {reason} You can attach it again from the RFQ details screen.',

    deliveryPincodeInvalidTitle: 'Check the Delivery Details',
    deliveryPincodeInvalidMessage:
      'Enter a pincode or zipcode of 3 to 10 letters, digits, spaces or hyphens, for example 400701.',
    deliveryIncompleteTitle: 'Delivery Details Needed',
    deliveryIncompleteMessage:
      'Add the delivery location and a valid pincode or zipcode before choosing a sourcing mode. Vendors quote freight against both.',

    /**
     * Step strip. Rendered in order, and a step only becomes reachable once the
     * one before it has produced what the next step needs.
     */
    steps: [
      {
        number: 1,
        label: 'STEP 1: INGESTION',
        tag: 'Portal / Email',
        hint: 'BOQ file or Email Gateway',
      },
      {
        number: 2,
        label: 'STEP 2: MINOR CATEGORIZATION',
        tag: 'Taxonomy Mapping',
        hint: 'Classify into 280+ Minor Categories',
      },
      {
        number: 3,
        label: 'STEP 3: SOURCING MODE',
        tag: 'Mode Selection',
        hint: 'Choose how this RFQ reaches suppliers',
      },
    ],

    // Step 2 taxonomy re-classification
    classifyAction: 'AI Auto-Categorize All',
    classifyingLabel: 'Re-categorizing line items…',
    classifyEmptyTitle: 'Nothing to Categorize',
    classifyEmptyMessage: 'Add at least one line item with a description first.',
    classifySuccessTitle: 'Minor Categories Updated',
    classifySuccessMessage:
      '{accepted} line items re-categorized against the shared taxonomy. {needsReview} could not be matched and kept the default category.',
    classifyFailed:
      'Categories could not be refreshed just now. Set the major and minor category on each line item manually, or try again.',

    // Step strip gating
    stepLockedTitle: 'Finish the Current Step First',
    stepLockedExtractMessage: 'Upload a document and extract its line items before opening the review step.',
    stepLockedReviewMessage:
      'Review the line items, give each one a description, and fill in the delivery location and pincode before choosing a sourcing mode.',
    stepLockedHint: 'Complete the previous step',

    // Step 1 manual intake
    manualMethodLabel: 'Manual RFQ Entry',
    manualStartAction: 'Add Manual RFQ',
    manualHint: 'You will add each line item and its minor category in Step 2.',
    // The Manual tab now opens a dialog rather than routing through the review
    // step, so the tab itself just explains the path and offers the way in.
    manualPanelTitle: 'Enter RFQ Details Manually',
    manualPanelMessage:
      'Enter your RFQ details, including line items, delivery location, and supporting information, directly in the form. AI document extraction is not required for manual RFQ creation. Use document upload only when you want AI to extract RFQ details automatically.',

    manualBannerTitle: 'Manual Entry',
    manualBannerMessage: 'These line items were keyed by hand, so no AI confidence is reported against them.',

    // Step 1 manual attachments. Stored and shown back verbatim; never extracted.
    attachTitle: 'Supporting Documents',
    attachMessage:
      'Attach a drawing, specification sheet, indent form or document (.xlsx, .xls, .csv, .pdf, .docx, .txt, .eml, .msg up to 15 MB) to the RFQ. These are stored with the RFQ for reference and are not read by AI — you key the line items yourself on the next step.',
    attachAction: 'Choose Files',
    attachingLabel: 'Attaching…',
    attachedHeading: 'Attached ({count})',
    attachRemoveAria: 'Remove {fileName} from this RFQ',
    attachFailedTitle: 'Document Not Attached',
    attachLimitTitle: 'Attachment Limit Reached',
    attachLimitMessage: 'An RFQ can carry up to {max} supporting documents. Remove one before adding another.',
    attachUnreachable:
      'The document could not be uploaded because the RFQ service did not respond. Try again in a moment.',

    // Step 3 vendor placeholder
    vendorComingSoonTitle: 'Vendor Matching & Dispatch — Coming Soon',
    vendorComingSoonMessage:
      'Supplier matching, the Mode 3 anonymous pool and standard RFQ email dispatch are being rebuilt on the new sourcing engine. For now your RFQ is saved with the sourcing mode you select here, and vendors can be attached once matching goes live.',
    vendorComingSoonBadge: 'In Development',
    dispatchAction: 'Save RFQ with Selected Sourcing Mode',
    dispatchSummary: '{rfqNumber} — {itemCount} categorised line items will be saved under {modeCode}.',
  },

  /** Buyer RFQ Details (Screen 1.4) — everything submitted for one RFQ. */
  rfqDetails: {
    backAction: 'Back to RFQs',
    notFoundTitle: 'RFQ Not Found',
    // Reworded now that the page reads from the API rather than store state: a
    // miss means this RFQ is not under the signed-in buyer's organisation, which
    // is also the answer another organisation's RFQ gives.
    notFoundMessage:
      'This RFQ was not found under your organisation. Check the RFQ number, or return to the portfolio to pick one.',

    // API-backed loading
    loadingTitle: 'Loading RFQ',
    loadingMessage: 'Fetching the RFQ record and its line items.',
    loadFailedTitle: 'RFQ Could Not Be Loaded',
    loadFailed: 'The RFQ could not be read. Try again, and if it persists the API may be unavailable.',
    retryAction: 'Try Again',
    missingReferenceTitle: 'No RFQ Selected',
    missingReferenceMessage:
      'Open an RFQ from the portfolio so this page knows which record to display.',

    // Provenance strip. No "audit immutable" claim: nothing in the record backs
    // it, and the RFQ is in fact editable.
    documentTypeBadge: 'Request for Quotation (RFQ)',
    raisedOnStrip: 'Raised {timestamp}',
    updatedOnStrip: 'Edited {timestamp}',

    // Header & submission provenance
    submittedHeading: 'Submission Detail',
    sourceLabel: 'Intake Source',
    sourceWebPortal: 'Web Portal Upload',
    sourceEmailGateway: 'Email Gateway',
    sourceEmailUpload: 'Emailed Document',
    sourceManualEntry: 'Manual Entry',
    sourceFileLabel: 'Source Document',
    sourceEmailLabel: 'Source Email',
    createdLabel: 'Raised On',
    referenceLabel: 'Record ID',

    // Commercial & logistics
    commercialHeading: 'Commercial & Delivery',
    categoryLabel: 'Major Category',
    budgetLabel: 'Estimated Budget',
    targetDateLabel: 'Target Delivery',
    statusLabel: 'Current Status',
    deliveryLocationLabel: 'Delivery Location',
    deliveryPincodeLabel: 'PIN: {pincode}',
    unsetValue: 'Not provided',
    daysRemaining: '{days} days remaining',
    dueToday: 'Due today',
    overdueBy: 'Overdue by {days} days',

    // Line items
    lineItemsHeading: 'Line Items',
    lineItemsSubtitle: 'Package requirement specification',
    lineItemSearchPlaceholder: 'Search line items…',
    lineItemSearchAria: 'Search the line items of this RFQ',
    allMinorCategories: 'All Minor Categories',
    minorFilterAria: 'Filter line items by minor category',
    exportCsvAction: 'Export CSV',
    exportCsvAria: 'Download the line items of {rfqNumber} as CSV',
    colIndex: '#',
    colItem: 'Item Description',
    colSpecs: 'Technical Specification',
    colMajor: 'Major Category',
    colMinor: 'Minor Category',
    colCategory: 'Category',
    colQty: 'Qty',
    colUnit: 'Unit',
    colTargetDate: 'Required By',
    colConfidence: 'Confidence',
    noLineItems: 'No line items were recorded against this RFQ.',
    noLineItemMatches: 'No line items match the current search and filter.',
    clearFiltersAction: 'Clear search and filter',
    manualConfidence: 'Keyed manually',
    confidenceHigh: '{confidence}% High Confidence',
    confidenceReview: '{confidence}% Needs Review',
    displayingCount: 'Displaying {shown} of {total} line items',
    parsedSuccessfully: '{percent}% classified automatically',
    totalQuantityLabel: 'Total quantity',
    // Column sorting. The label names what clicking does next, so a screen reader
    // announces the action rather than the current state.
    sortAscAria: 'Sort by {column}, ascending',
    sortDescAria: 'Sort by {column}, descending',
    specsInlineLabel: 'Spec',

    // Quotes
    quotesHeading: 'Vendor Quotations',
    colVendor: 'Vendor',
    colUnitPrice: 'Unit Price',
    colTotalPrice: 'Total',
    colLeadTime: 'Lead Time',
    colMatchScore: 'AI Match',
    colCompliance: 'Compliance',
    leadTimeDays: '{days} days',
    noQuotes: 'No vendor quotations have been received yet.',
    noQuotesMessage:
      'Vendor matching and standard RFQ email dispatch are being rebuilt on the new sourcing engine, so this RFQ has not yet been circulated. Quotations will appear here once it goes live.',

    // Attachments
    attachmentsHeading: 'Supporting Documents',
    attachmentViewAction: 'View',
    attachmentViewAria: 'Open {fileName} in a new tab',
    attachmentUploadedOn: 'Attached {date}',
    noAttachments: 'No supporting documents were attached to this RFQ.',
  },

  rfqSummary: {
    createRFQAction: 'Create New RFQ',

    // KPI strip
    kpiTotalRFQs: 'Total RFQs Raised',
    kpiTotalRFQsHint: '{activeCount} still chasing vendors',
    kpiAwaitingQuotes: 'Awaiting First Quote',
    kpiAwaitingQuotesHint: '{quoteCount} quotations received in total',
    kpiPortfolioValue: 'Portfolio Value',
    kpiPortfolioValueHint: 'Averaging {average} quotes per RFQ',
    kpiVendorsEngaged: 'Vendors Invited',
    kpiVendorsEngagedHint: '{responded} have responded so far',

    // Sourcing mode distribution
    modeDistributionTitle: 'Sourcing Mode Distribution',
    modeSharePercent: '{modeCode}: {share}% of portfolio',

    // Filters
    searchLabel: 'Search Portfolio',
    searchPlaceholder: 'RFQ number, title, category or line item…',
    statusFilterLabel: 'Status',
    modeFilterLabel: 'Sourcing Mode',
    sourceFilterLabel: 'Intake Source',
    allStatuses: 'All Statuses',
    allModes: 'All Modes',
    allSources: 'All Sources',
    resultCount: 'Showing {shown} of {total} RFQs',

    // Intake source badges
    sourceEmailGateway: 'Email Gateway',
    sourceEmailUpload: 'Email File Upload',
    sourceManualEntry: 'Manual Web Entry',
    sourceWebPortal: 'Web App Portal',

    // Table
    tableCaption: 'RFQ portfolio with sourcing mode, status, quote counts and delivery dates',
    colRfqNumber: 'RFQ Number',
    colTitle: 'Title & Category',
    colMode: 'Mode',
    colStatus: 'Status',
    colItems: 'Items',
    colQuotes: 'Quotes',
    colBudget: 'Budget',
    colDelivery: 'Target Delivery',
    colActions: 'Actions',
    chasingActive: 'Chasers running',
    deliveryDateUnset: 'Not set',
    quotesReceivedLabel: '{count} quotes',
    ofInvited: 'of {invited} invited',
    budgetUnset: 'Not set',
    detailsAction: 'View Details',
    viewDetailsAria: 'View the full submitted detail for {rfqNumber}',
    followUpsAction: 'Follow-ups',
    quotesAction: 'Quotes',
    viewFollowUpsAria: 'View multi-channel follow-up detail for {rfqNumber}',
    viewQuotesAria: 'Open the comparative quote matrix for {rfqNumber}',

    // Empty & no-match states
    emptyPortfolioTitle: 'No RFQs raised yet',
    emptyPortfolioMessage:
      'Ingest a BOQ spreadsheet, forward a requisition email, or enter line items manually to raise your first RFQ.',
    noMatchesMessage: 'No RFQs match the current search and filter combination.',
    noQuotesYetTitle: 'No Quotes Received Yet',
    noQuotesYetMessage:
      'Vendors have not submitted quotations against {rfqNumber} yet. Chasers are still running, so check back shortly.',

    // Pagination
    rowsPerPageLabel: 'Rows per page',
    pageRange: 'Showing {from}–{to} of {total}',
    pageIndicator: 'Page {current} of {total}',
    previousPageAria: 'Go to the previous page of RFQs',
    nextPageAria: 'Go to the next page of RFQs',
  },

  allRfqs: {
    title: 'All RFQs',
    subtitle: 'Every RFQ raised across all buyer organisations',
    loading: 'Loading every RFQ…',
    loadFailed: 'The RFQ list could not be loaded. Try again, and if it persists the API may be unavailable.',
    retryAction: 'Retry',
    countSummary: '{count} RFQs across {buyers} buyers',
    searchLabel: 'Search',
    searchPlaceholder: 'RFQ number, title, category or buyer…',
    statusFilterLabel: 'Status',
    allStatuses: 'All Statuses',
    buyerFilterLabel: 'Buyer',
    allBuyers: 'All Buyers',
    noMatches: 'No RFQs match the current search and filters.',
    empty: 'No RFQs have been raised yet.',
    colRfqNumber: 'RFQ Number',
    colTitle: 'Title & Category',
    colBuyer: 'Buyer',
    colStatus: 'Status',
    colQuotes: 'Quotes',
    colBudget: 'Budget',
    colCreated: 'Raised',
    colActions: 'Actions',
    buyerUnknown: 'Unattributed',
    budgetUnset: 'Not set',
    viewMatrixAction: 'Quote Matrix',
    viewMatrixAria: 'Open the comparative quote matrix for {rfqNumber}',
    viewDetailsAction: 'Details',
    viewDetailsAria: 'View the full submitted detail for {rfqNumber}',
    inviteVendorsAction: 'Invite Vendors',
    inviteVendorsAria: 'Invite vendors to {rfqNumber}',
  },

  inviteVendors: {
    title: 'Invite Vendors',
    subtitle: 'Category-matched candidates for {rfqNumber}',
    closeAria: 'Close',
    loading: 'Loading candidate vendors…',
    loadFailed: 'The vendor candidate list could not be loaded.',
    noCandidates: 'No vendors cover this RFQ’s category yet.',
    candidateCount: '{count} candidates',
    selectAll: 'Select all',
    deselectAll: 'Deselect all',
    alreadyInvitedBadge: 'Invited',
    cancelAction: 'Cancel',
    inviteAction: 'Invite ({count})',
    successTitle: 'Vendors Invited',
    successMessage: '{count} vendor(s) invited to {rfqNumber}. They can now see it, and have been notified.',
    failTitle: 'Could Not Invite Vendors',
    categoryMatchesTab: 'Category Matches',
    allVendorsTab: 'All Vendors',
    searchPlaceholder: 'Search by name, category, email…',
    outsideCategoryBadge: 'Outside Category',
    noVendorsFound: 'No vendors match your search.',
    allVendorsLoadFailed: 'The vendor list could not be loaded.',
    loadMoreVendors: 'Load {pageSize} more vendors',
    candidateCountOfTotal: 'Showing {count} of {total} vendors',
  },

  notifications: {
    bellAria: 'Notifications',
    bellAriaUnread: '{count} unread notifications',
    heading: 'Notifications',
    unreadBadge: '{count} new',
    markAllRead: 'Mark all read',
    empty: 'You have no notifications yet.',
    loadFailed: 'Notifications could not be loaded.',
    aiFeedHeading: 'Vendor Follow Up Status',
    aiFeedEventCount: '{count} Events',
  },

  auth: {
    // Titles used by the sign-in / registration toasts
    signInFailedTitle: 'Sign In Failed',
    registrationFailedTitle: 'Registration Failed',
    otpRequestFailedTitle: 'OTP Request Failed',
    otpInvalidTitle: 'Invalid OTP',
    missingFieldsTitle: 'Missing Fields',
    loggedOutTitle: 'Logged Out',
    welcomeBackTitle: 'Welcome Back',
    registrationSuccessTitle: 'Registration Successful',

    // Field-level validation
    emailRequired: 'Enter your registered email address to continue.',
    passwordRequired: 'Enter your account password to continue.',
    emailAndPasswordRequired: 'Enter both your registered email address and password to continue.',
    loginFieldsRequired:
      'Enter your registered email address, registered mobile number and password to continue.',
    emailInvalid: 'Enter a valid email address, for example you@company.com.',
    otpRequired: 'Enter the 6-digit verification code that was emailed to you.',
    emailAndMobileRequired:
      'Enter both your registered email address and mobile number. The code is issued against the pair.',
    registrationFieldsRequired:
      'Full name, company email, mobile number and password are all required to create an account.',
    passwordTooShort: 'Choose a password of at least 8 characters.',
    mobileInvalid: 'Enter a valid 10-digit Indian mobile number.',

    // Network / backend reachability. These replace the previous behaviour of
    // silently fabricating a valid session when the API could not be reached.
    networkUnreachable:
      'Cannot reach the Procucev API, so your credentials could not be verified. Check that the backend is running on the configured port and that you are online, then try again.',
    serverErrorFallback:
      'The server rejected the request but did not explain why. Please retry, and contact support if it persists.',

    // Success / informational
    signedInAs: 'Signed in as {userName} ({userRole}) — {orgName}.',
    otpDispatched:
      'A {codeLength}-digit verification code has been emailed to {email}. It expires in {expiryMinutes} minutes.',
    loggedOutMessage: 'Successfully signed out of the secure workspace.',
    sessionExpired: 'Your session has expired. Sign in again to continue.',
    redirecting: 'Redirecting to your workspace…',
    showPassword: 'Show password',
    hidePassword: 'Hide password',
    registrationSuccessMessage:
      'Account created for {email}. You are signed in and can start configuring your workspace.',
  },

  // Editing and withdrawing an RFQ.
  rfqEdit: {
    editAction: 'Edit',
    editAria: 'Edit {rfqNumber}',
    deleteAction: 'Delete',
    deleteAria: 'Delete {rfqNumber}',

    // Edit dialog
    dialogTitle: 'Edit RFQ',
    dialogSubtitle:
      'Change the title, terms, line items and documents of {rfqNumber}. Only what you change is sent.',
    titleLabel: 'RFQ Title',
    categoryLabel: 'RFQ Major Category',
    statusLabel: 'Status',
    budgetLabel: 'Estimated Budget ({symbol})',
    targetDateLabel: 'Target Delivery Date',
    deliveryLocationLabel: 'Delivery Location',
    deliveryPincodeLabel: 'PIN / ZIP Code',
    optionalTag: 'Optional',

    // Section headings inside the dialog, mirroring the details page so the buyer
    // is editing the same groupings they were just reading.
    sectionCommercial: 'Commercial & Delivery',
    sectionLineItems: 'Line Items',
    sectionDocuments: 'Supporting Documents',
    sectionProvenance: 'Submission Detail',

    // Read-only provenance, shown so the buyer can see what an edit cannot change.
    readOnlyNote: 'Allocated by the server and not editable.',
    rfqNumberLabel: 'RFQ Number',
    raisedOnLabel: 'Raised On',
    raisedByLabel: 'Raised By',
    intakeSourceLabel: 'Intake Source',

    // Line items
    addItemAction: 'Add Line Item',
    removeItemAria: 'Remove line item {item}',
    untitledItem: 'this row',
    noItemsMessage: 'This RFQ has no line items. Add at least one before saving.',
    colItem: 'Item Description',
    colSpecs: 'Technical Specification',
    colMajor: 'Major Category',
    colMinor: 'Minor Category',
    colQty: 'Qty',
    colUnit: 'Unit',
    colTargetDate: 'Required By',
    selectMajorFirst: 'Select a major category first',
    itemNameRequired: 'Every line item needs a description.',
    quantityRequired: 'Every line item needs a quantity above zero.',
    unitRequired: 'Every line item needs a unit.',
    majorCategoryRequired: 'Every line item needs a major category.',
    lineItemsRequired: 'An RFQ needs at least one line item.',
    lineItemErrorSummary: 'Row {row}: {message}',

    // Documents
    attachAction: 'Attach Document',
    attachingAction: 'Uploading…',
    removeAttachmentAria: 'Remove {fileName}',
    noAttachmentsMessage: 'No supporting documents are attached.',
    attachHint: 'Stored against the RFQ and downloadable from its details page.',

    saveAction: 'Save Changes',
    savingAction: 'Saving…',
    cancelAction: 'Cancel',
    closeAria: 'Close the edit dialog',
    noChanges: 'Nothing has been changed yet.',

    // Validation. Same rules as creation, so an edit cannot introduce a value that
    // could not have been created.
    titleRequired: 'RFQ Title is required and must be at least 3 characters.',
    categoryRequired: 'Major Category is required.',
    budgetNegative: 'Estimated Budget cannot be negative. Leave it blank if no ceiling is set.',
    deliveryLocationRequired: 'Delivery Location is required so vendors can price freight.',
    deliveryPincodeRequired: 'PIN / ZIP Code is required so vendors can price freight.',
    deliveryPincodeInvalid:
      'PIN / ZIP Code must be 3 to 10 letters, digits, spaces or hyphens, for example 400701 or SW1A 1AA.',
    targetDateCannotBePast: 'Target date cannot be earlier than today.',

    // Outcomes
    savedTitle: 'RFQ Updated',
    savedMessage: '{rfqNumber} has been updated.',
    saveFailedTitle: 'RFQ Not Updated',
    saveFailed: 'The RFQ could not be updated. Try again, and if it persists the API may be unavailable.',

    // Delete confirmation. Named explicitly, because the RFQ number is the only
    // thing distinguishing one row from the next.
    deleteTitle: 'Delete this RFQ?',
    deleteConfirmMessage:
      'This permanently deletes {rfqNumber} ({title}) and its {itemCount} line items. This cannot be undone.',
    deleteConfirmAction: 'Delete RFQ',
    deletingAction: 'Deleting…',
    deletedTitle: 'RFQ Deleted',
    deletedMessage: '{rfqNumber} has been deleted.',
    deleteFailedTitle: 'RFQ Not Deleted',
    deleteFailed: 'The RFQ could not be deleted. Try again, and if it persists the API may be unavailable.',
  },

  vendorFeed: {
    // The direct-invitation buyer filter. Options are the buyers actually present
    // in the feed, so the label names the identity an RFQ carries (the raising
    // buyer's corporate email) rather than a company the RFQ has no field for.
    buyerFilterLabel: 'Raising Buyer',
    buyerFilterAll: '🌐 All Inviting Buyers',
  },

  buyerProfile: {
    // Toast titles
    loadFailedTitle: 'Profile Could Not Be Loaded',
    validationErrorTitle: 'Validation Error',
    saveFailedTitle: 'Profile Not Saved',
    savedTitle: 'Profile Saved Successfully',
    limitReachedTitle: 'Category Limit Reached',

    // Success
    savedMessage: 'Organization details and {categoryCount} procurement categories updated.',

    // Load / save failures. Each one says what state the record is in, so the
    // buyer knows whether their edits survived.
    loadUnreachable:
      'Cannot reach the Procucev API, so your organization profile could not be loaded. Check that the backend is running and that you are online, then reload this page.',
    loadRejected:
      'Your organization profile could not be loaded: {reason} Nothing has been changed.',
    saveUnreachable:
      'Cannot reach the Procucev API, so your changes were not saved. Your edits are still on screen — check your connection and press Save again.',
    saveRejected: 'Your changes were not saved: {reason}',
    sessionExpired:
      'Your session has expired, so the profile could not be saved. Sign in again and re-apply your changes.',
    notPermitted:
      'Your account role is not permitted to manage a buyer organization profile. Switch to a buyer account or contact your Procucev administrator.',
    serverErrorFallback:
      'The server rejected the request but did not explain why. Please retry, and contact support if it persists.',

    // Shown wherever a category picker has no options. There is no bundled copy of
    // the category master any more, so an unreadable master means no categories
    // can be offered — stating that is safer than offering a list that may not
    // match what RFQ routing and the saved scope are actually resolved against.
    taxonomyUnavailable:
      'The procurement category list could not be loaded, so no categories can be offered right now. Reload the page, and contact your Procucev administrator if it persists.',
    taxonomyEmpty:
      'No procurement categories are configured yet. Ask your Procucev administrator to load the category master before selecting categories.',

    // Field-level validation, surfaced through the existing toast so no new UI
    // is introduced.
    companyNameRequired: 'Legal Entity Name is required before the profile can be saved.',
    panInvalid: 'PAN must be 10 characters in the format AAAAA9999A, for example AAACL1234F.',
    gstInvalid: 'GSTIN must be 15 characters in the format 99AAAAA9999A9Z9, for example 27AAACL1234F1Z5.',
    cinInvalid:
      'CIN must be 21 characters in the format L99999AA9999AAA999999, for example L28920MH1946PLC004768.',
    websiteInvalid:
      'Corporate Website must be a full URL beginning http:// or https://, for example https://example.com.',
    pincodeInvalid: 'PIN Code must be 6 digits and cannot start with 0, for example 400001.',
    categoriesRequired:
      'Select at least one minor procurement category so RFQs can be matched to vendors.',

    // Cardinality caps
    maxMajorReached:
      'You can select at most {max} major procurement categories. Clear one before adding another.',
    maxMinorReached:
      'You have selected {count} of {max} minor procurement categories. Clear one before adding another.',
  },

  // ============================================================================
  // ACCOUNT & SECURITY
  // ============================================================================
  // Copy for the display-name and password-change forms. These used to be inline
  // literals in the header component; they moved here when the panel was lifted
  // out of the header so the buyer profile page and the header could share one
  // implementation without duplicating strings.
  accountSecurity: {
    // Headings. The panel holds only the password form, so it is named for
    // that rather than for "account" settings it no longer contains.
    menuLabel: 'Security',
    sectionTitle: 'Section 4: Security',
    panelTitle: 'Security Settings',
    sectionDescription:
      'Change the password used to sign in to your Procucev workspace.',

    // Password fields
    passwordSectionLabel: 'Change Sign-In Password',
    currentPasswordLabel: 'Current Password',
    currentPasswordPlaceholder: 'Enter your current password',
    newPasswordLabel: 'New Password',
    newPasswordPlaceholder: 'Min 8 characters',
    confirmPasswordLabel: 'Confirm New Password',
    confirmPasswordPlaceholder: 'Re-enter new password',
    updatePasswordAction: 'Update Password',
    updatingPasswordAction: 'Updating…',

    // Guidance shown beside the fields. This states what the server actually
    // enforces and separates it from what is merely advisable: the previous
    // copy listed an uppercase-and-symbol rule that nothing checked, and
    // claimed AES encryption at rest that is not in place.
    policyTitle: 'Password requirements:',
    policyMinLength: 'At least 8 characters. This is checked when you save.',
    policyReuse: 'Must be different from your current password.',
    policyComplexity:
      'Recommended: mix upper and lower case with at least one number and one symbol.',

    // Toast titles
    validationErrorTitle: 'Validation Error',
    weakPasswordTitle: 'Weak Password',
    passwordMismatchTitle: 'Password Mismatch',
    passwordChangedTitle: 'Password Changed',
    changeFailedTitle: 'Password Not Changed',

    // Toast messages. Failure text is supplied by the API so the reason is
    // specific; these cover the client-side checks and the fallbacks.
    currentPasswordRequired: 'Enter your current password to authorise the change.',
    weakPasswordMessage: 'Choose a new password of at least 8 characters.',
    passwordMismatchMessage: 'The new password and its confirmation do not match.',
    passwordSameAsCurrent:
      'The new password is the same as your current one. Choose a different password.',
    passwordChangedFallback:
      'Your password has been changed. Use it the next time you sign in.',
    changeFailedFallback:
      'Your password could not be changed and your existing password is still in effect. Try again in a moment.',

    // Modal-only affordance, used where the panel is presented as an overlay
    closeAction: 'Close',
  },

  // ============================================================================
  // CATEGORY MANAGER KANBAN
  // ============================================================================
  // Copy for the Ingested / Parsing column, which is where an email-ingested RFQ
  // lands. It has had no human review, so the card states its origin, what the
  // extractor could not place, and who it came from.
  categoryManagerKanban: {
    buyerLabel: 'Buyer',
    majorCategoryLabel: 'Major category',
    minorCategoryLabel: 'Minor category',
    itemsLabel: 'Line items',
    receivedLabel: 'Received',
    confidenceLabel: 'Avg. extraction confidence',
    reviewAction: 'Open & Review Categories',
    needsCategoryReview: '{count} need category',
    sourceLabels: {
      email_gateway: 'Email Gateway (Autonomous)',
      email_upload: 'Email File Upload',
      web_portal: 'Web Portal',
      manual_entry: 'Manual Entry',
    } as Record<string, string>,
  },

  // ============================================================================
  // AUTONOMOUS EMAIL INGESTION GATEWAY
  // ============================================================================
  // Copy for the Step 1 gateway panel. This replaced a simulator: a textarea with
  // three hardcoded sample requisitions and a green "Active & Listening" badge
  // with no connection behind it. Everything here now reflects real state, so the
  // not-configured and error cases matter as much as the healthy one.
  emailGateway: {
    title: 'Autonomous Email Ingestion Gateway',
    watchingLabel: 'Watching',
    notWatchingLabel: 'Not watching',
    offLabel: 'Switched off',
    notConfiguredLabel: 'Not configured',
    activeListeningLabel: 'Active & Listening',
    connectionErrorLabel_state: 'Connection error',

    // How it works. Deliberately stops at Category Manager review: this gateway
    // does not shortlist or contact vendors, and saying otherwise was the
    // misleading claim the simulator used to make.
    howItWorks:
      'Requisitions emailed to the gateway are automatically extracted and categorized, then sent to the Category Manager for review.',
    lightsOutTitle: 'Autonomous Lights-Out Ingestion',
    // The prototype's banner claimed this step also shortlisted vendors and
    // circulated the RFQ. It does neither: extraction and categorization are
    // automatic, release to vendors is a Category Manager decision.
    howItWorksAddressed:
      'When a requisition arrives from a registered buyer at {address}, the system automatically extracts the line items and assigns major and minor categories, then raises the RFQ for Category Manager review. No vendor is shortlisted or contacted at this stage.',

    // The intake address buyers send TO. Distinct from the IMAP login below,
    // which is the account the backend reads and is an operational detail.
    gatewayAddressLabel: 'Send requisitions to',
    gatewayAddressHint: 'Procucev intake mailbox',
    mailboxAccountLabel: 'Collected from',
    checkedEveryLabel: 'Checked every',
    reviewStatusLabel: 'Ingested RFQs are held in',

    // Worked example, so the direction of the flow cannot be misread.
    exampleTitle: 'How to send a requisition',
    exampleFromLabel: 'From',
    exampleFromValue: 'your registered buyer email',
    exampleToLabel: 'To',
    exampleSubjectLabel: 'Subject',
    exampleSubjectValue: 'RFQ - Industrial Water Pump',
    exampleBodyLabel: 'Body',
    exampleBodyValue: 'Line items and specifications, or attach a PDF / CSV',

    // What happens next, and explicitly what does not.
    nextStepsTitle: 'What happens next',
    nextStepExtract: 'Line items and major/minor categories are extracted automatically.',
    nextStepReview: 'The RFQ is created and appears on the Category Manager board for review.',
    nextStepNoVendors: 'No vendor is contacted from here. Releasing to vendors is the Category Manager\u2019s step.',

    // Who is allowed to raise a requisition by email.
    allowedAnyAccount:
      'Any sender registered as a buyer account. A message from an unknown address is recorded and skipped.',
    allowedSendersLabel: 'Allowed senders',
    allowedDomainsLabel: 'Allowed domains',

    // Not configured: name the exact variables, since this is a deployment step.
    setupTitle: 'No mailbox connected',
    setupBody:
      'Set EMAIL_GATEWAY_HOST, EMAIL_GATEWAY_USER and EMAIL_GATEWAY_PASSWORD in backend/.env, then set EMAIL_GATEWAY_ENABLED=true and restart the backend.',
    setupHint:
      'For Gmail use imap.gmail.com on port 993 with an App Password — a normal account password will be refused.',

    // Manual check
    checkNowAction: 'Check Mailbox Now',
    checkingLabel: 'Checking…',
    checkCompleteTitle: 'Mailbox Checked',
    checkCompleteMessage: 'Considered {considered} message(s), raised {ingested} RFQ(s). {pending} still queued.',
    checkFailedTitle: 'Mailbox Check Failed',
    pollFailed: 'The mailbox could not be checked. Confirm the gateway credentials and that the host is reachable.',
    statusUnavailable:
      'The gateway status could not be read. The backend may be starting up — retry in a moment.',

    // Activity ledger
    recentTitle: 'Recent inbound messages',
    recentEmpty: 'No inbound messages have been processed yet.',
    lastCheckedLabel: 'Last checked',
    neverChecked: 'Never',
    connectionErrorLabel: 'Last error',

    // Requisition composer form & submission
    sampleSelectorTitle: 'Select Incoming Email Requisition Sample:',
    samplePumps: 'Mechanical Pumps & Valves',
    sampleElectrical: 'Electrical Switchgear',
    sampleSteel: 'Civil & PEB Steel',
    fromPlantEngineerLabel: 'FROM (PLANT ENGINEER)',
    toGatewayLabel: 'TO (ENTERPRISE GATEWAY)',
    subjectInputLabel: 'SUBJECT',
    bodyInputLabel: 'EMAIL BODY & LINE-ITEM SPECS',
    submitAction: 'Autonomous Ingest, Categorize & Auto-Circulate RFQ',
    submittingAction: 'Ingesting & Processing with AI…',
    createdSuccessTitle: 'Requisition Ingested & RFQ Created Successfully',
    createdSuccessSubtitle:
      'The requisition was processed into line items and saved to the database. It is now queued for Category Manager review.',
    createdRfqNumberLabel: 'RFQ Number',
    createdStatusLabel: 'Status',
    createdItemsLabel: 'Extracted Line Items',
    createdBudgetLabel: 'Est. Budget',
    createdStatusValue: 'Ingested · Parsing (Awaiting Category Manager)',
    sendAnotherAction: 'Submit Another Requisition',
    viewInKanbanAction: 'View on Category Manager Board',

    // Ledger outcomes, keyed to the server's status values.
    outcomeIngested: 'RFQ raised',
    outcomeSenderNotAllowed: 'Sender not allowed',
    outcomeNoLineItems: 'No line items',
    outcomeUnreadable: 'Unreadable',
    outcomeFailed: 'Failed',
  },

  // ============================================================================
  // VENDOR MASTER & PO DATA INGESTION (Screen 1.6)
  // ============================================================================
  // Copy for the five-step buyer ingestion wizard. The wording is deliberately
  // precise about what the AI actually reads — the PO purchasing history, not the
  // company name — because that distinction is the whole value of the feature and
  // a vague label invites the buyer to trust a name-based guess.
  vendorPoIngestion: {
    title: 'Vendor Master & PO Data Ingestion',
    subtitle:
      'Upload your vendor master and historical PO purchase dump separately. Supplier categories are derived from actual purchasing history, then reviewed by you before any email is sent.',
    organizationLabel: 'Organisation',
    sessionLabel: 'Session',
    startNewAction: 'Start New Ingestion',
    resumeNotice: 'Resuming your last ingestion run. Nothing is lost if you navigate away.',
    loadingSession: 'Loading your ingestion session…',
    noSessionTitle: 'No ingestion run yet',
    noSessionBody:
      'Choose a time horizon to begin. You will upload your vendor master first, then your historical PO dump.',
    lockedStepTitle: 'Complete the earlier step first',
    lockedStepTemplate: 'Step {step} unlocks once the previous step is complete.',

    steps: {
      timeHorizon: { number: 1, label: 'Time Horizon', tag: 'Step 1' },
      vendorMaster: { number: 2, label: 'Vendor Master', tag: 'Step 2' },
      poDump: { number: 3, label: 'PO Dump', tag: 'Step 3' },
      aiCategoryJoin: { number: 4, label: 'AI Category Join', tag: 'Step 4' },
      dispatch: { number: 5, label: 'Dispatch Emails', tag: 'Step 5' },
    },

    horizon: {
      heading: 'Step 1 — Choose the historical purchase period',
      hint: 'Only PO records inside this period are used to categorise your suppliers.',
      last1Year: 'Last 1 Year (12 Months)',
      last1YearHint: 'Recent, high-velocity procurement only.',
      last2Years: 'Last 2 Years (24 Months)',
      last2YearsHint: 'Covers seasonal maintenance and capex cycles.',
      last2YearsBadge: 'Recommended',
      last3Years: 'Last 3 Years (36 Months)',
      last3YearsHint: 'Full historical audit and broadest supplier discovery.',
      custom: 'Custom Date Range',
      customHint: 'Pick an exact window, for example a financial year.',
      startDateLabel: 'Start date',
      endDateLabel: 'End date',
      selectedPeriodLabel: 'Selected Period',
      selectedPeriodTemplate: '{start} → {end}',
      continueAction: 'Continue to Vendor Master',
      saveAction: 'Save Period',
      changeWarning:
        'Changing the period clears any PO data already uploaded, because a different window means different purchasing evidence.',
    },

    vendorMaster: {
      heading: 'Step 2 — Upload File 1: Vendor Master',
      hint: 'Required columns: Vendor Code, Company Name, Contact Person, Email, Phone, Address, GSTIN. Rating (0-100) is optional.',
      dropzone: 'Click to browse or drag and drop your Vendor Master (.xlsx, .xls, .csv)',
      dropzoneParsing: 'Reading and validating vendor rows…',
      templateAction: 'Download Template',
      uploadAction: 'Validate & Store Vendor Master',
      replaceAction: 'Replace Stored Vendor Master',
      storedBadge: 'Stored',
      storedTemplate: '{count} vendors stored',
      previewHeading: 'Stored Vendor Master',
      emptyPreview: 'No vendor master stored for this session yet.',
      continueAction: 'Proceed to PO Dump',
      columnCode: 'Code',
      columnCompany: 'Company Name',
      columnContact: 'Email & Phone',
      columnGstin: 'GSTIN / Address',
      columnRating: 'Rating',
      ratingNotProvided: 'Not provided',
    },

    poDump: {
      heading: 'Step 3 — Upload File 2: Historical PO Purchase Dump',
      hint: 'Required columns: PO Number, PO Date, Vendor Code or Vendor Name, Line Item Description, Quantity, UOM, Spend, Department. Material Code, Existing Category, Subcategory and Currency are optional.',
      dropzone: 'Click to browse or drag and drop your PO dump (.xlsx, .xls, .csv)',
      dropzoneParsing: 'Reading and validating PO line items…',
      templateAction: 'Download Template',
      uploadAction: 'Validate & Store PO Dump',
      replaceAction: 'Replace Stored PO Dump',
      blockedByVendorMaster: 'Upload and store your Vendor Master before the PO dump.',
      insidePeriodLabel: 'Inside selected period',
      outsidePeriodLabel: 'Outside selected period',
      totalUploadedLabel: 'Total uploaded PO rows',
      noneInPeriodWarning:
        'None of the uploaded PO rows fall inside the selected period. Check the period, or the date column in your file.',
      runJoinAction: 'Run Vendor & PO Match',
      runningJoin: 'Matching PO history to your vendor master…',
    },

    join: {
      heading: 'Vendor & PO match',
      totalVendorsLabel: 'Total Vendors',
      matchedLabel: 'Matched Vendors',
      unmatchedLabel: 'No PO History',
      strategyHeading: 'How lines were attributed',
      byVendorCodeLabel: 'By Vendor Code',
      byGstinLabel: 'By GSTIN',
      byNameLabel: 'By normalised name',
      unattributedLabel: 'Unattributed',
      matchedTableHeading: 'Suppliers with PO history',
      unmatchedTableHeading: 'Suppliers with no PO history — self-mapping required',
      unmatchedExplain:
        'These suppliers are in your vendor master but have no purchase orders inside the selected period. They are not categorised automatically; they will be invited to map their own categories.',
      unmatchedPoHeading: 'PO spend for suppliers not in your vendor master',
      unmatchedPoExplain:
        'These vendors appear in your PO dump but not in your vendor master. Usually this means the vendor master is incomplete.',
      columnVendor: 'Vendor',
      columnPoCount: 'PO Count',
      columnSpend: 'Total Spend',
      columnItems: 'Purchased Items',
    },

    ai: {
      heading: 'Step 4 — AI category join & buyer review',
      hint: 'Suppliers are categorised from their PO line items, purchase frequency and spend — never from the company name alone.',
      startAction: 'Start AI Categorisation',
      resumeAction: 'Resume AI Categorisation',
      progressTemplate: 'Processing {processed} / {total} vendors',
      completedTemplate: 'Categorised {processed} of {total} vendors',
      runningLabel: 'Categorising…',
      idleLabel: 'Not started',
      completedLabel: 'Complete',
      failedLabel: 'Failed',
      categoryMasterEmptyTitle: 'Your category master is empty',
      reRunAction: 'Re-run AI',
      reRunning: 'Re-running…',
      approveAction: 'Approve',
      editAction: 'Edit Category',
      rejectAction: 'Reject',
      saveEditAction: 'Save Category',
      cancelEditAction: 'Cancel',
      aiSuggestedLabel: 'AI suggested',
      buyerFinalLabel: 'Your approved category',
      reasonLabel: 'Why',
      confidenceLabel: 'Confidence',
      confidenceHigh: 'High confidence',
      confidenceMedium: 'Review recommended',
      confidenceNeedsReview: 'Needs buyer review',
      confidenceUnstated: 'No confidence score returned',
      newCategoryBadge: 'New category suggestion',
      newCategoryExplain:
        'The categoriser could not place this supplier in your category master. Choose a category yourself — nothing is created automatically.',
      noPoHistoryBadge: 'No PO history',
      failedBadge: 'Categorisation failed',
      reviewedByTemplate: 'Reviewed by {email} on {date}',
      majorCategoryLabel: 'Primary major category',
      minorCategoryLabel: 'Minor categories',
      relevantProductsLabel: 'Relevant products',
      addMinorAction: 'Add',
      removeMinorAction: 'Remove',
      rejectConfirmTitle: 'Reject this suggestion?',
      rejectConfirmBody:
        'The supplier will be moved to self-mapping and asked to select its own categories. The AI suggestion is kept for the audit trail.',
      continueAction: 'Continue to Dispatch',
    },

    filters: {
      searchPlaceholder: 'Search vendor, code, email or category',
      statusAll: 'All',
      statusMapped: 'Mapped',
      statusPendingReview: 'Needs Review',
      statusApproved: 'Approved',
      statusSelfMap: 'Self-Map Required',
      statusFailed: 'Failed',
      confidenceAll: 'Any confidence',
      confidenceHigh: 'High (90-100)',
      confidenceMedium: 'Medium (70-89)',
      confidenceNeedsReview: 'Below 70',
      poHistoryAll: 'Any PO history',
      poHistoryYes: 'Has PO history',
      poHistoryNo: 'No PO history',
      clearAction: 'Clear filters',
      resultsTemplate: 'Showing {from}-{to} of {total}',
      previousPage: 'Previous',
      nextPage: 'Next',
      noResults: 'No suppliers match these filters.',
    },

    segmentation: {
      heading: 'Vendors by category',
      selfMapHeading: 'Self Mapping Required',
      vendorCountTemplate: '{count} vendors',
      empty: 'No categories assigned yet.',
    },

    dispatch: {
      heading: 'Step 5 — Dispatch emails',
      hint: 'Select who to email, preview the recipient list, then confirm. Nobody is ever sent the same email twice.',
      templateLabel: 'Email template',
      templateCategoryMapped: 'Category mapping confirmation',
      templateCategoryMappedHint: 'For suppliers whose categories you have approved.',
      templateSelfMap: 'Self-mapping invitation',
      templateSelfMapHint: 'For suppliers with no PO history, asking them to map their own categories.',
      templateOnboarding: 'General onboarding notice',
      templateOnboardingHint: 'A plain notice that makes no claim about categories.',
      categoryFilterLabel: 'Limit to category',
      categoryFilterAll: 'All approved categories',
      previewAction: 'Preview Recipients',
      sendAction: 'Dispatch Emails',
      sendingLabel: 'Dispatching…',
      recipientsHeading: 'Recipients',
      recipientCountTemplate: '{count} vendors',
      alreadySentHeading: 'Already received this email — will be skipped',
      nothingToSend: 'There is nobody to email with this template yet.',
      confirmTitle: 'Dispatch to {count} vendors?',
      confirmBody: 'Each recipient receives this email once. Already-notified suppliers are skipped automatically.',
      confirmAction: 'Send',
      cancelAction: 'Cancel',
      statusHeading: 'Email status',
      statusTotal: 'Total',
      statusSent: 'Sent',
      statusFailed: 'Failed',
      statusPending: 'Pending',
      retryAction: 'Retry Failed',
      retryingLabel: 'Retrying…',
      retryHint: 'Only failures are retried. A successfully sent email is never sent again.',
      logHeading: 'Dispatch log',
      logEmpty: 'No emails dispatched for this session yet.',
      columnRecipient: 'Recipient',
      columnTemplate: 'Template',
      columnStatus: 'Status',
      columnDetail: 'Detail',
      columnSentAt: 'Sent',
    },

    audit: {
      heading: 'Audit trail',
      hint: 'Every action in this module is recorded with who did it and what changed.',
      empty: 'No audit entries yet.',
      columnWhen: 'When',
      columnWho: 'Who',
      columnAction: 'Action',
      columnEntity: 'Entity',
      columnChange: 'Change',
      viewAiLogsAction: 'AI classification log',
      aiLogsHeading: 'AI classification attempts',
      aiLogsEmpty: 'No AI classification attempts recorded yet.',
      aiLogsHint: 'Includes failed attempts, so an unusable model reply is visible rather than silent.',
    },

    validation: {
      summaryHeading: 'Validation summary',
      totalRowsLabel: 'Total Rows',
      validRowsLabel: 'Valid Rows',
      invalidRowsLabel: 'Invalid Rows',
      duplicateRowsLabel: 'Duplicate Rows',
      errorListHeading: 'Rejected rows',
      errorRowTemplate: 'Row {row}',
      downloadErrorsAction: 'Download Error Report',
      allValid: 'Every row passed validation.',
      unsupportedFileTitle: 'Unsupported file type',
      unsupportedFileTemplate: '"{name}" is not a supported spreadsheet. Accepted: {accepted}.',
      fileTooLargeTitle: 'File too large',
      fileTooLargeTemplate: '"{name}" is {size}MB. The limit is {limit}MB.',
      missingColumnsTitle: 'Missing required columns',
      missingColumnsTemplate: 'Could not find: {columns}. Check the file matches the template.',
      noRowsTitle: 'No readable rows',
      noRowsBody: 'The file has no data rows below its header.',
      blankRowsTemplate: '{count} blank row(s) were skipped.',
    },

    errors: {
      loadFailed: 'Could not load the ingestion session.',
      saveFailed: 'Could not save. Please try again.',
      uploadFailed: 'The upload could not be stored.',
      joinFailed: 'Could not match PO data to your vendor master.',
      aiFailed: 'AI categorisation could not be completed.',
      reviewFailed: 'Could not save your category decision.',
      dispatchFailed: 'The email dispatch could not be completed.',
      retryFailed: 'Could not retry the failed emails.',
    },

    toasts: {
      sessionStartedTitle: 'Ingestion started',
      sessionStartedTemplate: 'Analysing purchase orders from {start} to {end}.',
      horizonSavedTitle: 'Period updated',
      vendorMasterStoredTitle: 'Vendor Master stored',
      vendorMasterStoredTemplate: '{stored} vendors stored, {rejected} rows rejected.',
      poStoredTitle: 'PO Dump stored',
      poStoredTemplate: '{inside} of {total} rows fall inside the selected period.',
      joinCompleteTitle: 'Match complete',
      joinCompleteTemplate: '{matched} suppliers have PO history; {unmatched} need self-mapping.',
      aiCompleteTitle: 'AI categorisation complete',
      aiCompleteTemplate: '{mapped} mapped, {review} need review, {failed} failed.',
      approvedTitle: 'Category approved',
      approvedTemplate: '{vendor} is now empanelled under {category}.',
      editedTitle: 'Category updated',
      rejectedTitle: 'Suggestion rejected',
      rejectedTemplate: '{vendor} moved to self-mapping.',
      reRunTitle: 'AI re-run complete',
      dispatchedTitle: 'Emails dispatched',
      dispatchedTemplate: '{sent} sent, {failed} failed, {skipped} skipped as already sent.',
      retriedTitle: 'Retry complete',
      retriedTemplate: '{sent} of {attempted} failed emails were sent.',
      templateDownloadedTitle: 'Template downloaded',
    },
  },
};

/**
 * Format string template with runtime parameter placeholders
 * Example: formatString('Hello {name}, you have {count} messages', { name: 'Alex', count: 3 })
 */
export function formatString(template: string, values?: Record<string, string | number>): string {
  if (!template) return '';
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    return values[key] !== undefined ? String(values[key]) : match;
  });
}
