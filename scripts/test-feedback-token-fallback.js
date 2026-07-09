process.env.NOTION_CLIENT_FEEDBACK_DATABASE_ID = '';
process.env.NOTION_FEEDBACK_DATABASE_ID = '';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
process.env.NOTION_CLIENT_FEEDBACK_DATABASE_ID = '';
process.env.NOTION_FEEDBACK_DATABASE_ID = '';
require('../config/env');

const { getFeedbackByToken } = require('../services/client-feedback');

getFeedbackByToken('fb-0001')
  .then(result => {
    console.log('result', JSON.stringify(result, null, 2));
    process.exit(result?.clientPageId ? 0 : 1);
  })
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
