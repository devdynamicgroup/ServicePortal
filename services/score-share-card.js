/**
 * Water Score share cards for LINE / social (3 formats).
 * Matches the approved design plate:
 *  - left/top: site photo (default faucet plate when missing)
 *  - right/bottom: blurred photo wash + headline + dynamic score card
 *  - QR CTA (per-Case LIFF bind link when a feedbackToken is available,
 *    falling back to the static "just add the OA as a friend" badge
 *    otherwise -- e.g. the tokenless /demo preview route) + Water Motion
 *    wordmark
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const QRCode = require('qrcode');
const { isDriveConfigured, downloadImageContent } = require('./google-drive');
const { buildLiffBindUrl } = require('./url-builder');

const FORMATS = Object.freeze({
  landscape: { key: 'landscape', width: 1200, height: 630, label: '1200×630' },
  square: { key: 'square', width: 1080, height: 1080, label: '1080×1080' },
  story: { key: 'story', width: 1080, height: 1920, label: '1080×1920' }
});

const BRAND_BLUE = '#284DCD';
const CARD_BG = '#FAFAF8';
const INK = '#1D1917';
const NOTE_INK = '#4F4E4C';
const DIM = '#797674';
const TRACK = '#E6E5E1';
const GOOD_GREEN = '#71D29C';
const BAR_GREEN = '#6CD498';
const HEADLINE = '#FFFFFF';

const FONT = 'Geist, Inter, Arial, Helvetica, sans-serif';

/** Card artwork is authored once at this size, then scaled per format. */
const CARD_W = 780;
const CARD_H = 383;

const ASSET_DIR = path.join(__dirname, '..', 'src', 'assets');
const DEFAULT_PHOTO = path.join(ASSET_DIR, 'score-share-default-photo.jpg');
const FACEBOOK_BG = path.join(ASSET_DIR, 'score-share-facebook-bg.jpg');
const SQUARE_BG = path.join(ASSET_DIR, 'score-share-square-bg.jpg');
const STORY_BG = path.join(ASSET_DIR, 'score-share-story-bg.jpg');
const QR_ASSET = path.join(ASSET_DIR, 'score-share-qr.png');
const CTA_BADGE_ASSET = path.join(ASSET_DIR, 'score-share-cta-badge.png');
const WORDMARK_ASSET = path.join(ASSET_DIR, 'score-share-wordmark.png');
const FONT_DIR = path.join(ASSET_DIR, 'fonts');

/**
 * librsvg resolves SVG fonts through fontconfig, which on a stock Render Node
 * image only sees the handful of system fonts. Point it at the vendored Geist
 * files so the rendered card uses the same typeface as the portal UI.
 * Must run before sharp is first required.
 */
function ensureFontconfig() {
  if (process.env.FONTCONFIG_PATH || !fs.existsSync(FONT_DIR)) return;
  try {
    const confDir = path.join(os.tmpdir(), 'water-motion-fontconfig');
    const cacheDir = path.join(confDir, 'cache');
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(path.join(confDir, 'fonts.conf'), `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>${escapeXml(FONT_DIR)}</dir>
  <cachedir>${escapeXml(cacheDir)}</cachedir>
  <alias>
    <family>Geist</family>
    <prefer>
      <family>Geist</family>
      <family>Geist Medium</family>
      <family>Geist SemiBold</family>
    </prefer>
  </alias>
  <match target="pattern">
    <test name="family"><string>Geist</string></test>
    <test name="weight" compare="more_eq"><const>medium</const></test>
    <test name="weight" compare="less"><const>bold</const></test>
    <edit name="family" mode="assign" binding="strong"><string>Geist Medium</string></edit>
    <edit name="weight" mode="assign"><const>regular</const></edit>
  </match>
  <match target="pattern">
    <test name="family"><string>Geist</string></test>
    <test name="weight" compare="more_eq"><const>demibold</const></test>
    <test name="weight" compare="less"><const>bold</const></test>
    <edit name="family" mode="assign" binding="strong"><string>Geist SemiBold</string></edit>
    <edit name="weight" mode="assign"><const>regular</const></edit>
  </match>
</fontconfig>
`);
    process.env.FONTCONFIG_PATH = confDir;
  } catch (error) {
    console.warn('[score-share-card] fontconfig setup failed', error.message);
  }
}

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

function dataUriToBuffer(dataUri) {
  const match = String(dataUri || '').match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return Buffer.from(match[2], 'base64');
}

function customerVerdict(score) {
  const wq = Number(score);
  if (wq >= 80) return { label: 'Excellent', color: BRAND_BLUE, tier: 'high' };
  if (wq >= 60) return { label: 'Acceptable', color: GOOD_GREEN, tier: 'mid' };
  return { label: 'Needs attention', color: '#F07B7B', tier: 'low' };
}

function scoreSummaryNote(score, findingsCount = 0) {
  const wq = Number(score);
  if (wq >= 80) return 'Your water meets international standards. Clean and balanced at every tap.';
  if (wq >= 60) return 'Clean water for daily use. A few small adjustments would bring it up to international quality.';
  if (findingsCount > 0) {
    return `${findingsCount} readings exceed recommended levels — affecting your skin, hair, and appliances.`;
  }
  return 'Your water quality needs attention.';
}

/**
 * Grapheme clusters, not UTF-16 code units -- a Thai base consonant plus its
 * vowel/tone marks (e.g. "น้ำ") must stay glued together or the character
 * fallback below would split a diacritic off its base char mid-glyph.
 * Intl.Segmenter is a Node/V8 built-in (no dependency); the code-point
 * spread is only a defensive fallback for a runtime without it.
 */
function graphemeClusters(text) {
  try {
    return Array.from(new Intl.Segmenter('th', { granularity: 'grapheme' }).segment(String(text)), (s) => s.segment);
  } catch {
    return [...String(text)];
  }
}

/**
 * Breaks one token that alone exceeds the per-line budget into grapheme-safe
 * chunks of at most maxCharsPerLine each. Thai (and other unspaced scripts)
 * arrives as a single giant "word" from wrapNote's whitespace split -- this
 * is what lets that run still wrap instead of overflowing the card as one
 * unbroken line. Reuses the same character-count budget wrapNote's word path
 * already uses, so it doesn't need its own separately-tuned threshold.
 */
function splitLongToken(token, maxCharsPerLine) {
  const clusters = graphemeClusters(token);
  const chunks = [];
  let current = '';
  for (const cluster of clusters) {
    if (current.length + cluster.length > maxCharsPerLine && current) {
      chunks.push(current);
      current = cluster;
    } else {
      current += cluster;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/**
 * Word-wraps on whitespace like before (unchanged for English/Latin note
 * text). A token wider than the whole line budget -- the common case for
 * unspaced Thai, since Thai has no spaces between words -- is additionally
 * split into grapheme-safe chunks via splitLongToken() first; those chunks
 * then flow through the exact same line-accumulation loop as ordinary words,
 * just without a joining space between chunks of the same original token
 * (there was no real word break there, only a forced line break).
 */
function wrapNote(text, maxCharsPerLine, maxLines = 3) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  outer:
  for (const word of words) {
    const pieces = word.length > maxCharsPerLine ? splitLongToken(word, maxCharsPerLine) : [word];
    for (let i = 0; i < pieces.length; i++) {
      const piece = pieces[i];
      const joiner = i === 0 && current ? ' ' : '';
      const next = `${current}${joiner}${piece}`;
      if (next.length > maxCharsPerLine && current) {
        lines.push(current);
        current = piece;
        if (lines.length >= maxLines) break outer;
      } else {
        current = next;
      }
    }
  }
  if (lines.length < maxLines && current) lines.push(current);
  return lines.slice(0, maxLines);
}

function resolveFormat(format) {
  const key = String(format || 'landscape').toLowerCase();
  if (key === 'facebook' || key === 'fb') {
    return { key: 'facebook', width: 1200, height: 1200, label: '1200×1200' };
  }
  if (key === 'og' || key === '1200x630') return FORMATS.landscape;
  if (key === 'ig' || key === '1080x1080') return FORMATS.square;
  if (key === 'story' || key === '1080x1920') return FORMATS.story;
  return FORMATS[key] || FORMATS.landscape;
}

function fillColorFor(verdict) {
  if (verdict.tier === 'high') return BRAND_BLUE;
  if (verdict.tier === 'mid') return BAR_GREEN;
  return '#F07B7B';
}

/** Intrinsic size straight from the PNG header, so <image> keeps its aspect. */
function pngSize(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const head = Buffer.alloc(24);
    fs.readSync(fd, head, 0, 24, 0);
    fs.closeSync(fd);
    if (head.toString('ascii', 12, 16) !== 'IHDR') return null;
    return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
  } catch {
    return null;
  }
}

// Same footprint as the static score-share-cta-badge.png asset it replaces,
// so both assetLayer() call sites (landscape/story) need no position changes.
const CTA_BADGE_W = 294;
const CTA_BADGE_H = 342;

/**
 * Per-Case CTA badge (2026-08-27): a customer scanning this QR now lands
 * directly on their own Case's LIFF bind link (auto-connects LINE, no
 * fb-xxxx typing) instead of a generic "add this OA as a friend" QR that's
 * identical for every customer. Rendered fresh every time -- no caching --
 * matching the rest of this module's "always re-render" model.
 */
async function renderDynamicCtaBadge(feedbackToken) {
  const url = buildLiffBindUrl(feedbackToken);
  if (!url) return null;

  const qrPng = await QRCode.toBuffer(url, {
    errorCorrectionLevel: 'M',
    margin: 0,
    width: 220,
    color: { dark: '#FFFFFFFF', light: '#00000000' }
  });
  const qrDataUri = `data:image/png;base64,${qrPng.toString('base64')}`;

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${CTA_BADGE_W}" height="${CTA_BADGE_H}" viewBox="0 0 ${CTA_BADGE_W} ${CTA_BADGE_H}">
  <rect x="0" y="0" width="${CTA_BADGE_W}" height="${CTA_BADGE_H}" rx="20" fill="${BRAND_BLUE}"/>
  <text x="24" y="44" fill="#FFFFFF" font-family="${FONT}" font-size="26" font-weight="700">Get your score</text>
  <image href="${qrDataUri}" x="37" y="66" width="220" height="220"/>
</svg>`;

  const sharp = require('sharp');
  const png = await sharp(Buffer.from(svg)).png({ compressionLevel: 8 }).toBuffer();
  return { href: `data:image/png;base64,${png.toString('base64')}`, size: { width: CTA_BADGE_W, height: CTA_BADGE_H } };
}

/**
 * Track split at the Thai (50) and international (80) thresholds, so the
 * gaps themselves read as the benchmarks the tick labels name.
 */
function progressBar(x, y, barW, barH, wq, fillColor) {
  const GAP = 7;
  const at = (pct) => x + (barW * pct) / 100;
  const knobX = at(wq);
  const segments = [[0, 50], [50, 80], [80, 100]];

  const draw = segments.map(([from, to]) => {
    const segX = at(from);
    const segEnd = at(to) - (to === 100 ? 0 : GAP);
    const track = `<rect x="${segX}" y="${y}" width="${segEnd - segX}" height="${barH}" rx="${barH / 2}" fill="${TRACK}"/>`;
    const fillEnd = Math.min(segEnd, knobX);
    if (fillEnd <= segX) return track;
    return `${track}<rect x="${segX}" y="${y}" width="${fillEnd - segX}" height="${barH}" rx="${barH / 2}" fill="${fillColor}"/>`;
  }).join('');

  return `${draw}<circle cx="${knobX}" cy="${y + barH / 2}" r="17" fill="#FFFFFF" filter="url(#knobShadow)"/>`;
}

/** Drawn at CARD_W x CARD_H; callers place it with translate + scale. */
function scoreCard({ score, verdict, note, indicators = 8 }) {
  const wq = Math.max(0, Math.min(100, Number(score) || 0));
  const pad = 26;
  const right = CARD_W - pad;
  const barW = CARD_W - pad * 2;
  const noteLines = wrapNote(note, 56, 2);
  const fill = fillColorFor(verdict);

  const ticks = [
    { at: 0, label: '0', anchor: 'start' },
    { at: 50, label: '50 · Thai', anchor: 'middle' },
    { at: 80, label: "80 · Int'l", anchor: 'middle' },
    { at: 100, label: '100', anchor: 'end' }
  ];

  return `
      <rect width="${CARD_W}" height="${CARD_H}" rx="20" fill="${CARD_BG}" filter="url(#cardShadow)"/>
      <text x="${pad}" y="55" fill="${DIM}" font-family="${FONT}" font-size="21" letter-spacing="0.02em">WATER SCORE</text>
      <text x="${right}" y="55" text-anchor="end" fill="${DIM}" font-family="${FONT}" font-size="21">${indicators} indicators</text>
      <text x="${pad}" y="150" fill="${INK}" font-family="${FONT}" font-size="68" font-weight="700" letter-spacing="-0.02em">${Math.round(wq)}</text>
      <text x="${right}" y="152" text-anchor="end" fill="${verdict.color}" font-family="${FONT}" font-size="34" font-weight="600">${escapeXml(verdict.label)}</text>
      ${progressBar(pad, 198, barW, 14, wq, fill)}
      ${ticks.map((t) => (
        `<text x="${pad + (barW * t.at) / 100}" y="254" text-anchor="${t.anchor}" fill="${DIM}" font-family="${FONT}" font-size="19">${escapeXml(t.label)}</text>`
      )).join('')}
      ${noteLines.map((line, i) => (
        `<text x="${pad}" y="${310 + i * 38}" fill="${NOTE_INK}" font-family="${FONT}" font-size="24">${escapeXml(line)}</text>`
      )).join('')}`;
}

function placedCard(x, y, width, opts, verdict, note) {
  return `
    <g transform="translate(${x},${y}) scale(${(width / CARD_W).toFixed(5)})">
      ${scoreCard({ score: opts.score, verdict, note, indicators: opts.indicators })}
    </g>`;
}

/** Places an asset by one dimension, deriving the other from its intrinsic aspect. */
function assetLayer(asset, { x, y, width, height, right, bottom }) {
  if (!asset?.href || !asset.size) return '';
  const aspect = asset.size.width / asset.size.height;
  const w = width != null ? width : height * aspect;
  const h = height != null ? height : width / aspect;
  const px = x != null ? x : right - w;
  const py = y != null ? y : bottom - h;
  return `<image href="${escapeXml(asset.href)}" x="${px}" y="${py}" width="${w}" height="${h}"/>`;
}

function headline(x, baseline, size, lineGap) {
  return `
  <text x="${x}" y="${baseline}" fill="${HEADLINE}" font-family="${FONT}" font-size="${size}" font-weight="700">SEE YOUR WATER</text>
  <text x="${x}" y="${baseline + lineGap}" fill="${HEADLINE}" font-family="${FONT}" font-size="${size}" font-weight="700">DIFFERENTLY.</text>`;
}

const SHARED_DEFS = `
    <filter id="cardShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#3F3F46" flood-opacity="0.18"/>
    </filter>
    <filter id="knobShadow" x="-100%" y="-100%" width="300%" height="300%">
      <feDropShadow dx="0" dy="1" stdDeviation="2" flood-color="#3F3F46" flood-opacity="0.35"/>
    </filter>`;

const SHARE_FLOORS = [
  ['Thailand', 65],
  ['WHO', 70],
  ['EU', 75],
  ['US EPA', 80],
  ['Japan', 85]
];

function shareHeadlineLines(score) {
  const wq = Number(score);
  if (SHARE_FLOORS.every(([, floor]) => wq >= floor)) {
    return ['Your tap water meets', 'international standards.'];
  }
  if (wq >= 65) {
    return ['Your tap water passes the Thai standard.', 'International? Not yet.'];
  }
  return ['Your tap water needs attention.', 'Some values are below target.'];
}

function shareBandLabel(score) {
  const wq = Number(score);
  if (wq >= 81) return 'Excellent';
  if (wq >= 65) return 'Good';
  if (wq >= 51) return 'Fair';
  return 'Needs attention';
}

function shareContextLine(job = {}) {
  const fields = job.draft?.fields || {};
  const city = String(fields['ci-city'] || '').trim();
  const property = String(fields['ci-proptype'] || '').trim();
  const rawDate = String(job.date || '').trim();
  const month = /^\d{4}-\d{2}/.test(rawDate)
    ? new Date(`${rawDate.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })
    : '';
  return [city, property, month].filter(Boolean).join(' · ');
}

/** Card box measured on the 1024×537 poster, scaled onto the 1200×630 plate. */
const FB_CARD_X = 280;
const FB_CARD_Y = 168;
const FB_CARD_W = 640;
const FB_CARD_H = 286;

function facebookScoreCard(opts) {
  const wq = Math.max(0, Math.min(100, Number(opts.score) || 0));
  const band = shareBandLabel(wq);
  const context = String(opts.contextLine || '').trim();
  const dots = 49;
  const dotGap = 11.7;
  const dotsX = 36;
  const rowYs = [162, 173, 185];
  const center = Math.round((wq / 100) * (dots - 1));
  const clusterX = dotsX + center * dotGap;
  const dotFill = (distance) => {
    if (distance <= 1) return '#7AADF0';
    if (distance === 2) return '#A9CCF6';
    if (distance === 3) return '#C5DCF5';
    if (distance === 4) return '#D7E7FA';
    return '#D6D6D4';
  };
  const dotMarks = rowYs.map((cy, row) => Array.from({ length: dots }, (_, i) => {
    if (row === 1 && i === center) return '';
    return `<circle cx="${(dotsX + i * dotGap).toFixed(1)}" cy="${cy}" r="2.7" fill="${dotFill(Math.abs(i - center))}"/>`;
  }).join('')).join('')
    + `<circle cx="${clusterX.toFixed(1)}" cy="${rowYs[1]}" r="5.6" fill="#FFFFFF"/>`
    + `<circle cx="${clusterX.toFixed(1)}" cy="${rowYs[1]}" r="2.9" fill="#4C92EA"/>`;
  const countries = SHARE_FLOORS.map(([name, floor], index) => {
    const x = 44 + index * 126;
    const passed = wq >= floor;
    const mark = passed
      ? `<circle cx="${x}" cy="250" r="9" fill="${BRAND_BLUE}"/><path d="M${x - 4.2} 250 l2.6 2.7 5.2-5.4" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>`
      : `<circle cx="${x}" cy="250" r="8" fill="none" stroke="#C8C6C2" stroke-width="1.6"/>`;
    return `${mark}<text x="${x + 16}" y="255" fill="${passed ? '#3A3836' : '#B5B2AD'}" font-family="${FONT}" font-size="16">${escapeXml(name)}</text>`;
  }).join('');
  const bandW = Math.max(96, band.length * 8.4 + 28);
  const bandX = Math.max(16, Math.min(FB_CARD_W - bandW - 16, clusterX - bandW / 2));
  const contextText = context
    ? `<text x="${FB_CARD_W / 2}" y="42" text-anchor="middle" fill="#8A8681" font-family="${FONT}" font-size="15">${escapeXml(context)}</text>`
    : '';

  const chrome = opts.chrome !== false ? `<rect width="${FB_CARD_W}" height="${FB_CARD_H}" rx="22" fill="#F7F8F9" filter="url(#fbCardShadow)"/>` : '';
  return `
    ${chrome}
    ${contextText}
    <text x="328" y="108" text-anchor="end" fill="${INK}" font-family="${FONT}" font-size="56" font-weight="700" letter-spacing="-1.5">${Math.round(wq)}</text>
    <text x="346" y="108" fill="#B0ACA6" font-family="${FONT}" font-size="20">/100</text>
    <rect x="${bandX.toFixed(1)}" y="122" width="${bandW}" height="36" rx="18" fill="#E4EEFC"/>
    <text x="${(bandX + bandW / 2).toFixed(1)}" y="145" text-anchor="middle" fill="${BRAND_BLUE}" font-family="${FONT}" font-size="15" font-weight="600">${escapeXml(band)}</text>
    ${dotMarks}
    <text x="${dotsX}" y="211" fill="#A7A39E" font-family="${FONT}" font-size="13">0</text>
    <text x="${(dotsX + (dots - 1) * dotGap * 0.8).toFixed(1)}" y="211" text-anchor="middle" fill="#A7A39E" font-family="${FONT}" font-size="13">80 · Int'l</text>
    <text x="${(dotsX + (dots - 1) * dotGap).toFixed(1)}" y="211" text-anchor="end" fill="#A7A39E" font-family="${FONT}" font-size="13">100</text>
    ${countries}`;
}

/** Landscape plate sits on the water poster. QR, wordmark, and droplets stay in that image. */
function buildLandscapeSvg(opts) {
  const { width, height } = FORMATS.landscape;
  const lines = shareHeadlineLines(opts.score);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <filter id="fbCardShadow" x="-8%" y="-8%" width="116%" height="124%">
      <feDropShadow dx="0" dy="8" stdDeviation="12" flood-color="#1C1917" flood-opacity="0.08"/>
    </filter>
  </defs>
  <text x="41" y="70" fill="${INK}" font-family="${FONT}" font-size="36" font-weight="700">${escapeXml(lines[0])}</text>
  <text x="41" y="114" fill="${INK}" font-family="${FONT}" font-size="36" font-weight="700">${escapeXml(lines[1])}</text>
  <g transform="translate(${FB_CARD_X},${FB_CARD_Y})">
    ${facebookScoreCard(opts)}
  </g>
</svg>`;
}

/**
 * Mobile story plate — full-bleed photo with score on the image and a
 * compact frosted insight panel sized to the copy (no tall empty glass).
 */
function storyPanelLayout(noteLineCount) {
  const width = FORMATS.story.width;
  const height = FORMATS.story.height;
  const lines = Math.max(1, Math.min(3, noteLineCount || 1));
  const pad = 36;
  const panelX = 48;
  const panelW = width - 96;
  const panelH = 160 + lines * 46;
  const ctaSize = 196;
  const ctaH = Math.round(ctaSize * (342 / 294));
  const footerTop = height - 56 - ctaH;
  const panelY = footerTop - 36 - panelH;
  const barY = panelY + 44;
  const barW = panelW - pad * 2;
  const noteStartY = panelY + 138;
  const scoreLabelY = panelY - 190;
  const scoreNumY = panelY - 32;
  const scoreMetaY = panelY - 64;
  return {
    width, height, pad, panelX, panelY, panelW, panelH, barY, barW,
    noteStartY, footerTop, scoreLabelY, scoreNumY, scoreMetaY, ctaSize, lines
  };
}

function buildStorySvg(opts) {
  const wq = Math.max(0, Math.min(100, Number(opts.score) || 0));
  const verdict = customerVerdict(wq);
  const note = opts.note || scoreSummaryNote(wq, opts.findingsCount);
  const noteLines = wrapNote(note, 36, 3);
  const fill = fillColorFor(verdict);
  const L = storyPanelLayout(noteLines.length);
  const knobX = L.panelX + L.pad + (L.barW * wq) / 100;
  const scoreDigits = String(Math.round(wq)).length;
  const denX = 56 + (scoreDigits >= 3 ? 290 : 200);
  const verdictX = denX + 108;
  const verdictSize = verdict.tier === 'low' ? 38 : 50;

  const ticks = [
    { at: 0, label: '0', anchor: 'start' },
    { at: 50, label: '50 · Thai', anchor: 'middle' },
    { at: 80, label: "80 · Int'l", anchor: 'middle' },
    { at: 100, label: '100', anchor: 'end' }
  ];

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${L.width}" height="${L.height}" viewBox="0 0 ${L.width} ${L.height}">
  <defs>
    ${SHARED_DEFS}
    <linearGradient id="storyScrimTop" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#000" stop-opacity="0.5"/>
      <stop offset="22%" stop-color="#000" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="storyScrimBottom" x1="0" y1="0" x2="0" y2="1">
      <stop offset="40%" stop-color="#000" stop-opacity="0"/>
      <stop offset="100%" stop-color="#000" stop-opacity="0.62"/>
    </linearGradient>
  </defs>
  <rect width="${L.width}" height="${L.height}" fill="url(#storyScrimTop)"/>
  <rect width="${L.width}" height="${L.height}" fill="url(#storyScrimBottom)"/>
  ${headline(56, 110, 54, 62)}
  <text x="56" y="${L.scoreLabelY}" fill="rgba(255,255,255,0.92)" font-family="${FONT}" font-size="24" letter-spacing="0.14em">WATER SCORE</text>
  <text x="56" y="${L.scoreNumY}" fill="#FFFFFF" font-family="${FONT}" font-size="148" font-weight="700" letter-spacing="-0.04em">${Math.round(wq)}</text>
  <text x="${denX}" y="${L.scoreMetaY}" fill="rgba(255,255,255,0.55)" font-family="${FONT}" font-size="38" font-weight="500">/100</text>
  <text x="${verdictX}" y="${L.scoreMetaY}" fill="${verdict.color}" font-family="${FONT}" font-size="${verdictSize}" font-weight="600">${escapeXml(verdict.label)}</text>
  <rect x="${L.panelX}" y="${L.panelY}" width="${L.panelW}" height="${L.panelH}" rx="26" fill="rgba(255,255,255,0.14)" stroke="rgba(255,255,255,0.28)" stroke-width="1.5"/>
  <rect x="${L.panelX + L.pad}" y="${L.barY}" width="${L.barW}" height="14" rx="7" fill="rgba(255,255,255,0.28)"/>
  <rect x="${L.panelX + L.pad}" y="${L.barY}" width="${Math.max(0, (L.barW * wq) / 100)}" height="14" rx="7" fill="${fill}"/>
  <circle cx="${knobX}" cy="${L.barY + 7}" r="16" fill="#FFFFFF" filter="url(#knobShadow)"/>
  ${ticks.map((t) => (
    `<text x="${L.panelX + L.pad + (L.barW * t.at) / 100}" y="${L.barY + 44}" text-anchor="${t.anchor}" fill="rgba(255,255,255,0.82)" font-family="${FONT}" font-size="22">${escapeXml(t.label)}</text>`
  )).join('')}
  ${noteLines.map((line, i) => (
    `<text x="${L.panelX + L.pad}" y="${L.noteStartY + 6 + i * 40}" fill="#FFFFFF" font-family="${FONT}" font-size="30">${escapeXml(line)}</text>`
  )).join('')}
  ${assetLayer(opts.ctaBadge, { x: 48, y: L.footerTop, width: L.ctaSize })}
  ${assetLayer(opts.wordmark, { right: L.width - 48, bottom: L.height - 52, height: 30 })}
</svg>`;
}

/** Full-bleed blurred wash — square social plate (no photo panel). */
function buildSquareSvg(opts) {
  const meta = FORMATS.square;
  const layout = {
    textX: 112, headlineBaseline: 172, headlineSize: 70, headlineGap: 82,
    cardX: 108, cardY: 389, cardW: 864, margin: 50, wordmarkH: 36
  };
  const verdict = customerVerdict(opts.score);
  const note = opts.note || scoreSummaryNote(opts.score, opts.findingsCount);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${meta.width}" height="${meta.height}" viewBox="0 0 ${meta.width} ${meta.height}">
  <defs>${SHARED_DEFS}</defs>
  ${headline(layout.textX, layout.headlineBaseline, layout.headlineSize, layout.headlineGap)}
  ${placedCard(layout.cardX, layout.cardY, layout.cardW, opts, verdict, note)}
  ${assetLayer(opts.wordmark, { right: meta.width - layout.margin, bottom: meta.height - layout.margin, height: layout.wordmarkH })}
</svg>`;
}

/**
 * Square and story plates use the same score card as the Facebook poster.
 * Coordinates are on the output canvas (1080 square, 1080×1920 story),
 * measured from the 1024 and 576 design frames.
 */
const DESIGNED_PLATES = {
  square: {
    width: 1080,
    height: 1080,
    bg: SQUARE_BG,
    radius: 34,
    card: { x: 109, y: 331, w: 863, h: 419 },
    erase: { x0: 50, x1: 710, y0: 70, y1: 300 },
    headlines: {
      thai: { x: 68, size: 60, lines: [
        { text: 'Your tap water passes', y: 122 },
        { text: 'the Thai standard.', y: 180 },
        { text: 'International? Not yet.', y: 266 }
      ] },
      pass: { x: 68, size: 60, lines: [
        { text: 'Your tap water meets', y: 122 },
        { text: 'international standards.', y: 180 }
      ] },
      attention: { x: 68, size: 60, lines: [
        { text: 'Your tap water needs', y: 122 },
        { text: 'attention.', y: 180 },
        { text: 'Some values are below', y: 248 },
        { text: 'target.', y: 304 }
      ] }
    }
  },
  story: {
    width: 1080,
    height: 1920,
    bg: STORY_BG,
    radius: 36,
    card: { x: 81, y: 707, w: 923, h: 506 },
    erase: { x0: 60, x1: 820, y0: 70, y1: 420 },
    headlines: {
      thai: { x: 81, size: 58, lines: [
        { text: 'Your tap water passes', y: 128 },
        { text: 'the Thai standard.', y: 202 },
        { text: 'International?', y: 314 },
        { text: 'Not yet.', y: 384 }
      ] },
      pass: { x: 81, size: 58, lines: [
        { text: 'Your tap water meets', y: 128 },
        { text: 'international standards.', y: 202 }
      ] },
      attention: { x: 81, size: 58, lines: [
        { text: 'Your tap water needs', y: 128 },
        { text: 'attention.', y: 202 },
        { text: 'Some values are', y: 314 },
        { text: 'below target.', y: 384 }
      ] }
    }
  }
};

function sharePlateBand(score) {
  const wq = Number(score);
  if (SHARE_FLOORS.every(([, floor]) => wq >= floor)) return 'pass';
  if (wq >= 65) return 'thai';
  return 'attention';
}

function buildDesignedPlateSvg(plateKey, opts) {
  const plate = DESIGNED_PLATES[plateKey];
  const spec = plate.headlines[sharePlateBand(opts.score)];
  const headline = spec.lines.map((line) => (
    `<text x="${spec.x}" y="${line.y}" fill="${INK}" font-family="${FONT}" font-size="${spec.size}" font-weight="700">${escapeXml(line.text)}</text>`
  )).join('');
  const card = plate.card;
  const scale = card.w / FB_CARD_W;
  const drawnH = FB_CARD_H * scale;
  const cardY = card.y + (card.h - drawnH) / 2;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${plate.width}" height="${plate.height}" viewBox="0 0 ${plate.width} ${plate.height}">
  ${headline}
  <rect x="${card.x}" y="${card.y}" width="${card.w}" height="${card.h}" rx="${plate.radius}" fill="#F7F8F9"/>
  <g transform="translate(${card.x},${cardY.toFixed(2)}) scale(${scale.toFixed(4)})">
    ${facebookScoreCard({ ...opts, chrome: false })}
  </g>
</svg>`;
}

function buildShareCardSvg(format, options = {}) {
  const meta = resolveFormat(format);
  if (meta.key === 'story' && fs.existsSync(STORY_BG)) return { ...meta, svg: buildDesignedPlateSvg('story', options) };
  if (meta.key === 'square' && fs.existsSync(SQUARE_BG)) return { ...meta, svg: buildDesignedPlateSvg('square', options) };
  if (meta.key === 'story') return { ...meta, svg: buildStorySvg(options) };
  if (meta.key === 'square') return { ...meta, svg: buildSquareSvg(options) };
  return { ...meta, svg: buildLandscapeSvg(options) };
}

const PHOTO_FETCH_TIMEOUT_MS = 5000;
const PHOTO_MAX_BYTES = 6 * 1024 * 1024;

/** Bounds a promise to PHOTO_FETCH_TIMEOUT_MS without rejecting — resolves '' on timeout so callers never throw. */
function withPhotoTimeout(promise) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(''), PHOTO_FETCH_TIMEOUT_MS))
  ]);
}

/** One retry: a single failed/empty attempt gets one more try before giving up. */
async function withOneRetry(attempt) {
  const first = await attempt();
  if (first) return first;
  return attempt();
}

async function fetchAsDataUri(url) {
  if (!url) return '';
  if (String(url).startsWith('data:')) return String(url);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PHOTO_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { redirect: 'follow', signal: controller.signal });
    if (!response.ok) return '';
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    if (!contentType.startsWith('image/')) return '';
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > PHOTO_MAX_BYTES) return '';
    return `data:${contentType};base64,${buffer.toString('base64')}`;
  } catch (error) {
    console.warn('[score-share-card] photo fetch failed', error.message);
    return '';
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Real customer photos are uploaded straight into the app's own Drive folder
 * tree — job.drive.latestFileId is the raw file id already sitting on every
 * job (mapper.js), untouched by whatever URL shape happens to be stored
 * alongside it. Fetching it in-process through the same OAuth Drive client
 * uploads already use is the only reliable path: the stored "latest file
 * URL" is Google's webViewLink (an HTML viewer page, not an image byte
 * stream), so a plain fetch against it always fails the content-type check
 * below and silently falls back to the stock photo.
 */
async function fetchDriveFileAsDataUri(fileId) {
  if (!fileId || !isDriveConfigured()) return '';
  try {
    const { buffer, contentType } = await downloadImageContent(fileId);
    if (!buffer?.length || buffer.length > PHOTO_MAX_BYTES) return '';
    const mime = contentType && contentType.startsWith('image/') ? contentType : 'image/jpeg';
    return `data:${mime};base64,${buffer.toString('base64')}`;
  } catch (error) {
    console.warn('[score-share-card] drive photo fetch failed', error.message);
    return '';
  }
}

async function resolvePhotoDataUri(options = {}) {
  if (options.photoDataUri) return options.photoDataUri;

  if (options.photoFileId) {
    const fromDrive = await withOneRetry(() => withPhotoTimeout(fetchDriveFileAsDataUri(options.photoFileId)));
    if (fromDrive) return fromDrive;
  }

  if (options.photoUrl) {
    const fromUrl = await withOneRetry(() => withPhotoTimeout(fetchAsDataUri(options.photoUrl)));
    if (fromUrl) return fromUrl;
  }

  return fileToDataUri(DEFAULT_PHOTO, 'image/jpeg');
}

/**
 * Real site photos come in at wildly different exposures (bright bathroom
 * vs. dim under-sink shot). `sharp().normalize()` stretches each photo's own
 * histogram to full contrast, which looks harsh and can crush shadows/blow
 * highlights on photos that already use most of their range — it doesn't
 * reliably pull different photos toward each other, so it's not used here.
 * Instead: measure the photo's mean brightness and shift it (without
 * touching contrast) toward one fixed target, so every card reads at the
 * same overall exposure regardless of how the original was shot.
 */
const PHOTO_TARGET_MEAN = 148;
const PHOTO_BIAS_CLAMP = 70;

async function normalizePhoto(sharp, photoBuf) {
  const stats = await sharp(photoBuf).stats();
  const currentMean = stats.channels.slice(0, 3).reduce((sum, c) => sum + c.mean, 0) / 3;
  const bias = Math.max(-PHOTO_BIAS_CLAMP, Math.min(PHOTO_BIAS_CLAMP, PHOTO_TARGET_MEAN - currentMean));

  return sharp(photoBuf)
    .linear(1, bias)
    .modulate({ saturation: 0.92 })
    .png()
    .toBuffer();
}

/**
 * Collapsing the photo to a handful of pixels before scaling it back up gives
 * the smooth colour wash of the design plate — a plain blur still leaves the
 * faucet readable as a dark smudge behind the card.
 */
async function buildBackdrop(sharp, photoBuf, width, height) {
  const seed = await sharp(photoBuf)
    .resize(28, 28, { fit: 'cover', position: 'centre' })
    .blur(5)
    .png()
    .toBuffer();

  return sharp(seed)
    .resize(width, height, { fit: 'fill', kernel: 'cubic' })
    .modulate({ brightness: 1.2, saturation: 0.18 })
    .linear(0.5, 104)
    .png()
    .toBuffer();
}

/**
 * The poster already has the sample headline painted on the water. Replace only
 * those dark glyphs with the surrounding water so the live sentence can sit
 * in the same place without a stretched patch.
 */
async function eraseBakedHeadline(sharp, base) {
  const { data, info } = await sharp(base).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const ch = info.channels;
  const x0 = 30;
  const x1 = 840;
  const y0 = 44;
  const y1 = 132;
  const yTop = 28;
  const yBot = 150;
  const at = (x, y) => (y * w + x) * ch;
  const lumAt = (i) => (data[i] + data[i + 1] + data[i + 2]) / 3;
  const ink = new Uint8Array(w * h);
  for (let y = y0; y < y1; y++) {
    const t = (y - yTop) / (yBot - yTop);
    for (let x = x0; x < x1; x++) {
      const i = at(x, y);
      const top = at(x, yTop);
      const bot = at(x, yBot);
      const expected = lumAt(top) * (1 - t) + lumAt(bot) * t;
      if (Math.abs(lumAt(i) - expected) > 14) ink[y * w + x] = 1;
    }
  }
  const dil = new Uint8Array(ink);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (!ink[y * w + x]) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) dil[(y + dy) * w + (x + dx)] = 1;
      }
    }
  }
  for (let y = y0 - 2; y < y1 + 2; y++) {
    const t = (y - yTop) / (yBot - yTop);
    for (let x = x0 - 2; x < x1 + 2; x++) {
      if (!dil[y * w + x]) continue;
      const top = at(x, yTop);
      const bot = at(x, yBot);
      const i = at(x, y);
      for (let c = 0; c < 3; c++) {
        data[i + c] = Math.round(data[top + c] * (1 - t) + data[bot + c] * t);
      }
    }
  }
  return sharp(data, { raw: { width: w, height: h, channels: ch } }).png().toBuffer();
}

/**
 * The square and story posters have the sample headline painted on the water.
 * Replace only those dark glyphs with the water beside them. A vertical blend
 * leaves a gray stripe where the droplet crosses the line.
 */
async function eraseBakedRegion(sharp, base, region) {
  const { data, info } = await sharp(base).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const ch = info.channels;
  const clamp = (value, max) => Math.max(0, Math.min(max - 1, Math.round(value)));
  const x0 = clamp(region.x0, w);
  const x1 = clamp(region.x1, w);
  const y0 = clamp(region.y0, h);
  const y1 = clamp(region.y1, h);
  const at = (x, y) => (y * w + x) * ch;
  const lumAt = (i) => (data[i] + data[i + 1] + data[i + 2]) / 3;
  const ink = new Uint8Array(w * h);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (lumAt(at(x, y)) < 155) ink[y * w + x] = 1;
    }
  }
  const dil = new Uint8Array(ink);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (!ink[y * w + x]) continue;
      for (let dy = -4; dy <= 4; dy++) {
        const yy = y + dy;
        if (yy < y0 || yy >= y1) continue;
        for (let dx = -4; dx <= 4; dx++) {
          const xx = x + dx;
          if (xx < x0 || xx >= x1) continue;
          dil[yy * w + xx] = 1;
        }
      }
    }
  }
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (!dil[y * w + x]) continue;
      let source = -1;
      for (let left = x - 1; left >= x0; left--) {
        if (!dil[y * w + left]) { source = left; break; }
      }
      if (source < 0) {
        for (let right = x + 1; right < x1; right++) {
          if (!dil[y * w + right]) { source = right; break; }
        }
      }
      if (source < 0) continue;
      const i = at(x, y);
      const s = at(source, y);
      data[i] = data[s];
      data[i + 1] = data[s + 1];
      data[i + 2] = data[s + 2];
    }
  }
  return sharp(data, { raw: { width: w, height: h, channels: ch } }).png().toBuffer();
}

let landscapeBasePromise = null;

function preparedLandscapeBase(sharp) {
  if (!landscapeBasePromise) {
    const { width, height } = FORMATS.landscape;
    landscapeBasePromise = (async () => {
      const resized = await sharp(FACEBOOK_BG)
        .resize(width, height, { fit: 'fill' })
        .png({ compressionLevel: 1 })
        .toBuffer();
      return eraseBakedHeadline(sharp, resized);
    })().catch((error) => {
      landscapeBasePromise = null;
      throw error;
    });
  }
  return landscapeBasePromise;
}

async function compositeLandscape(sharp, photoBuf, svgBuffer) {
  const { width, height } = FORMATS.landscape;
  let base;
  if (fs.existsSync(FACEBOOK_BG)) {
    base = await preparedLandscapeBase(sharp);
  } else {
    base = await sharp(photoBuf)
      .resize(width, height, { fit: 'fill' })
      .png()
      .toBuffer();
    base = await eraseBakedHeadline(sharp, base);
  }
  const composited = await sharp(base)
    .composite([{ input: svgBuffer, left: 0, top: 0 }])
    .png()
    .toBuffer();
  // Facebook crops a PNG that still has an alpha channel, even when every
  // pixel is opaque. Flatten onto the plate color so the file is plain RGB.
  return sharp(composited)
    .flatten({ background: '#FAFAF9' })
    .png({ compressionLevel: 4 })
    .toBuffer();
}

async function buildGlassPlate(sharp, photoBuf, x, y, w, h, radius = 32) {
  const roundedMask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
      <rect width="${w}" height="${h}" rx="${radius}" fill="#fff"/>
    </svg>`
  );
  const frosted = await sharp(photoBuf)
    .extract({ left: x, top: y, width: w, height: h })
    .blur(36)
    .modulate({ brightness: 1.12, saturation: 0.7 })
    .composite([
      {
        input: Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
            <rect width="${w}" height="${h}" rx="${radius}" fill="rgba(255,255,255,0.22)"/>
          </svg>`
        ),
        blend: 'over'
      }
    ])
    .png()
    .toBuffer();

  return sharp(frosted)
    .composite([{ input: roundedMask, blend: 'dest-in' }])
    .png()
    .toBuffer();
}

async function compositeStory(sharp, photoBuf, svgBuffer, options = {}) {
  const { width, height } = FORMATS.story;
  const photo = await sharp(photoBuf)
    .resize(width, height, { fit: 'cover', position: 'centre' })
    .modulate({ brightness: 0.9, saturation: 0.72 })
    .png()
    .toBuffer();

  const score = Number(options.score);
  const note = options.note || scoreSummaryNote(score, options.findingsCount);
  const noteLines = wrapNote(note, 36, 3);
  const L = storyPanelLayout(noteLines.length);
  const glass = await buildGlassPlate(sharp, photo, L.panelX, L.panelY, L.panelW, L.panelH, 28);

  return sharp(photo)
    .composite([
      { input: glass, left: L.panelX, top: L.panelY },
      { input: svgBuffer, left: 0, top: 0 }
    ])
    .png({ compressionLevel: 8 })
    .toBuffer();
}

async function compositeFullBleed(sharp, photoBuf, svgBuffer, meta) {
  const backdrop = await buildBackdrop(sharp, photoBuf, meta.width, meta.height);
  return sharp(backdrop)
    .composite([{ input: svgBuffer, left: 0, top: 0 }])
    .png({ compressionLevel: 8 })
    .toBuffer();
}

function loadAsset(filePath) {
  const size = pngSize(filePath);
  if (!size) return null;
  return { href: fileToDataUri(filePath, 'image/png'), size };
}

async function resolveCtaBadge(feedbackToken) {
  if (!feedbackToken) return loadAsset(CTA_BADGE_ASSET) || loadAsset(QR_ASSET);
  try {
    const dynamic = await renderDynamicCtaBadge(feedbackToken);
    if (dynamic) return dynamic;
  } catch (error) {
    console.warn('[score-share-card] dynamic QR badge failed, using static fallback', error.message);
  }
  return loadAsset(CTA_BADGE_ASSET) || loadAsset(QR_ASSET);
}

const landscapeResultCache = new Map();
const LANDSCAPE_CACHE_MAX = 30;

function landscapeCacheKey(options = {}) {
  const score = Math.round(Number(options.score) || 0);
  return `${score}|${String(options.contextLine || '').trim()}`;
}

const facebookResultCache = new Map();

async function renderFacebookPreview(options) {
  const key = landscapeCacheKey(options);
  const cached = facebookResultCache.get(key);
  if (cached?.png) return cached;
  if (cached?.promise) return cached.promise;
  const sharp = require('sharp');
  const promise = (async () => {
    const plate = await renderShareCardPng('landscape', options);
    const canvas = 1200;
    const plateHeight = FORMATS.landscape.height;
    const bar = Math.round((canvas - plateHeight) / 2);
    // The Facebook composer shows this image in a square and cover-crops
    // anything wider. The 1200×630 plate sits in the middle, so both the
    // square composer and the wide feed show the whole poster.
    const png = await sharp(plate.png)
      .extend({ top: bar, bottom: canvas - plateHeight - bar, extendWith: 'copy' })
      .flatten({ background: '#E6EEF3' })
      .png({ compressionLevel: 4 })
      .toBuffer();
    return { ...plate, key: 'facebook', width: canvas, height: canvas, png };
  })().catch((error) => {
    if (facebookResultCache.get(key)?.promise) facebookResultCache.delete(key);
    throw error;
  });
  facebookResultCache.set(key, { promise });
  const result = await promise;
  facebookResultCache.set(key, result);
  return result;
}

const designedPlateBases = new Map();

function preparedDesignedBase(sharp, plateKey) {
  const existing = designedPlateBases.get(plateKey);
  if (existing) return existing;
  const plate = DESIGNED_PLATES[plateKey];
  const promise = (async () => {
    const resized = await sharp(plate.bg)
      .resize(plate.width, plate.height, { fit: 'fill' })
      .png({ compressionLevel: 1 })
      .toBuffer();
    return eraseBakedRegion(sharp, resized, plate.erase);
  })().catch((error) => {
    designedPlateBases.delete(plateKey);
    throw error;
  });
  designedPlateBases.set(plateKey, promise);
  return promise;
}

const designedPlateCache = new Map();
const DESIGNED_CACHE_MAX = 30;

async function renderDesignedPlate(plateKey, options) {
  const key = `${plateKey}|${landscapeCacheKey(options)}`;
  const cached = designedPlateCache.get(key);
  if (cached?.png) return cached;
  if (cached?.promise) return cached.promise;
  const sharp = require('sharp');
  const plate = DESIGNED_PLATES[plateKey];
  const promise = (async () => {
    const built = buildShareCardSvg(plateKey, {
      ...options,
      score: Number(options.score),
      indicators: options.indicators || 8
    });
    const base = await preparedDesignedBase(sharp, plateKey);
    const composited = await sharp(base)
      .composite([{ input: Buffer.from(built.svg), left: 0, top: 0 }])
      .png()
      .toBuffer();
    const png = await sharp(composited)
      .flatten({ background: '#E6EEF3' })
      .png({ compressionLevel: 4 })
      .toBuffer();
    return { ...built, png };
  })().catch((error) => {
    if (designedPlateCache.get(key)?.promise) designedPlateCache.delete(key);
    throw error;
  });
  designedPlateCache.set(key, { promise });
  const result = await promise;
  designedPlateCache.delete(key);
  designedPlateCache.set(key, result);
  while (designedPlateCache.size > DESIGNED_CACHE_MAX) {
    const oldest = designedPlateCache.keys().next().value;
    designedPlateCache.delete(oldest);
  }
  return result;
}

async function renderShareCardPng(format, options = {}) {
  ensureFontconfig();
  const sharp = require('sharp');
  const formatMeta = resolveFormat(format);
  if (formatMeta.key === 'facebook') return renderFacebookPreview(options);
  if (formatMeta.key === 'square' && fs.existsSync(SQUARE_BG)) return renderDesignedPlate('square', options);
  if (formatMeta.key === 'story' && fs.existsSync(STORY_BG)) return renderDesignedPlate('story', options);
  // The landscape plate is the water poster. Waiting on a Drive photo here
  // only delays the image Facebook has to fetch while the post is composed.
  if (formatMeta.key === 'landscape' && fs.existsSync(FACEBOOK_BG)) {
    const key = landscapeCacheKey(options);
    const cached = landscapeResultCache.get(key);
    if (cached?.png) return { ...cached.built, png: cached.png };
    if (cached?.promise) return cached.promise;
    const promise = (async () => {
      const built = buildShareCardSvg(format, {
        ...options,
        score: Number(options.score),
        indicators: options.indicators || 8
      });
      const png = await compositeLandscape(sharp, null, Buffer.from(built.svg));
      const result = { ...built, png };
      landscapeResultCache.delete(key);
      landscapeResultCache.set(key, { png, built });
      while (landscapeResultCache.size > LANDSCAPE_CACHE_MAX) {
        const oldest = landscapeResultCache.keys().next().value;
        landscapeResultCache.delete(oldest);
      }
      return result;
    })().catch((error) => {
      if (landscapeResultCache.get(key)?.promise) landscapeResultCache.delete(key);
      throw error;
    });
    landscapeResultCache.set(key, { promise });
    return promise;
  }
  const photoDataUri = await resolvePhotoDataUri(options);
  const built = buildShareCardSvg(format, {
    ...options,
    score: Number(options.score),
    indicators: options.indicators || 8,
    ctaBadge: await resolveCtaBadge(options.feedbackToken),
    wordmark: loadAsset(WORDMARK_ASSET)
  });
  const svgBuffer = Buffer.from(built.svg);
  const photoBuf = dataUriToBuffer(photoDataUri);

  const compositeWithPhoto = async (buf) => {
    const normalizedPhotoBuf = await normalizePhoto(sharp, buf);
    if (built.key === 'landscape') {
      return compositeLandscape(sharp, normalizedPhotoBuf, svgBuffer);
    }
    if (built.key === 'story') {
      return compositeStory(sharp, normalizedPhotoBuf, svgBuffer, {
        score: Number(options.score),
        note: options.note,
        findingsCount: options.findingsCount
      });
    }
    return compositeFullBleed(sharp, normalizedPhotoBuf, svgBuffer, built);
  };

  let png;
  if (!photoBuf) {
    png = await sharp(svgBuffer).png({ compressionLevel: 8 }).toBuffer();
  } else {
    try {
      png = await compositeWithPhoto(photoBuf);
    } catch (error) {
      // A resolved photo that sharp/libvips can't decode (e.g. an
      // unsupported format) must never fail the whole render — fall back
      // to the known-good stock photo instead of throwing.
      console.warn('[score-share-card] photo compositing failed, using stock photo', error.message);
      try {
        const stockBuf = dataUriToBuffer(fileToDataUri(DEFAULT_PHOTO, 'image/jpeg'));
        png = await compositeWithPhoto(stockBuf);
      } catch (fallbackError) {
        console.warn('[score-share-card] stock photo compositing failed, rendering without a photo', fallbackError.message);
        png = await sharp(svgBuffer).png({ compressionLevel: 8 }).toBuffer();
      }
    }
  }

  return { ...built, png };
}

function driveFileIdFromUrl(url) {
  const match = String(url || '').match(/\/api\/drive\/images\/([^/?#]+)\/content/i);
  return match ? decodeURIComponent(match[1]) : '';
}

/** One committed site photo. Data URLs are previews and are not a share photo. */
function usableSitePhoto(photo) {
  if (!photo) return null;
  if (typeof photo === 'string') {
    const trimmed = photo.trim();
    if (!trimmed || trimmed.startsWith('data:')) return null;
    const fileId = driveFileIdFromUrl(trimmed);
    return fileId ? { fileId, contentUrl: '' } : { fileId: '', contentUrl: trimmed };
  }
  if (typeof photo !== 'object') return null;
  const rawUrl = String(photo.contentUrl || '').trim();
  const usableUrl = rawUrl && !rawUrl.startsWith('data:') ? rawUrl : '';
  const fileId = String(photo.fileId || '').trim() || driveFileIdFromUrl(usableUrl);
  const contentUrl = fileId && driveFileIdFromUrl(usableUrl) ? '' : usableUrl;
  if (!fileId && !contentUrl) return null;
  return { fileId, contentUrl };
}

/**
 * Site photo for whichever Case this card is rendering. Walks every tap,
 * in the same order as the score page: tap photo, visual, meter, then a
 * meter-session photo. A Case with none of those keeps the previous
 * fallback (latest Drive file, otherwise the stock faucet).
 */
function caseSitePhoto(job) {
  const taps = Array.isArray(job?.draft?.tapData) ? job.draft.tapData : [];
  for (const tap of taps) {
    const photos = tap?.photos || {};
    for (const key of ['tapphoto', 'visual', 'meter']) {
      const found = usableSitePhoto(photos[key]);
      if (found) return found;
    }
    const meterImages = Array.isArray(tap?.meterImages) ? tap.meterImages : [];
    for (const entry of meterImages) {
      const found = usableSitePhoto(entry?.photo || entry);
      if (found) return found;
    }
  }
  return null;
}

function cardOptionsFromJob(job = {}, overrides = {}) {
  // Strict presence, not bare coercion -- see api/public-routes.js's
  // route-level guard for the same reasoning. This helper has exactly one
  // caller today (that guarded route), but must not silently default to a
  // fake 0 for a null score if it's ever called directly in the future.
  const rawScore = overrides.score != null ? overrides.score : job.result?.waterScore;
  const score = rawScore !== null && rawScore !== undefined ? Number(rawScore) : NaN;
  const findingsCount = Number(overrides.findingsCount || 0);
  // Prefer the designed customer note. Stale Notion summaries like
  // "Water score 65/100" must not overwrite the card copy.
  const rawSummary = String(overrides.note || job.result?.summary || '').trim();
  const noteLooksLikeScoreLabel = /^water\s*score\s*\d+\s*\/\s*100$/i.test(rawSummary);
  const note = (!noteLooksLikeScoreLabel && rawSummary)
    ? rawSummary
    : scoreSummaryNote(score, findingsCount);
  const sitePhoto = caseSitePhoto(job);
  return {
    score: Number.isFinite(score) ? score : 0,
    contextLine: overrides.contextLine || shareContextLine(job),
    note,
    findingsCount,
    indicators: overrides.indicators || 8,
    photoFileId: overrides.photoFileId || (sitePhoto ? sitePhoto.fileId : (job.drive?.latestFileId || '')),
    photoUrl: overrides.photoUrl || (sitePhoto ? sitePhoto.contentUrl : (job.drive?.latestFileUrl || '')),
    photoDataUri: overrides.photoDataUri || '',
    feedbackToken: overrides.feedbackToken || job.feedback?.token || ''
  };
}

if (fs.existsSync(FACEBOOK_BG)) {
  try { preparedLandscapeBase(require('sharp')); } catch { landscapeBasePromise = null; }
}
if (fs.existsSync(SQUARE_BG)) {
  try { preparedDesignedBase(require('sharp'), 'square'); } catch { designedPlateBases.delete('square'); }
}
if (fs.existsSync(STORY_BG)) {
  try { preparedDesignedBase(require('sharp'), 'story'); } catch { designedPlateBases.delete('story'); }
}

module.exports = {
  FORMATS,
  resolveFormat,
  customerVerdict,
  scoreSummaryNote,
  buildShareCardSvg,
  renderShareCardPng,
  cardOptionsFromJob,
  fetchAsDataUri,
  resolvePhotoDataUri,
  // Test-only exports (2026-08-27, per-Case QR badge) -- same functions,
  // same behavior, just reachable from a test file.
  renderDynamicCtaBadge,
  resolveCtaBadge,
  // Test-only exports (2026-09-08, Thai/unspaced note wrapping) -- same
  // functions, same behavior, just reachable from a test file.
  wrapNote,
  splitLongToken
};
