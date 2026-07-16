/**
 * Customer / category / subCategory folder hierarchy under the Drive roots.
 *
 * GOOGLE_DRIVE_MAIN_FOLDER_ID
 * └── Customer Name [notionShortId]
 *     ├── Site Inspection
 *     │   ├── Tap
 *     │   ├── Visual
 *     │   ├── Meter
 *     │   └── Chlorine
 *     ├── Before Service
 *     ├── After Service
 *     ├── Documents
 *     │   └── JSON
 *     └── Payment
 *         └── Slip
 *
 * Auth uses the existing OAuth client (not a Service Account).
 */

const { getDriveClient } = require('./google-drive-oauth');

const FOLDER_MIME = 'application/vnd.google-apps.folder';

const CATEGORY = {
  SITE_INSPECTION: 'Site Inspection',
  BEFORE_SERVICE: 'Before Service',
  AFTER_SERVICE: 'After Service',
  DOCUMENTS: 'Documents',
  PAYMENT: 'Payment'
};

const SUB_CATEGORY = {
  TAP: 'Tap',
  VISUAL: 'Visual',
  METER: 'Meter',
  CHLORINE: 'Chlorine',
  PRESSURE: 'Pressure',
  INFRA: 'Infra',
  PHOTO: 'Photo',
  BEFORE: 'Before',
  AFTER: 'After',
  JSON: 'JSON',
  REPORT: 'Report',
  SLIP: 'Slip',
  RECEIPT: 'Receipt',
  GENERAL: 'General'
};

const PURPOSE_TO_CATEGORY = {
  tapphoto: CATEGORY.SITE_INSPECTION,
  tap: CATEGORY.SITE_INSPECTION,
  'tap-photo': CATEGORY.SITE_INSPECTION,
  visual: CATEGORY.SITE_INSPECTION,
  meter: CATEGORY.SITE_INSPECTION,
  chlorine: CATEGORY.SITE_INSPECTION,
  pressure: CATEGORY.SITE_INSPECTION,
  infra: CATEGORY.SITE_INSPECTION,
  ocr: CATEGORY.SITE_INSPECTION,
  photo: CATEGORY.SITE_INSPECTION,
  gallery: CATEGORY.SITE_INSPECTION,
  image: CATEGORY.SITE_INSPECTION,
  reading: CATEGORY.SITE_INSPECTION,
  'reading-source': CATEGORY.SITE_INSPECTION,
  'meter-raw': CATEGORY.SITE_INSPECTION,
  'chlorine-raw': CATEGORY.SITE_INSPECTION,
  before: CATEGORY.BEFORE_SERVICE,
  'before-service': CATEGORY.BEFORE_SERVICE,
  before_service: CATEGORY.BEFORE_SERVICE,
  after: CATEGORY.AFTER_SERVICE,
  'after-service': CATEGORY.AFTER_SERVICE,
  after_service: CATEGORY.AFTER_SERVICE,
  document: CATEGORY.DOCUMENTS,
  documents: CATEGORY.DOCUMENTS,
  assessment: CATEGORY.DOCUMENTS,
  export: CATEGORY.DOCUMENTS,
  backup: CATEGORY.DOCUMENTS,
  metadata: CATEGORY.DOCUMENTS,
  report: CATEGORY.DOCUMENTS,
  reports: CATEGORY.DOCUMENTS,
  json: CATEGORY.DOCUMENTS,
  data: CATEGORY.DOCUMENTS,
  payment: CATEGORY.PAYMENT,
  slip: CATEGORY.PAYMENT,
  receipt: CATEGORY.PAYMENT,
  'payment-slip': CATEGORY.PAYMENT,
  payment_slip: CATEGORY.PAYMENT
};

const PURPOSE_TO_SUB_CATEGORY = {
  tapphoto: SUB_CATEGORY.TAP,
  tap: SUB_CATEGORY.TAP,
  'tap-photo': SUB_CATEGORY.TAP,
  visual: SUB_CATEGORY.VISUAL,
  meter: SUB_CATEGORY.METER,
  'meter-raw': SUB_CATEGORY.METER,
  reading: SUB_CATEGORY.METER,
  'reading-source': SUB_CATEGORY.METER,
  chlorine: SUB_CATEGORY.CHLORINE,
  'chlorine-raw': SUB_CATEGORY.CHLORINE,
  pressure: SUB_CATEGORY.PRESSURE,
  infra: SUB_CATEGORY.INFRA,
  ocr: SUB_CATEGORY.PHOTO,
  photo: SUB_CATEGORY.PHOTO,
  gallery: SUB_CATEGORY.PHOTO,
  image: SUB_CATEGORY.PHOTO,
  before: SUB_CATEGORY.BEFORE,
  'before-service': SUB_CATEGORY.BEFORE,
  before_service: SUB_CATEGORY.BEFORE,
  after: SUB_CATEGORY.AFTER,
  'after-service': SUB_CATEGORY.AFTER,
  after_service: SUB_CATEGORY.AFTER,
  document: SUB_CATEGORY.JSON,
  documents: SUB_CATEGORY.JSON,
  assessment: SUB_CATEGORY.JSON,
  export: SUB_CATEGORY.JSON,
  backup: SUB_CATEGORY.JSON,
  metadata: SUB_CATEGORY.JSON,
  json: SUB_CATEGORY.JSON,
  data: SUB_CATEGORY.JSON,
  report: SUB_CATEGORY.REPORT,
  reports: SUB_CATEGORY.REPORT,
  payment: SUB_CATEGORY.SLIP,
  slip: SUB_CATEGORY.SLIP,
  'payment-slip': SUB_CATEGORY.SLIP,
  payment_slip: SUB_CATEGORY.SLIP,
  receipt: SUB_CATEGORY.RECEIPT
};

function driveFolderError(message, statusCode = 500, details) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (details) error.details = details;
  return error;
}

function escapeDriveQuery(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function sanitizeFolderLabel(name) {
  return String(name || 'Customer')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'Customer';
}

function expandNotionId(id) {
  const raw = String(id || '').trim();
  if (!raw) return '';
  const compact = raw.replace(/-/g, '');
  if (!/^[a-f0-9]{32}$/i.test(compact)) return raw;
  return [
    compact.slice(0, 8),
    compact.slice(8, 12),
    compact.slice(12, 16),
    compact.slice(16, 20),
    compact.slice(20)
  ].join('-');
}

function shortNotionId(id) {
  const compact = String(id || '').replace(/-/g, '');
  return compact.slice(0, 8) || 'unknown';
}

function buildCustomerFolderName(customerName, notionId) {
  const label = sanitizeFolderLabel(customerName || 'Customer');
  return `${label} [${shortNotionId(notionId)}]`;
}

function resolveCategoryFromPurpose(purpose, options = {}) {
  if (options.category) {
    const raw = String(options.category).trim();
    if (/^(payment|slip|receipt)$/i.test(raw)) return CATEGORY.PAYMENT;
    if (/site\s*inspection/i.test(raw)) return CATEGORY.SITE_INSPECTION;
    if (/before/i.test(raw)) return CATEGORY.BEFORE_SERVICE;
    if (/after/i.test(raw)) return CATEGORY.AFTER_SERVICE;
    if (/document/i.test(raw)) return CATEGORY.DOCUMENTS;
    const known = Object.values(CATEGORY).find(name => name.toLowerCase() === raw.toLowerCase());
    if (known) return known;
  }

  const key = String(purpose || options.useCase || options.type || '').trim().toLowerCase();
  if (PURPOSE_TO_CATEGORY[key]) return PURPOSE_TO_CATEGORY[key];

  const mime = String(options.contentType || options.mimeType || '').toLowerCase().split(';')[0].trim();
  if (mime === 'application/json' || mime === 'text/json' || mime.endsWith('+json')) {
    return CATEGORY.DOCUMENTS;
  }
  if (/\.jsonl?$/i.test(String(options.filename || ''))) return CATEGORY.DOCUMENTS;
  if (mime.startsWith('image/')) return CATEGORY.SITE_INSPECTION;
  return CATEGORY.DOCUMENTS;
}

function sanitizeSubCategoryName(name) {
  return sanitizeFolderLabel(name).replace(/^\.+/, '') || SUB_CATEGORY.GENERAL;
}

function resolveSubCategoryFromPurpose(purpose, options = {}) {
  if (options.subCategory || options.uploadType) {
    const raw = String(options.subCategory || options.uploadType).trim();
    if (raw) {
      const known = Object.values(SUB_CATEGORY).find(name => name.toLowerCase() === raw.toLowerCase());
      return known || sanitizeSubCategoryName(raw);
    }
  }

  const key = String(purpose || options.useCase || options.type || '').trim().toLowerCase();
  if (PURPOSE_TO_SUB_CATEGORY[key]) return PURPOSE_TO_SUB_CATEGORY[key];

  const mime = String(options.contentType || options.mimeType || '').toLowerCase().split(';')[0].trim();
  if (mime === 'application/json' || mime === 'text/json' || mime.endsWith('+json')) {
    return SUB_CATEGORY.JSON;
  }
  if (/\.jsonl?$/i.test(String(options.filename || ''))) return SUB_CATEGORY.JSON;
  if (mime.startsWith('image/')) return SUB_CATEGORY.PHOTO;
  return SUB_CATEGORY.GENERAL;
}

const DRIVE_FILE_OPTS = {
  supportsAllDrives: true,
  includeItemsFromAllDrives: true
};

async function getFolderMeta(folderId) {
  const drive = getDriveClient();
  const response = await drive.files.get({
    fileId: folderId,
    fields: 'id,name,mimeType,parents,webViewLink,appProperties,trashed',
    supportsAllDrives: true
  });
  return response.data;
}

async function findChildFolderByAppProperty(parentId, propKey, propValue) {
  const drive = getDriveClient();
  const q = [
    `'${escapeDriveQuery(parentId)}' in parents`,
    `mimeType = '${FOLDER_MIME}'`,
    'trashed = false',
    `appProperties has { key='${escapeDriveQuery(propKey)}' and value='${escapeDriveQuery(propValue)}' }`
  ].join(' and ');

  const response = await drive.files.list({
    q,
    spaces: 'drive',
    corpora: 'allDrives',
    pageSize: 5,
    fields: 'files(id,name,webViewLink,appProperties,parents)',
    ...DRIVE_FILE_OPTS
  });
  return (response.data.files || [])[0] || null;
}

async function findChildFolderByName(parentId, name) {
  const drive = getDriveClient();
  const q = [
    `'${escapeDriveQuery(parentId)}' in parents`,
    `mimeType = '${FOLDER_MIME}'`,
    'trashed = false',
    `name = '${escapeDriveQuery(name)}'`
  ].join(' and ');

  const response = await drive.files.list({
    q,
    spaces: 'drive',
    corpora: 'allDrives',
    pageSize: 5,
    fields: 'files(id,name,webViewLink,appProperties,parents)',
    ...DRIVE_FILE_OPTS
  });
  return (response.data.files || [])[0] || null;
}

async function createFolder({ parentId, name, appProperties = {} }) {
  const drive = getDriveClient();
  console.log('[drive-folders] creating folder', {
    parentId,
    name,
    appPropertyKeys: Object.keys(appProperties || {})
  });

  const requestBody = {
    name,
    mimeType: FOLDER_MIME,
    parents: [parentId]
  };
  if (appProperties && Object.keys(appProperties).length) {
    requestBody.appProperties = appProperties;
  }

  try {
    const response = await drive.files.create({
      requestBody,
      fields: 'id,name,webViewLink,appProperties,parents',
      supportsAllDrives: true
    });
    console.log('[drive-folders] folder created', {
      folderId: response.data.id,
      name: response.data.name
    });
    return response.data;
  } catch (error) {
    // Some Drive configs reject appProperties — retry without them.
    if (requestBody.appProperties) {
      console.warn('[drive-folders] create with appProperties failed, retrying without', {
        message: error.message
      });
      delete requestBody.appProperties;
      const response = await drive.files.create({
        requestBody,
        fields: 'id,name,webViewLink,appProperties,parents',
        supportsAllDrives: true
      });
      console.log('[drive-folders] folder created (no appProperties)', {
        folderId: response.data.id,
        name: response.data.name
      });
      return response.data;
    }
    throw error;
  }
}

/**
 * Ensure the customer folder exists under the configured MAIN root.
 * Prefer cached Notion folder ID, then name search, else create.
 * Search failures must NOT block folder creation.
 */
async function ensureCustomerFolder({
  rootFolderId,
  notionId,
  customerName,
  cachedFolderId
} = {}) {
  if (!rootFolderId) {
    throw driveFolderError('GOOGLE_DRIVE_MAIN_FOLDER_ID is required for customer folders', 503);
  }
  const customerKey = expandNotionId(notionId) || String(notionId || '').trim();
  if (!customerKey) {
    throw driveFolderError('notionId is required to create a customer Drive folder', 400);
  }

  const folderName = buildCustomerFolderName(customerName, customerKey);

  if (cachedFolderId) {
    try {
      const cached = await getFolderMeta(cachedFolderId);
      if (cached && !cached.trashed && cached.mimeType === FOLDER_MIME) {
        console.log('[drive-folders] reusing cached customer folder', {
          folderId: cached.id,
          notionId: shortNotionId(customerKey)
        });
        return {
          folderId: cached.id,
          name: cached.name,
          webViewLink: cached.webViewLink || null,
          created: false,
          reusedCache: true
        };
      }
    } catch (error) {
      console.warn('[drive-folders] cached customer folder invalid, searching', {
        cachedFolderId,
        message: error.message
      });
    }
  }

  // Soft search — never abort creation because listing failed.
  let existing = null;
  try {
    existing = await findChildFolderByAppProperty(rootFolderId, 'wmCustomerId', customerKey);
    if (!existing) {
      const compact = customerKey.replace(/-/g, '');
      if (compact !== customerKey) {
        existing = await findChildFolderByAppProperty(rootFolderId, 'wmCustomerId', compact);
      }
    }
  } catch (error) {
    console.warn('[drive-folders] appProperty search failed', { message: error.message });
  }
  if (!existing) {
    try {
      existing = await findChildFolderByName(rootFolderId, folderName);
    } catch (error) {
      console.warn('[drive-folders] name search failed', { message: error.message, folderName });
    }
  }
  if (existing) {
    console.log('[drive-folders] reusing existing customer folder', {
      folderId: existing.id,
      name: existing.name
    });
    return {
      folderId: existing.id,
      name: existing.name,
      webViewLink: existing.webViewLink || null,
      created: false,
      reusedCache: false
    };
  }

  try {
    const created = await createFolder({
      parentId: rootFolderId,
      name: folderName,
      appProperties: {
        wmCustomerId: customerKey,
        wmType: 'customer'
      }
    });
    return {
      folderId: created.id,
      name: created.name,
      webViewLink: created.webViewLink || null,
      created: true,
      reusedCache: false
    };
  } catch (error) {
    console.error('[drive-folders] ensureCustomerFolder failed', {
      message: error.message,
      status: error.code || error.statusCode || null,
      folderName,
      parentId: rootFolderId
    });
    throw driveFolderError(
      `Unable to ensure customer Drive folder (${error.message || 'unknown'})`,
      error.statusCode || error.code || 502,
      error.errors || error.response?.data
    );
  }
}

/**
 * Ensure a category subfolder under the customer folder.
 * Payment folders are only created when category === Payment (caller must gate).
 */
async function ensureCategoryFolder({
  customerFolderId,
  category,
  createIfMissing = true
} = {}) {
  if (!customerFolderId) {
    throw driveFolderError('customerFolderId is required', 400);
  }
  const categoryName = String(category || '').trim();
  if (!categoryName) {
    throw driveFolderError('category is required', 400);
  }

  let existing = null;
  try {
    existing = await findChildFolderByAppProperty(customerFolderId, 'wmCategory', categoryName);
  } catch (error) {
    console.warn('[drive-folders] category appProperty search failed', { message: error.message });
  }
  if (!existing) {
    try {
      existing = await findChildFolderByName(customerFolderId, categoryName);
    } catch (error) {
      console.warn('[drive-folders] category name search failed', { message: error.message });
    }
  }
  if (existing) {
    console.log('[drive-folders] reusing category folder', {
      folderId: existing.id,
      category: categoryName
    });
    return {
      folderId: existing.id,
      name: existing.name || categoryName,
      webViewLink: existing.webViewLink || null,
      created: false
    };
  }

  if (!createIfMissing) {
    return null;
  }

  try {
    const created = await createFolder({
      parentId: customerFolderId,
      name: categoryName,
      appProperties: {
        wmCategory: categoryName,
        wmType: 'category'
      }
    });
    return {
      folderId: created.id,
      name: created.name,
      webViewLink: created.webViewLink || null,
      created: true
    };
  } catch (error) {
    console.error('[drive-folders] ensureCategoryFolder failed', {
      category: categoryName,
      message: error.message
    });
    throw driveFolderError(
      `Unable to ensure category folder "${categoryName}" (${error.message || 'unknown'})`,
      error.statusCode || error.code || 502,
      error.errors || error.response?.data
    );
  }
}

/**
 * Ensure a subCategory folder under the category folder
 * (e.g. Site Inspection / Tap).
 */
async function ensureSubCategoryFolder({
  categoryFolderId,
  subCategory,
  createIfMissing = true
} = {}) {
  if (!categoryFolderId) {
    throw driveFolderError('categoryFolderId is required', 400);
  }
  const subCategoryName = sanitizeSubCategoryName(subCategory);
  if (!subCategoryName) {
    throw driveFolderError('subCategory is required', 400);
  }

  let existing = null;
  try {
    existing = await findChildFolderByAppProperty(categoryFolderId, 'wmSubCategory', subCategoryName);
  } catch (error) {
    console.warn('[drive-folders] subCategory appProperty search failed', { message: error.message });
  }
  if (!existing) {
    try {
      existing = await findChildFolderByName(categoryFolderId, subCategoryName);
    } catch (error) {
      console.warn('[drive-folders] subCategory name search failed', { message: error.message });
    }
  }
  if (existing) {
    console.log('[drive-folders] reusing subCategory folder', {
      folderId: existing.id,
      subCategory: subCategoryName
    });
    return {
      folderId: existing.id,
      name: existing.name || subCategoryName,
      webViewLink: existing.webViewLink || null,
      created: false
    };
  }

  if (!createIfMissing) {
    return null;
  }

  try {
    const created = await createFolder({
      parentId: categoryFolderId,
      name: subCategoryName,
      appProperties: {
        wmSubCategory: subCategoryName,
        wmType: 'subCategory'
      }
    });
    return {
      folderId: created.id,
      name: created.name,
      webViewLink: created.webViewLink || null,
      created: true
    };
  } catch (error) {
    console.error('[drive-folders] ensureSubCategoryFolder failed', {
      subCategory: subCategoryName,
      message: error.message
    });
    throw driveFolderError(
      `Unable to ensure subCategory folder "${subCategoryName}" (${error.message || 'unknown'})`,
      error.statusCode || error.code || 502,
      error.errors || error.response?.data
    );
  }
}

/**
 * Resolve the upload parent folder for a customer + purpose.
 * Path: Customer → Category → SubCategory → file
 * Payment category is created only for payment purposes.
 */
async function resolveUploadTargetFolder({
  rootFolderId,
  notionId,
  customerName,
  cachedCustomerFolderId,
  purpose,
  category: explicitCategory,
  subCategory: explicitSubCategory,
  uploadType,
  contentType,
  filename
} = {}) {
  const category = resolveCategoryFromPurpose(purpose, {
    category: explicitCategory,
    contentType,
    filename
  });
  const subCategory = resolveSubCategoryFromPurpose(purpose, {
    subCategory: explicitSubCategory,
    uploadType,
    contentType,
    filename
  });

  const customer = await ensureCustomerFolder({
    rootFolderId,
    notionId,
    customerName,
    cachedFolderId: cachedCustomerFolderId
  });

  // Payment is intentionally lazy — only created when category resolves to Payment.
  const categoryFolder = await ensureCategoryFolder({
    customerFolderId: customer.folderId,
    category,
    createIfMissing: true
  });

  const subCategoryFolder = await ensureSubCategoryFolder({
    categoryFolderId: categoryFolder.folderId,
    subCategory,
    createIfMissing: true
  });

  return {
    category,
    subCategory,
    customerFolderId: customer.folderId,
    customerFolderName: customer.name,
    customerFolderUrl: customer.webViewLink,
    customerFolderCreated: customer.created,
    categoryFolderId: categoryFolder.folderId,
    categoryFolderName: categoryFolder.name,
    categoryFolderUrl: categoryFolder.webViewLink,
    categoryFolderCreated: categoryFolder.created,
    subCategoryFolderId: subCategoryFolder.folderId,
    subCategoryFolderName: subCategoryFolder.name,
    subCategoryFolderUrl: subCategoryFolder.webViewLink,
    subCategoryFolderCreated: subCategoryFolder.created,
    uploadFolderId: subCategoryFolder.folderId
  };
}

/**
 * Walk parent chain to confirm a file/folder lives under one of the configured roots.
 */
async function isDescendantOfRoots(fileId, rootIds = []) {
  const roots = new Set((rootIds || []).filter(Boolean));
  if (!roots.size || !fileId) return false;
  if (roots.has(fileId)) return true;

  const drive = getDriveClient();
  let current = fileId;
  const seen = new Set();

  while (current && !seen.has(current)) {
    seen.add(current);
    let meta;
    try {
      const response = await drive.files.get({
        fileId: current,
        fields: 'id,parents',
        supportsAllDrives: true
      });
      meta = response.data;
    } catch {
      return false;
    }
    const parents = Array.isArray(meta.parents) ? meta.parents : [];
    if (parents.some(id => roots.has(id))) return true;
    if (!parents.length) return false;
    current = parents[0];
  }
  return false;
}

module.exports = {
  CATEGORY,
  SUB_CATEGORY,
  PURPOSE_TO_CATEGORY,
  PURPOSE_TO_SUB_CATEGORY,
  expandNotionId,
  shortNotionId,
  buildCustomerFolderName,
  resolveCategoryFromPurpose,
  resolveSubCategoryFromPurpose,
  ensureCustomerFolder,
  ensureCategoryFolder,
  ensureSubCategoryFolder,
  resolveUploadTargetFolder,
  isDescendantOfRoots,
  getFolderMeta
};
