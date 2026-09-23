/**
 * Tavus API client — communication only, no conversation/business logic.
 *
 * SCAFFOLD — Tavus account is not yet on a paid plan, so nothing here has
 * been exercised against the real API. Endpoint path, field names, and
 * response shape below follow Tavus's public Conversational Video
 * Interface docs as of this writing (https://docs.tavus.io) — VERIFY
 * against the live API once the account is active, before relying on this
 * in production. Never throws raw HTTP/network errors to callers; returns
 * a standardized object, matching services/ocrClient.js's contract style.
 */

function getTavusApiKey() {
  return process.env.TAVUS_API_KEY || '';
}

function isTavusConfigured() {
  return Boolean(getTavusApiKey());
}

function getTavusReplicaId() {
  return process.env.TAVUS_REPLICA_ID || '';
}

function getTavusPersonaId() {
  return process.env.TAVUS_PERSONA_ID || '';
}

const TAVUS_API_BASE = 'https://tavusapi.com/v2';
const REQUEST_TIMEOUT_MS = 15000;

// Cost guardrail — each conversation burns billed minutes, so cap it
// server-side rather than trusting the client. Tavus auto-ends the call
// once either limit is hit. See docs.tavus.io conversations `properties`.
const MAX_CALL_DURATION_SECONDS = 300; // 5 min hard cap per conversation
const PARTICIPANT_LEFT_TIMEOUT_SECONDS = 30;

/**
 * Build the greeting/context Tavus's avatar opens with, from whatever
 * customer data the caller already has on hand. Keep this to short,
 * display-safe strings — never pass raw internal objects or secrets.
 */
function buildConversationalContext({ customerName, waterScore } = {}) {
  const lines = [];
  if (customerName) {
    lines.push(`You are speaking with ${customerName}.`);
  }
  if (waterScore !== null && waterScore !== undefined && Number.isFinite(Number(waterScore))) {
    lines.push(`Their most recent Water Score is ${waterScore}/100.`);
  }
  lines.push('Match answer length to the question: a simple question gets a short, direct answer; a question that needs explanation gets a few sentences, not a lecture. Never pad with a repeated greeting or a long preamble — get to the point immediately. This is a spoken conversation, so avoid answers that run noticeably longer than what the question actually needs.');
  return lines.join(' ');
}

/**
 * Starts a Tavus conversation session.
 *
 * @param {{ customerName?: string, waterScore?: number|null }} context
 * @returns {Promise<{
 *   success: boolean,
 *   conversationUrl?: string,
 *   conversationId?: string,
 *   error?: string,
 *   message?: string,
 *   statusCode?: number
 * }>}
 */
async function startConversation(context = {}) {
  if (!isTavusConfigured()) {
    return {
      success: false,
      error: 'TAVUS_NOT_CONFIGURED',
      message: 'TAVUS_API_KEY is not set — Tavus account may still be pending activation.',
      statusCode: 503
    };
  }

  const replicaId = getTavusReplicaId();
  const personaId = getTavusPersonaId();
  if (!replicaId) {
    return {
      success: false,
      error: 'TAVUS_NOT_CONFIGURED',
      message: 'TAVUS_REPLICA_ID is not set.',
      statusCode: 503
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${TAVUS_API_BASE}/conversations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': getTavusApiKey()
      },
      body: JSON.stringify({
        replica_id: replicaId,
        ...(personaId ? { persona_id: personaId } : {}),
        conversational_context: buildConversationalContext(context),
        properties: {
          max_call_duration: MAX_CALL_DURATION_SECONDS,
          participant_left_timeout: PARTICIPANT_LEFT_TIMEOUT_SECONDS
        }
      }),
      signal: controller.signal
    });

    const rawText = await response.text();
    let body;
    try {
      body = rawText ? JSON.parse(rawText) : {};
    } catch {
      console.warn('[tavus-client] non-JSON response', { status: response.status });
      return {
        success: false,
        error: 'TAVUS_INVALID_RESPONSE',
        message: 'Tavus returned an unexpected response.',
        statusCode: response.status
      };
    }

    if (!response.ok) {
      console.warn('[tavus-client] request failed', {
        status: response.status,
        error: body?.error || body?.message || null
      });
      return {
        success: false,
        error: 'TAVUS_REQUEST_FAILED',
        message: body?.message || `Tavus returned HTTP ${response.status}`,
        statusCode: response.status
      };
    }

    // Field names (conversation_url / conversation_id) per Tavus's
    // Conversations API docs — RE-VERIFY once real API access exists.
    return {
      success: true,
      conversationUrl: body?.conversation_url || null,
      conversationId: body?.conversation_id || null,
      statusCode: response.status
    };
  } catch (error) {
    const aborted = error?.name === 'AbortError';
    console.warn('[tavus-client] request error', {
      reason: aborted ? 'timeout' : 'network',
      message: error?.message || String(error)
    });
    return {
      success: false,
      error: aborted ? 'TAVUS_TIMEOUT' : 'TAVUS_OFFLINE',
      message: 'Tavus service is not available',
      statusCode: 503
    };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  isTavusConfigured,
  startConversation,
  buildConversationalContext,
  // Exported for tests only.
  getTavusApiKey,
  getTavusReplicaId,
  getTavusPersonaId
};
