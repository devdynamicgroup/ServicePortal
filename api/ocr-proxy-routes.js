/**
 * Thin OCR proxy routes.
 *
 * Validate → ocrClient → return. No OCR parsing or engine logic.
 */

const { readMeter } = require('../services/ocrClient');

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 256 * 1024) {
        req.destroy();
        reject(new Error('Request body too large'));
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

async function handleOcrProxyRoute(req, res, urlPath) {
  if (urlPath !== '/api/ocr/read-meter') return false;

  if (req.method !== 'POST') {
    sendJson(res, 405, {
      success: false,
      error: 'METHOD_NOT_ALLOWED',
      message: 'Use POST /api/ocr/read-meter'
    });
    return true;
  }

  let payload = {};
  try {
    const raw = await readBody(req);
    payload = raw ? JSON.parse(raw) : {};
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('Body must be a JSON object');
    }
  } catch (error) {
    sendJson(res, 400, {
      success: false,
      error: 'INVALID_REQUEST',
      message: 'Request body must be JSON: { image_url, meter_type }'
    });
    return true;
  }

  const imageUrl = payload.image_url != null ? String(payload.image_url).trim() : '';
  const meterType = payload.meter_type != null ? String(payload.meter_type).trim() : '';

  if (!imageUrl || !meterType) {
    sendJson(res, 400, {
      success: false,
      error: 'VALIDATION_ERROR',
      message: 'image_url and meter_type are required'
    });
    return true;
  }

  const result = await readMeter({
    image_url: imageUrl,
    meter_type: meterType
  });

  // Strip internal transport fields before responding to the browser.
  const { statusCode, ...body } = result;
  sendJson(res, 200, body);
  return true;
}

module.exports = { handleOcrProxyRoute };
