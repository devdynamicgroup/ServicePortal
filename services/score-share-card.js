/**
 * Water Score share cards for LINE / social (3 formats).
 * Matches the approved design plate:
 *  - left/top: site photo (default faucet plate when missing)
 *  - right/bottom: blurred photo wash + headline + dynamic score card
 *  - static QR CTA + Water Motion wordmark
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

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

  return `${draw}<circle cx="${knobX}" cy="${y + barH / 2}" r="15" fill="#FFFFFF" filter="url(#knobShadow)"/>`;
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
      ${progressBar(pad, 198, barW, 10, wq, fill)}
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

/** Photo left, blurred wash right. Photo/backdrop are composited with sharp. */
function buildLandscapeSvg(opts) {
  const { width, height } = FORMATS.landscape;
  const verdict = customerVerdict(opts.score);
  const note = opts.note || scoreSummaryNote(opts.score, opts.findingsCount);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>${SHARED_DEFS}</defs>
  ${headline(662, 103, 48, 51)}
  ${placedCard(660, 216, 480, opts, verdict, note)}
  ${assetLayer(opts.ctaBadge, { x: 30, y: 428, width: 146 })}
  ${assetLayer(opts.wordmark, { right: width - 28, bottom: height - 22, height: 20 })}
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
  <rect x="${L.panelX + L.pad}" y="${L.barY}" width="${L.barW}" height="10" rx="5" fill="rgba(255,255,255,0.28)"/>
  <rect x="${L.panelX + L.pad}" y="${L.barY}" width="${Math.max(0, (L.barW * wq) / 100)}" height="10" rx="5" fill="${fill}"/>
  <circle cx="${knobX}" cy="${L.barY + 5}" r="13" fill="#FFFFFF" filter="url(#knobShadow)"/>
  ${ticks.map((t) => (
    `<text x="${L.panelX + L.pad + (L.barW * t.at) / 100}" y="${L.barY + 40}" text-anchor="${t.anchor}" fill="rgba(255,255,255,0.82)" font-family="${FONT}" font-size="22">${escapeXml(t.label)}</text>`
  )).join('')}
  ${noteLines.map((line, i) => (
    `<text x="${L.panelX + L.pad}" y="${L.noteStartY + i * 40}" fill="#FFFFFF" font-family="${FONT}" font-size="30">${escapeXml(line)}</text>`
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

function buildShareCardSvg(format, options = {}) {
  const meta = resolveFormat(format);
  if (meta.key === 'story') return { ...meta, svg: buildStorySvg(options) };
  if (meta.key === 'square') return { ...meta, svg: buildSquareSvg(options) };
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

async function compositeLandscape(sharp, photoBuf, svgBuffer) {
  const { width, height } = FORMATS.landscape;
  // Mock plate is ~40.6% photo / 59.4% wash.
  const photoW = 488;
  const backdrop = await buildBackdrop(sharp, photoBuf, width, height);
  const leftPhoto = await sharp(photoBuf)
    .resize(photoW, height, { fit: 'cover', position: 'centre' })
    .png()
    .toBuffer();

  return sharp(backdrop)
    .composite([
      { input: leftPhoto, left: 0, top: 0 },
      { input: svgBuffer, left: 0, top: 0 }
    ])
    .png({ compressionLevel: 8 })
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

async function renderShareCardPng(format, options = {}) {
  ensureFontconfig();
  const sharp = require('sharp');
  const photoDataUri = await resolvePhotoDataUri(options);
  const built = buildShareCardSvg(format, {
    ...options,
    score: Number(options.score),
    indicators: options.indicators || 8,
    ctaBadge: loadAsset(CTA_BADGE_ASSET) || loadAsset(QR_ASSET),
    wordmark: loadAsset(WORDMARK_ASSET)
  });
  const svgBuffer = Buffer.from(built.svg);
  const photoBuf = dataUriToBuffer(photoDataUri);

  let png;
  if (!photoBuf) {
    png = await sharp(svgBuffer).png({ compressionLevel: 8 }).toBuffer();
  } else {
    const normalizedPhotoBuf = await normalizePhoto(sharp, photoBuf);
    if (built.key === 'landscape') {
      png = await compositeLandscape(sharp, normalizedPhotoBuf, svgBuffer);
    } else if (built.key === 'story') {
      png = await compositeStory(sharp, normalizedPhotoBuf, svgBuffer, {
        score: Number(options.score),
        note: options.note,
        findingsCount: options.findingsCount
      });
    } else {
      png = await compositeFullBleed(sharp, normalizedPhotoBuf, svgBuffer, built);
    }
  }

  return { ...built, png };
}

function cardOptionsFromJob(job = {}, overrides = {}) {
  const score = Number(
    overrides.score != null ? overrides.score : job.result?.waterScore
  );
  const findingsCount = Number(overrides.findingsCount || 0);
  // Prefer the designed customer note. Stale Notion summaries like
  // "Water score 65/100" must not overwrite the card copy.
  const rawSummary = String(overrides.note || job.result?.summary || '').trim();
  const noteLooksLikeScoreLabel = /^water\s*score\s*\d+\s*\/\s*100$/i.test(rawSummary);
  const note = (!noteLooksLikeScoreLabel && rawSummary)
    ? rawSummary
    : scoreSummaryNote(score, findingsCount);
  return {
    score: Number.isFinite(score) ? score : 0,
    note,
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
