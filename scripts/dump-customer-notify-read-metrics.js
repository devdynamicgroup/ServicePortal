#!/usr/bin/env node
'use strict';

/** Read-only dump of in-process M8.6 notify destination metrics. */
require('../config/env');
const { getCustomerDomainFlags, notifyReadMetrics } = require('../services/customer-domain');
console.log(JSON.stringify(notifyReadMetrics.getSnapshot(getCustomerDomainFlags()), null, 2));
