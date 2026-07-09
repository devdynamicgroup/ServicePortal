const { getAccessToken, isOAuthConfigured, hasRefreshToken } = require('./googleBusinessAuth');

const ACCOUNT_API = 'https://mybusinessaccountmanagement.googleapis.com/v1';
const BUSINESS_API = 'https://mybusiness.googleapis.com/v4';

const syncState = {
  lastSyncAt: null,
  lastError: null,
  lastInserted: 0,
  lastSkipped: 0,
  lastReviewCount: 0
};

function log(step, message, extra) {
  const suffix = extra ? ` ${JSON.stringify(extra)}` : '';
  console.log(`[google-business] ${step}: ${message}${suffix}`);
}

function getAccountId() {
  return process.env.GOOGLE_BUSINESS_ACCOUNT_ID || '';
}

function getLocationId() {
  return process.env.GOOGLE_BUSINESS_LOCATION_ID || '';
}

function isBusinessProfileConfigured() {
  return Boolean(
    isOAuthConfigured()
    && hasRefreshToken()
    && getAccountId()
    && getLocationId()
    && process.env.NOTION_FEEDBACK_DATABASE_ID
  );
}

async function businessFetch(url, options = {}) {
  const accessToken = await getAccessToken();
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }

  if (!response.ok) {
    const message = data.error?.message || data.error || `Google Business Profile request failed (${response.status})`;
    const errorInfo = (data.error?.details || []).find(item => item['@type']?.includes('ErrorInfo'));
    log('api-error', message, {
      status: response.status,
      url: String(url).replace(/access_token=[^&]+/i, 'access_token=[redacted]'),
      reason: errorInfo?.reason || null,
      quotaLimit: errorInfo?.metadata?.quota_limit || null,
      quotaLimitValue: errorInfo?.metadata?.quota_limit_value || null
    });
    const error = new Error(message);
    error.statusCode = response.status;
    error.details = data.error || data;
    throw error;
  }

  return data;
}

function parseAccountId(name) {
  if (!name) return '';
  const match = String(name).match(/accounts\/([^/]+)/);
  return match ? match[1] : String(name);
}

function parseLocationId(name) {
  if (!name) return '';
  const match = String(name).match(/locations\/([^/]+)/);
  return match ? match[1] : String(name);
}

function formatAddress(address) {
  if (!address) return '';
  if (typeof address === 'string') return address;
  const parts = [
    ...(address.addressLines || []),
    address.locality,
    address.administrativeArea,
    address.postalCode,
    address.regionCode
  ].filter(Boolean);
  return parts.join(', ');
}

function transformReview(review) {
  return {
    reviewId: review.reviewId || parseReviewId(review.name),
    reviewerName: review.reviewer?.displayName || 'Google reviewer',
    starRating: review.starRating || null,
    comment: review.comment || '',
    createTime: review.createTime || null,
    updateTime: review.updateTime || null,
    reviewerPhotoUrl: review.reviewer?.profilePhotoUrl || null,
    reviewerProfileUrl: review.reviewer?.profileUrl || null
  };
}

function parseReviewId(name) {
  if (!name) return '';
  const match = String(name).match(/reviews\/([^/]+)/);
  return match ? match[1] : String(name);
}

function starRatingToNumber(value) {
  if (typeof value === 'number') return value;
  const map = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
  return map[value] || Number(value) || 0;
}

async function probeApiEnablement() {
  if (!isOAuthConfigured() || !hasRefreshToken()) {
    return {
      checked: false,
      apiEnabled: null,
      error: 'Cannot probe API enablement without OAuth credentials and GOOGLE_BUSINESS_REFRESH_TOKEN',
      setupSteps: [
        'Apply for Google Business Profile API access: https://developers.google.com/my-business/content/prereqs',
        'In Google Cloud Console → APIs & Services → Library, enable:',
        '  - Google My Business API',
        '  - My Business Account Management API',
        '  - My Business Business Information API (for locations)',
        'Create OAuth 2.0 Client ID (Web application) with redirect URI',
        'Set GOOGLE_BUSINESS_CLIENT_ID, GOOGLE_BUSINESS_CLIENT_SECRET, GOOGLE_BUSINESS_REDIRECT_URI',
        'Complete OAuth flow and set GOOGLE_BUSINESS_REFRESH_TOKEN'
      ]
    };
  }

  try {
    const data = await businessFetch(`${ACCOUNT_API}/accounts`);
    log('api-probe', 'accounts request succeeded');
    return {
      checked: true,
      apiEnabled: true,
      accountCount: (data.accounts || []).length,
      error: null
    };
  } catch (error) {
    const message = error.message || 'Unknown error';
    const disabled = /has not been used|is disabled|SERVICE_DISABLED|accessNotConfigured/i.test(message);
    log('api-probe', 'accounts request failed', { message, status: error.statusCode });
    return {
      checked: true,
      apiEnabled: disabled ? false : null,
      error: message,
      details: error.details || null,
      setupSteps: disabled ? [
        'Open Google Cloud Console → APIs & Services → Library',
        'Search and enable "Google My Business API"',
        'Search and enable "My Business Account Management API"',
        'Ensure billing is active on the project',
        'Ensure your project has approved Business Profile API access from Google'
      ] : undefined
    };
  }
}

async function listAccounts() {
  const data = await businessFetch(`${ACCOUNT_API}/accounts`);
  const accounts = (data.accounts || []).map(account => {
    const accountId = parseAccountId(account.name);
    const role = account.role || account.permissionLevel || account.type || null;
    log('account', 'found', { accountId, accountName: account.accountName, role });
    return {
      accountId,
      accountName: account.accountName || account.name || accountId,
      role,
      name: account.name || `accounts/${accountId}`,
      type: account.type || null
    };
  });
  log('accounts', 'loaded', { count: accounts.length });
  return accounts;
}

async function listLocations(accountId = getAccountId()) {
  if (!accountId) {
    const error = new Error('GOOGLE_BUSINESS_ACCOUNT_ID is required');
    error.statusCode = 400;
    throw error;
  }

  const url = new URL(`${BUSINESS_API}/accounts/${accountId}/locations`);
  url.searchParams.set('pageSize', process.env.GOOGLE_BUSINESS_LOCATIONS_PAGE_SIZE || '100');
  const data = await businessFetch(url);

  const locations = (data.locations || []).map(location => {
    const locationId = parseLocationId(location.name);
    const storeName = location.locationName || location.title || location.storefrontAddress?.addressLines?.[0] || locationId;
    const address = formatAddress(location.address || location.storefrontAddress);
    log('location', 'found', { locationId, storeName, address });
    return {
      locationId,
      storeName,
      address,
      name: location.name || `accounts/${accountId}/locations/${locationId}`,
      placeId: location.metadata?.placeId || location.locationKey?.placeId || null
    };
  });

  log('locations', 'loaded', { accountId, count: locations.length });
  return locations;
}

async function listReviews(options = {}) {
  const accountId = options.accountId || getAccountId();
  const locationId = options.locationId || getLocationId();
  if (!accountId || !locationId) {
    const error = new Error('GOOGLE_BUSINESS_ACCOUNT_ID and GOOGLE_BUSINESS_LOCATION_ID are required');
    error.statusCode = 400;
    throw error;
  }

  const pageSize = String(options.pageSize || process.env.GOOGLE_REVIEWS_PAGE_SIZE || '50');
  const orderBy = options.orderBy || 'updateTime desc';
  const allReviews = [];
  let pageToken = options.pageToken || '';

  do {
    const url = new URL(`${BUSINESS_API}/accounts/${accountId}/locations/${locationId}/reviews`);
    url.searchParams.set('pageSize', pageSize);
    url.searchParams.set('orderBy', orderBy);
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const data = await businessFetch(url);
    const batch = (data.reviews || []).map(transformReview);
    allReviews.push(...batch);
    pageToken = data.nextPageToken || '';
    log('reviews', 'page loaded', { count: batch.length, hasNextPage: Boolean(pageToken) });
  } while (pageToken && options.fetchAll !== false);

  log('reviews', 'loaded', { accountId, locationId, count: allReviews.length });
  return {
    accountId,
    locationId,
    total: allReviews.length,
    reviews: allReviews
  };
}

function recordSyncResult(result) {
  syncState.lastSyncAt = new Date().toISOString();
  syncState.lastInserted = result.created || 0;
  syncState.lastSkipped = result.skipped || 0;
  syncState.lastReviewCount = result.total || 0;
  syncState.lastError = null;
}

function recordSyncError(error) {
  syncState.lastSyncAt = new Date().toISOString();
  syncState.lastError = error.message || String(error);
}

function getSyncState() {
  return { ...syncState };
}

async function getBusinessDebugStatus() {
  const oauthConfigured = isOAuthConfigured();
  const refreshTokenSet = hasRefreshToken();
  let googleConnected = false;
  let account = null;
  let location = null;
  let reviewCount = 0;
  let lastError = syncState.lastError;
  let apiProbe = null;

  try {
    apiProbe = await probeApiEnablement();
    if (apiProbe.checked && apiProbe.apiEnabled === false) {
      lastError = apiProbe.error;
    }
  } catch (error) {
    apiProbe = { checked: true, apiEnabled: null, error: error.message };
    lastError = error.message;
  }

  if (oauthConfigured && refreshTokenSet) {
    try {
      googleConnected = true;
      const accounts = await listAccounts();
      const accountId = getAccountId();
      account = accounts.find(item => item.accountId === accountId) || accounts[0] || null;

      if (accountId) {
        const locations = await listLocations(accountId);
        const locationId = getLocationId();
        location = locations.find(item => item.locationId === locationId) || locations[0] || null;
      }

      if (getAccountId() && getLocationId()) {
        const reviewsResult = await listReviews({ fetchAll: true });
        reviewCount = reviewsResult.total;
      }
    } catch (error) {
      googleConnected = false;
      lastError = error.message;
      log('debug', 'status failed', { error: error.message });
    }
  }

  return {
    googleConnected,
    oauthConfigured,
    refreshTokenSet,
    accountConfigured: Boolean(getAccountId()),
    locationConfigured: Boolean(getLocationId()),
    account,
    location,
    reviewCount,
    lastSync: syncState.lastSyncAt,
    lastInserted: syncState.lastInserted,
    lastSkipped: syncState.lastSkipped,
    lastError,
    apiProbe
  };
}

module.exports = {
  probeApiEnablement,
  listAccounts,
  listLocations,
  listReviews,
  transformReview,
  starRatingToNumber,
  getBusinessDebugStatus,
  getSyncState,
  recordSyncResult,
  recordSyncError,
  isBusinessProfileConfigured,
  getAccountId,
  getLocationId
};
