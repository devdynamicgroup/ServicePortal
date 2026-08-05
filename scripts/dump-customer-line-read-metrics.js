#!/usr/bin/env node
'use strict';

/** Read-only dump of in-process M8.5 LINE read metrics. */
require('../config/env');
const { getCustomerDomainFlags, lineReadMetrics } = require('../services/customer-domain');
console.log(JSON.stringify(lineReadMetrics.getSnapshot(getCustomerDomainFlags()), null, 2));
