const { isLineConfigured, isLineWebhookConfigured } = require('../services/line-notifications');
const { isNotionConfigured } = require('../services/notion/client');
const { publicBaseUrl } = require('../services/url-builder');
const {
  getCustomerDomainFlags,
  isCustomersDbConfigured
} = require('../services/customer-domain');

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(payload, null, 2));
}

function offerCacheMeta() {
  try {
    const mod = require('../services/water-check-offer-service');
    return {
      moduleLoaded: true,
      getOfferStatusExported: typeof mod.getOfferStatus === 'function',
      ttlMs: 60 * 1000
    };
  } catch {
    return { moduleLoaded: false };
  }
}

function customerDomainMeta() {
  const flags = getCustomerDomainFlags();
  let lineReadMetrics = null;
  let notifyReadMetrics = null;
  try {
    const domain = require('../services/customer-domain');
    lineReadMetrics = domain.lineReadMetrics.getSnapshot(flags);
    notifyReadMetrics = domain.notifyReadMetrics.getSnapshot(flags);
  } catch {
    // optional
  }
  return {
    enabled: flags.enabled,
    dualWrite: flags.dualWrite,
    readLine: flags.readLine,
    readLineShadow: flags.readLineShadow,
    readNotify: flags.readNotify,
    readNotifyShadow: flags.readNotifyShadow,
    databaseConfigured: isCustomersDbConfigured(),
    lineReadMetrics,
    notifyReadMetrics
  };
}

function buildHealthPayload() {
  return {
    ok: true,
    status: 'ok',
    version: process.env.RENDER_GIT_COMMIT || process.env.npm_package_version || 'unknown',
    environment: process.env.NODE_ENV || 'development',
    line: {
      configured: isLineConfigured(),
      webhookConfigured: isLineWebhookConfigured()
    },
    notion: {
      configured: isNotionConfigured()
    },
    customerDomain: customerDomainMeta(),
    retry: {
      enabled: true,
      defaultMaxAttempts: 3
    },
    offerCache: offerCacheMeta(),
    publicBaseUrlHost: (() => {
      try {
        return new URL(publicBaseUrl()).host;
      } catch {
        return null;
      }
    })(),
    ts: new Date().toISOString()
  };
}

function buildReadinessPayload() {
  const notionOk = isNotionConfigured();
  const lineSendOk = isLineConfigured();
  const lineWebhookOk = isLineWebhookConfigured();
  const publicOk = (() => {
    try {
      return /^https:\/\//i.test(publicBaseUrl());
    } catch {
      return false;
    }
  })();

  const customerFlags = getCustomerDomainFlags();
  const customersDbOk = isCustomersDbConfigured();
  // M8.1 defaults: flags OFF → customers check is informational "optional".
  let customersCheck = 'optional';
  if (customerFlags.enabled) {
    customersCheck = customersDbOk ? 'ready' : 'degraded';
  }

  const checks = {
    notion: notionOk ? 'ready' : 'not_ready',
    lineSend: lineSendOk ? 'ready' : 'degraded',
    lineWebhook: lineWebhookOk ? 'ready' : 'degraded',
    publicHttps: publicOk ? 'ready' : 'degraded',
    customers: customersCheck
  };

  let status = 'ready';
  if (!notionOk) status = 'not_ready';
  else if (!lineSendOk || !lineWebhookOk || !publicOk) status = 'degraded';
  else if (customerFlags.enabled && !customersDbOk) status = 'degraded';

  return {
    ok: status !== 'not_ready',
    status,
    checks,
    ts: new Date().toISOString()
  };
}

async function handleOpsRoute(req, res, urlPath) {
  if (urlPath === '/api/ops/health' && req.method === 'GET') {
    sendJson(res, 200, buildHealthPayload());
    return true;
  }
  if (urlPath === '/api/ops/readiness' && req.method === 'GET') {
    const body = buildReadinessPayload();
    sendJson(res, body.status === 'not_ready' ? 503 : 200, body);
    return true;
  }
  return false;
}

module.exports = {
  handleOpsRoute,
  buildHealthPayload,
  buildReadinessPayload
};
