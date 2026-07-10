const { getDataSourceSchema } = require('../services/notion/client');
const { findPropertyKey } = require('../services/notion/props');
const { FIELD_ALIASES } = require('../services/notion/mapper');

const SELECT_OPTIONS = {
  caseWorkflowStatus: [
    'scheduled',
    'in_progress',
    'completed',
    'result_sent',
    'feedback_pending',
    'feedback_done',
    'review_requested',
    'cancelled'
  ],
  feedbackStatus: ['not_sent', 'pending', 'submitted'],
  reviewStatus: ['not_requested', 'requested', 'completed'],
  notificationStatus: ['not_sent', 'ready', 'sent', 'failed']
};

const PROPERTY_DEFINITIONS = [
  { key: 'lineDisplayName', name: 'LINE Display Name', schema: { rich_text: {} } },
  { key: 'lineUserId', name: 'LINE User ID', schema: { rich_text: {} } },
  { key: 'lineLinked', name: 'LINE Linked', schema: { checkbox: {} } },
  { key: 'lineLinkedAt', name: 'LINE Linked At', schema: { date: {} } },
  { key: 'caseWorkflowStatus', name: 'Case Workflow Status', schema: selectSchema('caseWorkflowStatus') },
  { key: 'serviceStartedAt', name: 'Service Started At', schema: { date: {} } },
  { key: 'serviceCompletedAt', name: 'Service Completed At', schema: { date: {} } },
  { key: 'closedAt', name: 'Closed At', schema: { date: {} } },
  { key: 'completedBy', name: 'Completed By', schema: { rich_text: {} } },
  { key: 'resultSummary', name: 'Result Summary', schema: { rich_text: {} } },
  { key: 'recommendations', name: 'Recommendations', schema: { rich_text: {} } },
  { key: 'reportUrl', name: 'Report URL', schema: { url: {} } },
  { key: 'publicReportToken', name: 'Public Report Token', schema: { rich_text: {} } },
  { key: 'feedbackToken', name: 'Feedback Token', schema: { rich_text: {} } },
  { key: 'feedbackUrl', name: 'Feedback URL', schema: { url: {} } },
  { key: 'feedbackStatus', name: 'Feedback Status', schema: selectSchema('feedbackStatus') },
  { key: 'feedbackRating', name: 'Feedback Rating', schema: { number: { format: 'number' } } },
  { key: 'feedbackComment', name: 'Feedback Comment', schema: { rich_text: {} } },
  { key: 'feedbackSubmittedAt', name: 'Feedback Submitted At', schema: { date: {} } },
  { key: 'reviewUrl', name: 'Review URL', schema: { url: {} } },
  { key: 'reviewRequestedAt', name: 'Review Requested At', schema: { date: {} } },
  { key: 'reviewStatus', name: 'Review Status', schema: selectSchema('reviewStatus') },
  { key: 'resultSentAt', name: 'Result Sent At', schema: { date: {} } },
  { key: 'notificationStatus', name: 'Notification Status', schema: selectSchema('notificationStatus') },
  { key: 'lineMessageId', name: 'LINE Message ID', schema: { rich_text: {} } },
  { key: 'lastNotificationError', name: 'Last Notification Error', schema: { rich_text: {} } }
];

function selectSchema(key) {
  return {
    select: {
      options: SELECT_OPTIONS[key].map((name, index) => ({
        name,
        color: ['gray', 'blue', 'green', 'yellow', 'purple', 'pink', 'orange', 'red'][index % 8]
      }))
    }
  };
}

async function main() {
  const { dataSourceId, properties } = await getDataSourceSchema();
  const missing = PROPERTY_DEFINITIONS.filter(def => {
    const aliases = FIELD_ALIASES[def.key] || [def.name];
    return !findPropertyKey(properties, aliases);
  });

  if (!missing.length) {
    console.log(JSON.stringify({ ok: true, dataSourceId, created: [], skipped: PROPERTY_DEFINITIONS.length }, null, 2));
    return;
  }

  const notion = require('../services/notion/client').getNotionClient();
  const nextProperties = missing.reduce((acc, def) => {
    acc[def.name] = def.schema;
    return acc;
  }, {});

  await notion.dataSources.update({
    data_source_id: dataSourceId,
    properties: nextProperties
  });

  console.log(JSON.stringify({
    ok: true,
    dataSourceId,
    created: missing.map(def => def.name),
    skipped: PROPERTY_DEFINITIONS.length - missing.length
  }, null, 2));
}

main().catch(error => {
  console.error(error.body || error.message || error);
  process.exit(1);
});
