const { getNotionClient, resolveDataSourceId } = require('../services/notion/client');
const { updateClient } = require('../services/notion/clients');
const { FIELD_ALIASES } = require('../services/notion/mapper');
const { getPropertyValue } = require('../services/notion/props');

const REVIEW_URL = process.env.GOOGLE_REVIEW_URL || 'https://g.page/r/Ce0EFhVtUyRpEBM/review';
const BASE_URL = (process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || 'https://serviceportal.example.com').replace(/\/$/, '');

async function queryAllPages() {
  const notion = getNotionClient();
  const dataSourceId = await resolveDataSourceId();
  const pages = [];
  let startCursor;

  do {
    const response = await notion.dataSources.query({
      data_source_id: dataSourceId,
      start_cursor: startCursor,
      page_size: 100
    });
    pages.push(...(response.results || []));
    startCursor = response.has_more ? response.next_cursor : undefined;
  } while (startCursor);

  return pages.filter(page => page.object === 'page' && !page.archived && !page.in_trash);
}

function dateForPage(properties, index) {
  const raw = getPropertyValue(properties, FIELD_ALIASES.appointmentDate, '') || `2026-07-${String((index % 20) + 1).padStart(2, '0')}`;
  return String(raw).slice(0, 10);
}

function buildPayload(page, index) {
  const properties = page.properties || {};
  const idSuffix = String(index + 1).padStart(4, '0');
  const lineDisplayName = getPropertyValue(properties, FIELD_ALIASES.lineId, '') || `line_mock_${idSuffix}`;
  const score = Number(getPropertyValue(properties, FIELD_ALIASES.latestWaterScore, '')) || Math.max(62, 88 - (index % 8) * 4);
  const concern = getPropertyValue(properties, FIELD_ALIASES.waterConcerns, '') || 'general water quality';
  const serviceDate = dateForPage(properties, index);
  const isCompleted = index % 4 === 0;
  const reportToken = `rpt-${idSuffix}`;
  const feedbackToken = `fb-${idSuffix}`;

  return {
    lineDisplayName,
    lineUserId: `Umock${String(index + 1).padStart(28, '0')}`,
    lineLinked: true,
    lineLinkedAt: `${serviceDate}T09:15:00+07:00`,
    caseWorkflowStatus: isCompleted ? 'completed' : 'scheduled',
    serviceStartedAt: isCompleted ? `${serviceDate}T09:00:00+07:00` : '',
    serviceCompletedAt: isCompleted ? `${serviceDate}T10:10:00+07:00` : '',
    closedAt: isCompleted ? `${serviceDate}T10:20:00+07:00` : '',
    completedBy: isCompleted ? 'WM Specialist' : '',
    latestWaterScore: score,
    resultSummary: `Water score ${score}/100. Main concern: ${concern}.`,
    recommendations: 'Send result via LINE, collect satisfaction feedback, then share Google review link.',
    reportUrl: `${BASE_URL}/r/${reportToken}`,
    publicReportToken: reportToken,
    feedbackToken,
    feedbackUrl: `${BASE_URL}/f/${feedbackToken}`,
    feedbackStatus: isCompleted ? 'pending' : 'not_sent',
    reviewUrl: REVIEW_URL,
    reviewStatus: 'not_requested',
    notificationStatus: isCompleted ? 'ready' : 'not_sent'
  };
}

async function main() {
  const pages = await queryAllPages();
  const results = [];

  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index];
    await updateClient(page.id, buildPayload(page, index));
    results.push({ pageId: page.id, status: 'updated' });
  }

  console.log(JSON.stringify({
    ok: true,
    updated: results.length,
    sample: results.slice(0, 5)
  }, null, 2));
}

main().catch(error => {
  console.error(error.body || error.message || error);
  process.exit(1);
});
