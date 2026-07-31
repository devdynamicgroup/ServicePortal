/**
 * Water Score share cards for LINE / social (3 formats).
 * Matches the approved design plate:
 *  - left: real site photo (default faucet plate when missing)
 *  - right: static headline + dynamic score card
 *  - static QR CTA + Water Motion wordmark
 */

const path = require('path');
const fs = require('fs');

const FORMATS = Object.freeze({
  landscape: { key: 'landscape', width: 1200, height: 630, label: '1200×630' },
  square: { key: 'square', width: 1080, height: 1080, label: '1080×1080' },
  story: { key: 'story', width: 1080, height: 1920, label: '1080×1920' }
});

const BRAND_BLUE = '#284DCD';
const SURFACE = '#C0C1C5';
const CARD_BG = '#FFFFFF';
const INK = '#111111';
const MUTED = '#6B7280';
const DIM = '#9CA3AF';
const GOOD_GREEN = '#34A853';
const GOOD_GREEN_SOFT = '#8FCF9B';
const HEADLINE = '#F0F1F3';
const LOGO_FILL = '#F0F1F3';

const ASSET_DIR = path.join(__dirname, '..', 'src', 'assets');
const DEFAULT_PHOTO = path.join(ASSET_DIR, 'score-share-default-photo.jpg');
const QR_ASSET = path.join(ASSET_DIR, 'score-share-qr.png');

function escapeXml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function fileToDataUri(filePath, mime) {
  if (!filePath || !fs.existsSync(filePath)) return '';
  const buf = fs.readFileSync(filePath);
  return `data:${mime};base64,${buf.toString('base64')}`;
}

function customerVerdict(score) {
  const wq = Number(score);
  if (wq >= 80) return { label: 'Excellent', color: BRAND_BLUE, tier: 'high' };
  if (wq >= 65) return { label: 'Good', color: GOOD_GREEN, tier: 'mid' };
  return { label: 'Needs attention', color: '#F07B7B', tier: 'low' };
}

function scoreSummaryNote(score, findingsCount = 0) {
  const wq = Number(score);
  if (wq >= 80) return 'Your water meets international standards. Clean and balanced at every tap.';
  if (wq >= 65) return 'Clean water for daily use. A few small adjustments would bring it up to international quality.';
  if (findingsCount > 0) {
    return `${findingsCount} readings exceed recommended levels — affecting your skin, hair, and appliances.`;
  }
  return 'Your water quality needs attention.';
}

function wrapNote(text, maxCharsPerLine, maxLines = 3) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxCharsPerLine && current) {
      lines.push(current);
      current = word;
      if (lines.length >= maxLines) break;
    } else {
      current = next;
    }
  }
  if (lines.length < maxLines && current) lines.push(current);
  return lines.slice(0, maxLines);
}

function resolveFormat(format) {
  const key = String(format || 'landscape').toLowerCase();
  if (key === 'og' || key === '1200x630') return FORMATS.landscape;
  if (key === 'ig' || key === '1080x1080') return FORMATS.square;
  if (key === 'story' || key === '1080x1920') return FORMATS.story;
  return FORMATS[key] || FORMATS.landscape;
}

function fillColorFor(verdict) {
  if (verdict.tier === 'high') return BRAND_BLUE;
  if (verdict.tier === 'mid') return GOOD_GREEN_SOFT;
  return '#F07B7B';
}

/** Continuous progress bar matching the design mock. */
function progressBar(pad, barY, barW, barH, wq, fillColor) {
  const knobX = pad + (barW * wq) / 100;
  const fillW = Math.max(0, (barW * wq) / 100);
  return `
    <rect x="${pad}" y="${barY}" width="${barW}" height="${barH}" rx="${barH / 2}" fill="#E5E4E1"/>
    <rect x="${pad}" y="${barY}" width="${fillW}" height="${barH}" rx="${barH / 2}" fill="${fillColor}"/>
    <circle cx="${knobX}" cy="${barY + barH / 2}" r="8" fill="#fff" stroke="${INK}" stroke-width="2.5"/>
  `;
}

function scoreCard({ x, y, width, height, score, verdict, note, indicators = 8 }) {
  const wq = Math.max(0, Math.min(100, Number(score) || 0));
  const pad = 32;
  const barY = 128;
  const barH = 10;
  const barW = width - pad * 2;
  const noteLines = wrapNote(note, Math.floor(width / 10.2), 3);
  const fill = fillColorFor(verdict);
  const verdictX = pad + (String(Math.round(wq)).length >= 3 ? 130 : String(Math.round(wq)).length === 2 ? 100 : 62);

  const ticks = [
    { at: 0, label: '0' },
    { at: 50, label: '50 - Thai' },
    { at: 80, label: "80 - Int'l" },
    { at: 100, label: '100' }
  ];

  const noteSvg = noteLines.map((line, i) => (
    `<text x="${pad}" y="${barY + 58 + i * 22}" fill="${MUTED}" font-family="Arial, Helvetica, sans-serif" font-size="16">${escapeXml(line)}</text>`
  )).join('');

  return `
    <g transform="translate(${x},${y})">
      <rect width="${width}" height="${height}" rx="24" fill="${CARD_BG}" filter="url(#cardShadow)"/>
      <text x="${pad}" y="38" fill="${DIM}" font-family="Arial, Helvetica, sans-serif" font-size="14" font-weight="600" letter-spacing="0.08em">WATER SCORE</text>
      <text x="${width - pad}" y="38" text-anchor="end" fill="${DIM}" font-family="Arial, Helvetica, sans-serif" font-size="14">${indicators} indicators</text>
      <text x="${pad}" y="100" fill="${INK}" font-family="Arial, Helvetica, sans-serif" font-size="72" font-weight="700">${Math.round(wq)}</text>
      <text x="${verdictX}" y="92" fill="${verdict.color}" font-family="Arial, Helvetica, sans-serif" font-size="${verdict.tier === 'low' ? 24 : 28}" font-weight="700">${escapeXml(verdict.label)}</text>
      ${progressBar(pad, barY, barW, barH, wq, fill)}
      ${ticks.map((t) => {
        const tx = pad + (barW * t.at) / 100;
        const anchor = t.at === 0 ? 'start' : t.at === 100 ? 'end' : 'middle';
        return `<text x="${tx}" y="${barY + 30}" text-anchor="${anchor}" fill="${DIM}" font-family="Arial, Helvetica, sans-serif" font-size="12">${escapeXml(t.label)}</text>`;
      }).join('')}
      ${noteSvg}
    </g>`;
}

function logoWordmark(x, y, fill = LOGO_FILL) {
  return `
    <g transform="translate(${x},${y})">
      <text x="0" y="15" fill="${fill}" font-family="Arial, Helvetica, sans-serif" font-size="16" font-weight="700" letter-spacing="0.14em">WATER MOTION</text>
    </g>`;
}

function buildLandscapeSvg(opts) {
  const { width, height } = FORMATS.landscape;
  const score = Number(opts.score);
  const verdict = customerVerdict(score);
  const note = opts.note || scoreSummaryNote(score, opts.findingsCount);
  const photoHref = opts.photoDataUri || '';
  const qrHref = opts.qrDataUri || '';
  const photoW = 560;

  const photoLayer = photoHref
    ? `<image href="${escapeXml(photoHref)}" x="0" y="0" width="${photoW}" height="${height}" preserveAspectRatio="xMidYMid slice" filter="url(#photoTone)"/>`
    : `<rect x="0" y="0" width="${photoW}" height="${height}" fill="#1a1f2b"/>`;

  const qrLayer = qrHref
    ? `<image href="${escapeXml(qrHref)}" x="32" y="${height - 188}" width="138" height="160" preserveAspectRatio="xMidYMid meet"/>`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <filter id="photoTone" x="0" y="0" width="100%" height="100%">
      <feColorMatrix type="matrix" values="
        0.85 0.08 0.05 0 0.02
        0.05 0.88 0.07 0 0.02
        0.06 0.08 0.92 0 0.04
        0 0 0 1 0"/>
      <feComponentTransfer>
        <feFuncR type="linear" slope="0.9" intercept="0.03"/>
        <feFuncG type="linear" slope="0.9" intercept="0.03"/>
        <feFuncB type="linear" slope="0.92" intercept="0.03"/>
      </feComponentTransfer>
    </filter>
    <linearGradient id="photoScrim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="55%" stop-color="#000" stop-opacity="0"/>
      <stop offset="100%" stop-color="#000" stop-opacity="0.35"/>
    </linearGradient>
    <filter id="cardShadow" x="-25%" y="-25%" width="150%" height="150%">
      <feDropShadow dx="0" dy="18" stdDeviation="22" flood-color="#0c0a09" flood-opacity="0.22"/>
    </filter>
  </defs>
  <rect width="${width}" height="${height}" fill="${SURFACE}"/>
  ${photoLayer}
  <rect x="0" y="0" width="${photoW}" height="${height}" fill="url(#photoScrim)"/>
  <text x="610" y="86" fill="${HEADLINE}" font-family="Arial, Helvetica, sans-serif" font-size="36" font-weight="800" letter-spacing="0.04em">SEE YOUR WATER</text>
  <text x="610" y="128" fill="${HEADLINE}" font-family="Arial, Helvetica, sans-serif" font-size="36" font-weight="800" letter-spacing="0.04em">DIFFERENTLY.</text>
  ${scoreCard({ x: 600, y: 168, width: 540, height: 310, score, verdict, note, indicators: opts.indicators || 8 })}
  ${qrLayer}
  ${logoWordmark(width - 230, height - 42, LOGO_FILL)}
</svg>`;
}

function buildStackedSvg(opts, meta, photoH, cardY, cardH, qrY) {
  const { width, height } = meta;
  const score = Number(opts.score);
  const verdict = customerVerdict(score);
  const note = opts.note || scoreSummaryNote(score, opts.findingsCount);
  const photoHref = opts.photoDataUri || '';
  const qrHref = opts.qrDataUri || '';

  const photoLayer = photoHref
    ? `<image href="${escapeXml(photoHref)}" x="0" y="0" width="${width}" height="${photoH}" preserveAspectRatio="xMidYMid slice" filter="url(#photoTone)"/>`
    : `<rect x="0" y="0" width="${width}" height="${photoH}" fill="#1a1f2b"/>`;

  const qrLayer = qrHref
    ? `<image href="${escapeXml(qrHref)}" x="48" y="${qrY}" width="150" height="150"/>`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <filter id="photoTone" x="0" y="0" width="100%" height="100%">
      <feColorMatrix type="matrix" values="
        0.85 0.08 0.05 0 0.02
        0.05 0.88 0.07 0 0.02
        0.06 0.08 0.92 0 0.04
        0 0 0 1 0"/>
    </filter>
    <linearGradient id="photoScrim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="45%" stop-color="#000" stop-opacity="0"/>
      <stop offset="100%" stop-color="#000" stop-opacity="0.5"/>
    </linearGradient>
    <filter id="cardShadow" x="-25%" y="-25%" width="150%" height="150%">
      <feDropShadow dx="0" dy="16" stdDeviation="20" flood-color="#0c0a09" flood-opacity="0.2"/>
    </filter>
  </defs>
  <rect width="${width}" height="${height}" fill="${SURFACE}"/>
  ${photoLayer}
  <rect x="0" y="0" width="${width}" height="${photoH}" fill="url(#photoScrim)"/>
  <text x="48" y="72" fill="#FFFFFF" font-family="Arial, Helvetica, sans-serif" font-size="40" font-weight="800">SEE YOUR WATER</text>
  <text x="48" y="120" fill="#FFFFFF" font-family="Arial, Helvetica, sans-serif" font-size="40" font-weight="800">DIFFERENTLY.</text>
  ${scoreCard({ x: 70, y: cardY, width: width - 140, height: cardH, score, verdict, note, indicators: opts.indicators || 8 })}
  ${qrLayer}
  ${logoWordmark(width - 250, height - 48, INK)}
</svg>`;
}

function buildShareCardSvg(format, options = {}) {
  const meta = resolveFormat(format);
  if (meta.key === 'square') {
    return {
      ...meta,
      svg: buildStackedSvg(options, meta, 480, 420, 320, meta.height - 190)
    };
  }
  if (meta.key === 'story') {
    return {
      ...meta,
      svg: buildStackedSvg(options, meta, 980, 1020, 340, 800)
    };
  }
  return { ...meta, svg: buildLandscapeSvg(options) };
}

async function fetchAsDataUri(url) {
  if (!url) return '';
  if (String(url).startsWith('data:')) return String(url);
  try {
    const response = await fetch(url, { redirect: 'follow' });
    if (!response.ok) return '';
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    if (!contentType.startsWith('image/')) return '';
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > 6 * 1024 * 1024) return '';
    return `data:${contentType};base64,${buffer.toString('base64')}`;
  } catch (error) {
    console.warn('[score-share-card] photo fetch failed', error.message);
    return '';
  }
}

async function resolvePhotoDataUri(options = {}) {
  if (options.photoDataUri) return options.photoDataUri;
  if (options.photoUrl) {
    const remote = await fetchAsDataUri(options.photoUrl);
    if (remote) return remote;
  }
  return fileToDataUri(DEFAULT_PHOTO, 'image/jpeg');
}

async function renderShareCardPng(format, options = {}) {
  const sharp = require('sharp');
  const photoDataUri = await resolvePhotoDataUri(options);
  const qrDataUri = options.qrDataUri || fileToDataUri(QR_ASSET, 'image/png');
  const built = buildShareCardSvg(format, { ...options, photoDataUri, qrDataUri });
  const png = await sharp(Buffer.from(built.svg))
    .png({ compressionLevel: 8 })
    .toBuffer();
  return { ...built, png };
}

function cardOptionsFromJob(job = {}, overrides = {}) {
  const score = Number(
    overrides.score != null ? overrides.score : job.result?.waterScore
  );
  const findingsCount = Number(overrides.findingsCount || 0);
  return {
    score: Number.isFinite(score) ? score : 0,
    note: overrides.note || job.result?.summary || scoreSummaryNote(score, findingsCount),
    findingsCount,
    indicators: overrides.indicators || 8,
    photoUrl: overrides.photoUrl || job.drive?.latestFileUrl || '',
    photoDataUri: overrides.photoDataUri || ''
  };
}

module.exports = {
  FORMATS,
  resolveFormat,
  customerVerdict,
  scoreSummaryNote,
  buildShareCardSvg,
  renderShareCardPng,
  cardOptionsFromJob,
  fetchAsDataUri
};
