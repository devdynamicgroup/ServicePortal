/**
 * Water Score share cards for LINE / social (3 formats).
 * Dynamic: photo + score card (number, verdict, knob, note).
 * Static: headline, logo, QR CTA block.
 */

const path = require('path');
const fs = require('fs');

const FORMATS = Object.freeze({
  landscape: { key: 'landscape', width: 1200, height: 630, label: '1200×630' },
  square: { key: 'square', width: 1080, height: 1080, label: '1080×1080' },
  story: { key: 'story', width: 1080, height: 1920, label: '1080×1920' }
});

const BRAND_BLUE = '#284DCD';
const SURFACE = '#EDEBE8';
const CARD_BG = '#FFFFFF';
const INK = '#0C0A09';
const MUTED = '#78716C';
const DIM = '#A8A29D';

function escapeXml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function customerVerdict(score) {
  const wq = Number(score);
  if (wq >= 80) return { label: 'Excellent', color: BRAND_BLUE, tier: 'high' };
  if (wq >= 65) return { label: 'Good', color: '#22C55E', tier: 'mid' };
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

function photoFilterOverlay() {
  // Soft cool grade so light/dark site photos land in one brand tone.
  return `
    <filter id="photoTone" x="-5%" y="-5%" width="110%" height="110%">
      <feColorMatrix type="matrix" values="
        0.90 0.05 0.05 0 0.02
        0.04 0.92 0.06 0 0.02
        0.05 0.08 0.95 0 0.04
        0    0    0    1 0"/>
      <feComponentTransfer>
        <feFuncR type="linear" slope="0.92" intercept="0.04"/>
        <feFuncG type="linear" slope="0.92" intercept="0.04"/>
        <feFuncB type="linear" slope="0.94" intercept="0.03"/>
      </feComponentTransfer>
    </filter>`;
}

function logoMark(x, y, scale = 1, fill = '#FFFFFF') {
  const s = scale;
  return `
    <g transform="translate(${x},${y}) scale(${s})">
      <path fill="${fill}" d="M18 4.2c-5.8 7.1-10.5 12.8-10.5 18.2A10.5 10.5 0 0 0 18 32.9a10.5 10.5 0 0 0 10.5-10.5c0-5.4-4.7-11.1-10.5-18.2z"/>
      <path fill="#5B8DEF" d="M14.2 21.6c0-2.8 1.6-5.1 3.8-6.8 1.7 2.3 3.1 4.6 3.1 6.8a3.45 3.45 0 0 1-6.9 0z"/>
      <text x="36" y="24" fill="${fill}" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="700" letter-spacing="1.2">WATER MOTION</text>
    </g>`;
}

function qrBlock(x, y, size) {
  // Static CTA visual — Flex / share action opens the report URL.
  const cell = size / 11;
  const pattern = [
    [1, 1, 1, 1, 1, 1, 1, 0, 1, 0, 1],
    [1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0],
    [1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1],
    [1, 0, 1, 1, 1, 0, 1, 0, 1, 1, 0],
    [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 1],
    [1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0],
    [1, 1, 1, 1, 1, 1, 1, 0, 1, 0, 1],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0],
    [1, 0, 1, 1, 0, 1, 1, 1, 0, 0, 1],
    [0, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0],
    [1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 1]
  ];
  let dots = '';
  for (let row = 0; row < 11; row += 1) {
    for (let col = 0; col < 11; col += 1) {
      if (!pattern[row][col]) continue;
      dots += `<rect x="${(col * cell).toFixed(2)}" y="${(row * cell).toFixed(2)}" width="${cell.toFixed(2)}" height="${cell.toFixed(2)}" fill="#fff"/>`;
    }
  }
  return `
    <g transform="translate(${x},${y})">
      <rect width="${size}" height="${size}" rx="14" fill="${BRAND_BLUE}"/>
      <text x="${size / 2}" y="22" text-anchor="middle" fill="#fff" font-family="Arial, Helvetica, sans-serif" font-size="13" font-weight="600">Get your score</text>
      <g transform="translate(${size * 0.18},${size * 0.28})">${dots}</g>
    </g>`;
}

function scoreCard({ x, y, width, height, score, verdict, note, indicators = 8 }) {
  const wq = Math.max(0, Math.min(100, Number(score) || 0));
  const pad = 28;
  const barY = 118;
  const barH = 10;
  const barW = width - pad * 2;
  const knobX = pad + (barW * wq) / 100;
  const noteLines = wrapNote(note, Math.floor(width / 9.5), 3);

  const ticks = [
    { at: 0, label: '0' },
    { at: 50, label: '50 · Thai' },
    { at: 80, label: "80 · Int'l" },
    { at: 100, label: '100' }
  ];

  const fillColor = verdict.tier === 'high' ? BRAND_BLUE : verdict.tier === 'mid' ? '#22C55E' : '#F07B7B';

  const noteSvg = noteLines.map((line, i) => (
    `<text x="${pad}" y="${barY + 52 + i * 22}" fill="${MUTED}" font-family="Arial, Helvetica, sans-serif" font-size="15" font-weight="400">${escapeXml(line)}</text>`
  )).join('');

  return `
    <g transform="translate(${x},${y})">
      <rect width="${width}" height="${height}" rx="22" fill="${CARD_BG}" filter="url(#cardShadow)"/>
      <text x="${pad}" y="36" fill="${DIM}" font-family="Arial, Helvetica, sans-serif" font-size="13" font-weight="600" letter-spacing="1.4">WATER SCORE</text>
      <text x="${width - pad}" y="36" text-anchor="end" fill="${DIM}" font-family="Arial, Helvetica, sans-serif" font-size="13" font-weight="500">${indicators} indicators</text>
      <text x="${pad}" y="92" fill="${INK}" font-family="Arial, Helvetica, sans-serif" font-size="64" font-weight="700">${Math.round(wq)}</text>
      <text x="${pad + (wq >= 100 ? 118 : wq >= 10 ? 90 : 58)}" y="86" fill="${verdict.color}" font-family="Arial, Helvetica, sans-serif" font-size="${verdict.tier === 'low' ? 22 : 26}" font-weight="700">${escapeXml(verdict.label)}</text>

      <rect x="${pad}" y="${barY}" width="${barW}" height="${barH}" rx="5" fill="#E8EEFC"/>
      <rect x="${pad}" y="${barY}" width="${Math.max(0, (barW * wq) / 100)}" height="${barH}" rx="5" fill="${fillColor}"/>
      <circle cx="${knobX}" cy="${barY + barH / 2}" r="9" fill="#fff" stroke="${INK}" stroke-width="2.5"/>

      ${ticks.map(t => {
        const tx = pad + (barW * t.at) / 100;
        const anchor = t.at === 0 ? 'start' : t.at === 100 ? 'end' : 'middle';
        return `<text x="${tx}" y="${barY + 28}" text-anchor="${anchor}" fill="${DIM}" font-family="Arial, Helvetica, sans-serif" font-size="11">${escapeXml(t.label)}</text>`;
      }).join('')}

      ${noteSvg}
    </g>`;
}

function buildLandscapeSvg(opts) {
  const { width, height } = FORMATS.landscape;
  const score = Number(opts.score);
  const verdict = customerVerdict(score);
  const note = opts.note || scoreSummaryNote(score, opts.findingsCount);
  const photoHref = opts.photoDataUri || opts.photoUrl || '';
  const photoLeft = 0;
  const photoW = 540;
  const cardW = 520;
  const cardH = 280;
  const cardX = 620;
  const cardY = 160;

  const photoLayer = photoHref
    ? `<image href="${escapeXml(photoHref)}" x="${photoLeft}" y="0" width="${photoW}" height="${height}" preserveAspectRatio="xMidYMid slice" filter="url(#photoTone)"/>`
    : `<rect x="${photoLeft}" y="0" width="${photoW}" height="${height}" fill="#1c1917"/>
       <rect x="${photoLeft}" y="0" width="${photoW}" height="${height}" fill="url(#photoFallback)"/>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    ${photoFilterOverlay()}
    <linearGradient id="photoFallback" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1e293b"/>
      <stop offset="55%" stop-color="#334155"/>
      <stop offset="100%" stop-color="#0f172a"/>
    </linearGradient>
    <linearGradient id="photoScrim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="40%" stop-color="#000" stop-opacity="0"/>
      <stop offset="100%" stop-color="#000" stop-opacity="0.45"/>
    </linearGradient>
    <filter id="cardShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="12" stdDeviation="18" flood-color="#0c0a09" flood-opacity="0.18"/>
    </filter>
  </defs>
  <rect width="${width}" height="${height}" fill="${SURFACE}"/>
  ${photoLayer}
  <rect x="${photoLeft}" y="0" width="${photoW}" height="${height}" fill="url(#photoScrim)"/>
  <text x="620" y="84" fill="${INK}" font-family="Arial, Helvetica, sans-serif" font-size="34" font-weight="800" letter-spacing="0.5">SEE YOUR WATER</text>
  <text x="620" y="124" fill="${INK}" font-family="Arial, Helvetica, sans-serif" font-size="34" font-weight="800" letter-spacing="0.5">DIFFERENTLY.</text>
  ${scoreCard({ x: cardX, y: cardY, width: cardW, height: cardH, score, verdict, note, indicators: opts.indicators || 8 })}
  ${qrBlock(36, height - 156, 120)}
  ${logoMark(width - 250, height - 52, 0.95, INK)}
</svg>`;
}

function buildSquareSvg(opts) {
  const { width, height } = FORMATS.square;
  const score = Number(opts.score);
  const verdict = customerVerdict(score);
  const note = opts.note || scoreSummaryNote(score, opts.findingsCount);
  const photoHref = opts.photoDataUri || opts.photoUrl || '';
  const photoH = 470;

  const photoLayer = photoHref
    ? `<image href="${escapeXml(photoHref)}" x="0" y="0" width="${width}" height="${photoH}" preserveAspectRatio="xMidYMid slice" filter="url(#photoTone)"/>`
    : `<rect x="0" y="0" width="${width}" height="${photoH}" fill="url(#photoFallback)"/>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    ${photoFilterOverlay()}
    <linearGradient id="photoFallback" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1e293b"/>
      <stop offset="100%" stop-color="#0f172a"/>
    </linearGradient>
    <linearGradient id="photoScrim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="50%" stop-color="#000" stop-opacity="0"/>
      <stop offset="100%" stop-color="#000" stop-opacity="0.5"/>
    </linearGradient>
    <filter id="cardShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="10" stdDeviation="16" flood-color="#0c0a09" flood-opacity="0.16"/>
    </filter>
  </defs>
  <rect width="${width}" height="${height}" fill="${SURFACE}"/>
  ${photoLayer}
  <rect x="0" y="0" width="${width}" height="${photoH}" fill="url(#photoScrim)"/>
  <text x="48" y="64" fill="#fff" font-family="Arial, Helvetica, sans-serif" font-size="36" font-weight="800">SEE YOUR WATER</text>
  <text x="48" y="108" fill="#fff" font-family="Arial, Helvetica, sans-serif" font-size="36" font-weight="800">DIFFERENTLY.</text>
  ${scoreCard({ x: 70, y: 430, width: 940, height: 300, score, verdict, note, indicators: opts.indicators || 8 })}
  ${qrBlock(48, height - 168, 130)}
  ${logoMark(width - 270, height - 58, 1, INK)}
</svg>`;
}

function buildStorySvg(opts) {
  const { width, height } = FORMATS.story;
  const score = Number(opts.score);
  const verdict = customerVerdict(score);
  const note = opts.note || scoreSummaryNote(score, opts.findingsCount);
  const photoHref = opts.photoDataUri || opts.photoUrl || '';
  const photoH = 980;

  const photoLayer = photoHref
    ? `<image href="${escapeXml(photoHref)}" x="0" y="0" width="${width}" height="${photoH}" preserveAspectRatio="xMidYMid slice" filter="url(#photoTone)"/>`
    : `<rect x="0" y="0" width="${width}" height="${photoH}" fill="url(#photoFallback)"/>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    ${photoFilterOverlay()}
    <linearGradient id="photoFallback" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1e293b"/>
      <stop offset="100%" stop-color="#0f172a"/>
    </linearGradient>
    <linearGradient id="photoScrim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="55%" stop-color="#000" stop-opacity="0"/>
      <stop offset="100%" stop-color="#000" stop-opacity="0.55"/>
    </linearGradient>
    <filter id="cardShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="12" stdDeviation="18" flood-color="#0c0a09" flood-opacity="0.18"/>
    </filter>
  </defs>
  <rect width="${width}" height="${height}" fill="${SURFACE}"/>
  ${photoLayer}
  <rect x="0" y="0" width="${width}" height="${photoH}" fill="url(#photoScrim)"/>
  <text x="56" y="90" fill="#fff" font-family="Arial, Helvetica, sans-serif" font-size="42" font-weight="800">SEE YOUR WATER</text>
  <text x="56" y="142" fill="#fff" font-family="Arial, Helvetica, sans-serif" font-size="42" font-weight="800">DIFFERENTLY.</text>
  ${qrBlock(56, photoH - 180, 140)}
  ${scoreCard({ x: 70, y: 1040, width: 940, height: 320, score, verdict, note, indicators: opts.indicators || 8 })}
  ${logoMark(width - 280, height - 70, 1.05, INK)}
</svg>`;
}

function buildShareCardSvg(format, options = {}) {
  const meta = resolveFormat(format);
  if (meta.key === 'square') return { ...meta, svg: buildSquareSvg(options) };
  if (meta.key === 'story') return { ...meta, svg: buildStorySvg(options) };
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

async function renderShareCardPng(format, options = {}) {
  const sharp = require('sharp');
  const photoDataUri = options.photoDataUri
    || (options.photoUrl ? await fetchAsDataUri(options.photoUrl) : '');
  const built = buildShareCardSvg(format, { ...options, photoDataUri });
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

function defaultSamplePhotoPath() {
  const candidate = path.join(__dirname, '..', 'src', 'assets', 'score-share-sample.jpg');
  return fs.existsSync(candidate) ? candidate : '';
}

module.exports = {
  FORMATS,
  resolveFormat,
  customerVerdict,
  scoreSummaryNote,
  buildShareCardSvg,
  renderShareCardPng,
  cardOptionsFromJob,
  defaultSamplePhotoPath,
  fetchAsDataUri
};
