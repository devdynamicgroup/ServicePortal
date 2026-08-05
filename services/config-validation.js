const { isLineConfigured, isLineWebhookConfigured, resolveLineBookingUrl } = require('./line-notifications');
const { isNotionConfigured } = require('./notion/client');
const { publicBaseUrl } = require('./url-builder');
const { logEvent } = require('./observability');
const {
  getCustomerDomainFlags,
  isAnyCustomerDomainFlagOn,
  isCustomersDbConfigured
} = require('./customer-domain');

/** Startup warnings only — never throws / never blocks listen(). */
function validateProductionConfig() {
  const warnings = [];

  if (!isNotionConfigured()) {
    warnings.push({ code: 'notion_not_configured', message: 'NOTION_API_KEY / NOTION_DATABASE_ID missing' });
  }
  if (!isLineConfigured()) {
    warnings.push({ code: 'line_token_missing', message: 'LINE_CHANNEL_ACCESS_TOKEN missing' });
  }
  if (!isLineWebhookConfigured()) {
    warnings.push({ code: 'line_secret_missing', message: 'LINE_CHANNEL_SECRET missing' });
  }

  const base = publicBaseUrl();
  if (!base || !/^https:\/\//i.test(base)) {
    warnings.push({
      code: 'public_url_insecure_or_empty',
      message: 'PUBLIC_BASE_URL / RENDER_EXTERNAL_URL should be https for LINE assets'
    });
  }

  const booking = resolveLineBookingUrl();
  if (!booking || !/^https:\/\//i.test(booking)) {
    warnings.push({
      code: 'booking_url_insecure_or_empty',
      message: 'LINE_BOOKING_URL should be an https URL'
    });
  }

  // M8.1: Customer Domain flags default OFF — warn only when a flag is on without DB.
  const customerFlags = getCustomerDomainFlags();
  if (isAnyCustomerDomainFlagOn(customerFlags) && !isCustomersDbConfigured()) {
    warnings.push({
      code: 'customers_db_missing_while_flags_on',
      message: 'Customer Domain flag(s) enabled but NOTION_CUSTOMERS_DATABASE_ID is missing'
    });
  }
  if (customerFlags.dualWrite && !customerFlags.enabled) {
    warnings.push({
      code: 'customer_dual_write_without_enabled',
      message: 'CUSTOMER_DOMAIN_DUAL_WRITE=true but CUSTOMER_DOMAIN_ENABLED is false'
    });
  }
  if ((customerFlags.readLine || customerFlags.readNotify) && !customerFlags.enabled) {
    warnings.push({
      code: 'customer_read_without_enabled',
      message: 'Customer Domain read flag(s) on but CUSTOMER_DOMAIN_ENABLED is false'
    });
  }
  if (customerFlags.readLineShadow && !customerFlags.enabled) {
    warnings.push({
      code: 'customer_read_line_shadow_without_enabled',
      message: 'CUSTOMER_DOMAIN_READ_LINE_SHADOW=true but CUSTOMER_DOMAIN_ENABLED is false'
    });
  }
  if (customerFlags.readLine && customerFlags.readLineShadow) {
    warnings.push({
      code: 'customer_read_line_shadow_ignored',
      message: 'CUSTOMER_DOMAIN_READ_LINE and READ_LINE_SHADOW both true — primary mode wins; shadow ignored'
    });
  }
  if (customerFlags.readNotify) {
    warnings.push({
      code: 'customer_read_notify_enabled',
      message: 'CUSTOMER_DOMAIN_READ_NOTIFY=true — notification destination uses Customer path; ensure shadow acceptance before production'
    });
  }
  if (customerFlags.readNotifyShadow && !customerFlags.enabled) {
    warnings.push({
      code: 'customer_read_notify_shadow_without_enabled',
      message: 'CUSTOMER_DOMAIN_READ_NOTIFY_SHADOW=true but CUSTOMER_DOMAIN_ENABLED is false'
    });
  }
  if (customerFlags.readNotify && customerFlags.readNotifyShadow) {
    warnings.push({
      code: 'customer_read_notify_shadow_ignored',
      message: 'CUSTOMER_DOMAIN_READ_NOTIFY and READ_NOTIFY_SHADOW both true — primary mode wins; shadow ignored'
    });
  }
  if (customerFlags.mergeEnabled && !isCustomersDbConfigured()) {
    warnings.push({
      code: 'customer_merge_without_db',
      message: 'CUSTOMER_DOMAIN_MERGE_ENABLED=true but NOTION_CUSTOMERS_DATABASE_ID is missing'
    });
  }
  if (customerFlags.mergeEnabled && !customerFlags.enabled) {
    warnings.push({
      code: 'customer_merge_without_enabled',
      message: 'CUSTOMER_DOMAIN_MERGE_ENABLED=true but CUSTOMER_DOMAIN_ENABLED is false'
    });
  }

  // M9.0 Care Lifecycle — independent of Customer Domain; defaults OFF.
  const {
    getCareLifecycleFlags,
    isCareAuditsDbConfigured
  } = require('./care-lifecycle/flags');
  const careFlags = getCareLifecycleFlags();
  if (careFlags.send && !careFlags.enabled) {
    warnings.push({
      code: 'care_send_without_enabled',
      message: 'CARE_LIFECYCLE_SEND=true but CARE_LIFECYCLE_ENABLED is false'
    });
  }
  if (careFlags.send && !isCareAuditsDbConfigured()) {
    warnings.push({
      code: 'care_send_without_audits_db',
      message: 'CARE_LIFECYCLE_SEND=true but NOTION_CARE_AUDITS_DATABASE_ID missing (file audit still works)'
    });
  }

  warnings.forEach(item => {
    console.warn('[config_validation]', item.code, item.message);
    logEvent('warn', 'config_validation_warning', {
      code: item.code,
      message: item.message,
      success: false,
      failureReason: item.message
    });
  });

  return { ok: warnings.length === 0, warnings };
}

module.exports = { validateProductionConfig };
