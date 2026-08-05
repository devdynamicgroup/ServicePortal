'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { DEFAULT_DIR } = require('./detector');

function ensureDir(dir = DEFAULT_DIR) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function ticketsPath(dir = DEFAULT_DIR) {
  return path.join(ensureDir(dir), 'tickets.json');
}

function loadTickets(dir = DEFAULT_DIR) {
  const file = ticketsPath(dir);
  if (!fs.existsSync(file)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function saveTickets(tickets, dir = DEFAULT_DIR) {
  fs.writeFileSync(ticketsPath(dir), JSON.stringify(tickets, null, 2), 'utf8');
}

function createTicketId() {
  return `tkt_${crypto.randomBytes(8).toString('hex')}`;
}

/**
 * Enqueue clusters from a detection report (or explicit tickets).
 */
function enqueueFromDetectionReport(report, options = {}) {
  const dir = options.dir || DEFAULT_DIR;
  const tickets = loadTickets(dir);
  const created = [];

  for (const cluster of report.clusters || []) {
    const customerIds = (cluster.customers || []).map(c => c.customerId).filter(Boolean);
    if (customerIds.length < 2) continue;

    const existingOpen = tickets.find(t => (
      t.status === 'open'
      && t.signal === cluster.matchedBy
      && [...t.customerIds].sort().join('|') === [...customerIds].sort().join('|')
    ));
    if (existingOpen) continue;

    const ticket = {
      ticketId: createTicketId(),
      type: 'duplicate_cluster',
      customerIds,
      signal: cluster.matchedBy,
      confidence: cluster.confidence,
      matchedValue: cluster.matchedValue || null,
      status: 'open',
      createdAt: new Date().toISOString(),
      detectionRunId: report.runId || null
    };
    tickets.push(ticket);
    created.push(ticket);
  }

  saveTickets(tickets, dir);
  return { created, totalOpen: tickets.filter(t => t.status === 'open').length, ticketsPath: ticketsPath(dir) };
}

function listTickets(filter = {}, dir = DEFAULT_DIR) {
  let tickets = loadTickets(dir);
  if (filter.status) tickets = tickets.filter(t => t.status === filter.status);
  return tickets;
}

function updateTicketStatus(ticketId, status, dir = DEFAULT_DIR) {
  const tickets = loadTickets(dir);
  const ticket = tickets.find(t => t.ticketId === ticketId);
  if (!ticket) return null;
  ticket.status = status;
  ticket.updatedAt = new Date().toISOString();
  saveTickets(tickets, dir);
  return ticket;
}

function dismissTicket(ticketId, dir = DEFAULT_DIR) {
  return updateTicketStatus(ticketId, 'dismissed', dir);
}

module.exports = {
  enqueueFromDetectionReport,
  listTickets,
  updateTicketStatus,
  dismissTicket,
  loadTickets,
  ticketsPath
};
