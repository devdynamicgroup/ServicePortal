/**
 * Persist Drive upload metadata onto the Notion case page (best-effort).
 * Never throws to the upload caller — failures are logged only.
 */

const { expandNotionId } = require('./google-drive-folders');

async function persistDriveUploadToNotion({
  notionId,
  customerFolderId,
  customerFolderUrl,
  fileId,
  webViewLink,
  contentUrl,
  category,
  purpose
} = {}) {
  const pageId = expandNotionId(notionId);
  if (!pageId || !fileId) return { saved: false, reason: 'missing_ids' };

  let updateClient;
  try {
    ({ updateClient } = require('./notion/clients'));
  } catch (error) {
    console.warn('[drive-notion] clients module unavailable', error.message);
    return { saved: false, reason: 'notion_unavailable' };
  }

  try {
    await updateClient(pageId, {
      driveFolderId: customerFolderId || undefined,
      driveFolderUrl: customerFolderUrl || undefined,
      driveLatestFileId: fileId,
      driveLatestFileUrl: webViewLink || contentUrl || undefined,
      driveLatestCategory: category || undefined,
      driveLatestPurpose: purpose || undefined
    });
    console.log('[drive-notion] metadata saved', {
      notionId: `${pageId.slice(0, 8)}…`,
      fileId,
      category: category || null,
      purpose: purpose || null
    });
    return { saved: true };
  } catch (error) {
    // Missing Notion properties (fields not created yet) should not break uploads.
    console.warn('[drive-notion] metadata save skipped/failed', {
      message: error.message,
      notionId: `${pageId.slice(0, 8)}…`
    });
    return { saved: false, reason: error.message };
  }
}

module.exports = {
  persistDriveUploadToNotion
};
