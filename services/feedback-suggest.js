/**
 * Feedback writing assistant — generates a short customer review draft.
 * Uses OpenAI when OPENAI_API_KEY is set; otherwise a context-aware local fallback.
 */

function clampRating(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 5;
  return Math.min(5, Math.max(1, Math.round(n)));
}

function pick(list, rand) {
  if (!Array.isArray(list) || !list.length) return '';
  return list[Math.floor(rand() * list.length)];
}

function capitalizeSentence(text) {
  const value = String(text || '').trim();
  if (!value) return '';
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function joinSentences(parts) {
  return parts
    .map(part => String(part || '').trim())
    .filter(Boolean)
    .map(part => capitalizeSentence(part.replace(/[.]+$/g, '')))
    .join('. ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.]*$/, '.');
}

function shuffle(list, rand) {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return function rand() {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFromContext(context = {}) {
  const raw = [
    Date.now(),
    context.variationSeed,
    context.rating,
    context.waterScore,
    context.technicianName,
    context.location,
    ...(context.findings || [])
  ].join('|');
  let hash = 2166136261;
  for (let i = 0; i < raw.length; i += 1) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function normalizeContext(input = {}) {
  const findings = Array.isArray(input.findings)
    ? input.findings.map(item => String(item || '').trim()).filter(Boolean).slice(0, 4)
    : [];
  const concerns = Array.isArray(input.concerns)
    ? input.concerns.map(item => String(item || '').trim()).filter(Boolean).slice(0, 4)
    : [];
  const scoreNum = Number(input.waterScore);
  return {
    rating: clampRating(input.rating),
    lang: String(input.lang || 'en').toLowerCase().startsWith('th') ? 'th' : 'en',
    technicianName: String(input.technicianName || '').trim(),
    location: String(input.location || input.clientArea || '').trim(),
    propertyType: String(input.propertyType || '').trim(),
    packageLabel: String(input.packageLabel || input.package || '').trim(),
    waterScore: Number.isFinite(scoreNum) ? Math.round(scoreNum) : null,
    findings,
    concerns,
    inspectionDone: Boolean(input.inspectionDone),
    scoreDone: Boolean(input.scoreDone),
    tapsCount: Number(input.tapsCount) || null,
    variationSeed: String(input.variationSeed || '')
  };
}

function ratingBrief(rating, lang) {
  const en = {
    5: 'warm, clearly positive experience',
    4: 'mostly positive with one small constructive note',
    3: 'balanced / mixed',
    2: 'polite and constructive about what fell short',
    1: 'issue-focused but still professional and calm'
  };
  const th = {
    5: 'เชิงบวกชัดเจน',
    4: 'ส่วนใหญ่ดี มีข้อเสนอเล็กน้อย',
    3: 'สมดุล / กลางๆ',
    2: 'สุภาพและให้ข้อเสนอแนะเชิงสร้างสรรค์',
    1: 'โฟกัสปัญหา แต่สุภาพและเป็นมืออาชีพ'
  };
  return (lang === 'th' ? th : en)[rating] || (lang === 'th' ? th[5] : en[5]);
}

function packagePhrase(pkg, lang) {
  const key = String(pkg || '').toLowerCase();
  if (!key) return '';
  if (lang === 'th') {
    if (key.includes('full')) return 'การประเมินแบบเต็ม';
    if (key.includes('essential') || key.includes('free')) return 'การตรวจ Water Score';
    return 'การเข้าบริการ';
  }
  if (key.includes('full')) return 'the full home assessment';
  if (key.includes('essential') || key.includes('free')) return 'the Water Score visit';
  return 'the visit';
}

function scorePhrase(score, lang) {
  if (!Number.isFinite(score)) return '';
  if (lang === 'th') return `คะแนนน้ำอยู่ที่ประมาณ ${score}/100`;
  return `Our Water Score came out around ${score}/100`;
}

function findingsPhrase(findings, lang) {
  if (!findings?.length) return '';
  const top = findings.slice(0, 2).join(lang === 'th' ? ' และ ' : ' and ');
  if (lang === 'th') return `โดยเฉพาะเรื่อง${top}`;
  return `What stood out most was ${top.toLowerCase()}`;
}

function buildFallbackSuggestion(rawContext = {}) {
  const ctx = normalizeContext(rawContext);
  const rand = mulberry32(seedFromContext(ctx));
  const tech = ctx.technicianName;
  const place = ctx.location;
  const scoreBit = scorePhrase(ctx.waterScore, ctx.lang);
  const findingBit = findingsPhrase(ctx.findings, ctx.lang);
  // Almost never surface measurements unless it feels like a natural aside.
  const allowMetricAside = rand() < 0.12 && ctx.rating <= 3;

  if (ctx.lang === 'th') {
    const openers = {
      5: [
        'ทีมเข้ามาให้คำปรึกษาชัดเจนและเป็นมิตรมาก',
        'รู้สึกอุ่นใจขึ้นหลังคุยเรื่องน้ำในบ้านครบๆ',
        'ได้คำอธิบายที่เข้าใจง่าย โดยไม่รู้สึกถูกเซลล์'
      ],
      4: [
        'โดยรวมแล้วประทับใจกับการเข้ามารอบนี้',
        'บริการดีและอธิบายเข้าใจง่าย',
        'ทีมใส่ใจ ส่วนใหญ่แล้วเป็นประสบการณ์ที่ดี'
      ],
      3: [
        'การเข้าบริการอยู่ในระดับโอเค',
        'ได้ประโยชน์บ้าง แต่ยังมีจุดที่อยากได้รายละเอียดเพิ่ม',
        'พอเข้าใจภาพรวมมากขึ้น แต่ยังไม่เคลียร์ทุกอย่าง'
      ],
      2: [
        'มีบางส่วนที่เป็นประโยชน์ แต่ยังไม่ตรงกับที่คาดไว้ทั้งหมด',
        'ทีมตั้งใจทำงาน แต่การสื่อสารยังไม่ชัดเท่าที่ควร',
        'ได้คำตอบบางส่วน แต่ยังอยากได้คำแนะนำที่เป็นรูปธรรมกว่านี้'
      ],
      1: [
        'วันนี้ยังไม่ตรงกับความคาดหวังของเรา',
        'อยากได้รับการอธิบายที่ชัดและต่อเนื่องกว่านี้',
        'ยังมีจุดที่ควรปรับปรุงในการดูแลลูกค้าและการอธิบาย'
      ]
    };
    const middles = shuffle([
      tech ? `${tech} อธิบายแบบเข้าใจง่าย ทำให้ถามต่อได้สบาย` : 'อธิบายแบบเข้าใจง่าย ทำให้ถามต่อได้สบาย',
      'ไม่เร่งรัด และฟังสิ่งที่เรากังวลจริงๆ',
      place ? `สำหรับบ้านย่าน${place} คำแนะนำรู้สึกเข้ากับไลฟ์สไตล์เรา` : null,
      'รู้สึกมั่นใจขึ้นว่าควรทำอะไรต่อ โดยไม่ถูกยัดเยียด',
      allowMetricAside && scoreBit ? scoreBit : null,
      allowMetricAside && findingBit ? findingBit : null
    ].filter(Boolean), rand).slice(0, 2 + Math.floor(rand() * 2));

    const closers = {
      5: [
        'รู้สึกมั่นใจในน้ำของบ้านมากขึ้น และยินดีแนะนำบริการนี้',
        'ขอบคุณสำหรับคำแนะนำที่ชัดเจน เราจะนำไปปรับใช้ต่อ',
        'โดยรวมแล้วคุ้มค่าและน่าเชื่อถือมาก'
      ],
      4: [
        'ถ้าสรุปขั้นตอนถัดไปให้กระชับอีกนิดจะสมบูรณ์แบบ',
        'โดยรวมประทับใจ แค่ต้องการรายละเอียดเล็กน้อยเพิ่มเติม',
        'ยังแนะนำได้ และอยากให้เก็บความละเอียดแบบนี้ต่อไป'
      ],
      3: [
        'มีประโยชน์ แต่ยังอยากได้แนวทางต่อที่ชัดกว่านี้',
        'พร้อมให้โอกาสอีกครั้งถ้าการอธิบายละเอียดขึ้น',
        'โดยรวมใช้ได้ แต่ยังไม่ถึงขั้นประทับใจมาก'
      ],
      2: [
        'หวังว่าครั้งหน้าจะสื่อสารผลและตัวเลือกแก้ไขให้ชัดกว่านี้',
        'ยังเปิดใจรับคำแนะนำ หากมีการติดตามผลที่ดีขึ้น',
        'ถ้าปรับปรุงการอธิบายและความต่อเนื่องแล้วจะดีขึ้นมาก'
      ],
      1: [
        'หวังว่าจะมีการติดตามและแก้ไขจุดที่ยังไม่ชัดให้ดีขึ้น',
        'อยากให้ทีมทบทวนการสื่อสารและการจัดการเวลา',
        'พร้อมให้ข้อมูลเพิ่มหากมีการติดตามอย่างจริงจัง'
      ]
    };

    const parts = [pick(openers[ctx.rating] || openers[5], rand), ...middles, pick(closers[ctx.rating] || closers[5], rand)];
    return parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  }

  const openers = {
    5: [
      'Honestly left feeling a lot clearer about our water.',
      'They took time with us and never made it feel salesy.',
      'We finally understand what matters for our home, in plain language.'
    ],
    4: [
      'Solid experience overall.',
      'Easy to follow and genuinely helpful.',
      'Mostly thorough and well paced.'
    ],
    3: [
      'Fine visit — useful in parts, less clear in others.',
      'Decent conversation, a few takeaways.',
      'Okay appointment. Still chewing on some of it.'
    ],
    2: [
      'Some of it helped, but it didn’t fully land for us.',
      'Polite team, yet a few explanations felt incomplete.',
      'We still wanted clearer next steps.'
    ],
    1: [
      'Didn’t meet what we hoped for.',
      'Communication needed to be clearer.',
      'Left with more questions than we came with.'
    ]
  };

  const middles = shuffle([
    tech
      ? `${tech} explained things in a way that actually made sense`
      : 'They explained things in a way that actually made sense',
    'Felt listened to, not rushed',
    place ? `For our place in ${place}, the advice felt relevant` : null,
    'More confidence, less jargon',
    ctx.propertyType ? `They got that we’re in a ${String(ctx.propertyType).toLowerCase()}` : null,
    allowMetricAside && scoreBit ? scoreBit : null,
    allowMetricAside && findingBit ? findingBit : null
  ].filter(Boolean), rand).slice(0, 2 + Math.floor(rand() * 2));

  const closers = {
    5: [
      'I feel more confident about the water our family uses every day.',
      'Clear guidance, no pressure — I’d recommend the experience.',
      'Helpful, grounded, and worth the time.'
    ],
    4: [
      'A slightly tighter summary of next steps would make it excellent.',
      'Still happy overall; just one or two details could be clearer.',
      'I’d book again, with a small ask for more concrete follow-up.'
    ],
    3: [
      'Useful enough, though I’d welcome a clearer plan for what to do next.',
      'Happy to continue if the recommendations come through more specifically.',
      'Not bad — just not fully conclusive for us yet.'
    ],
    2: [
      'Hoping the follow-up communication is clearer next time.',
      'More practical recommendations would go a long way.',
      'Open to another visit if the explanations are tightened up.'
    ],
    1: [
      'Please follow up with a clearer explanation and options.',
      'We’d like better pacing and clearer ownership of next steps.',
      'Happy to share more detail if there’s a proper follow-up.'
    ]
  };

  const parts = [pick(openers[ctx.rating] || openers[5], rand), ...middles, pick(closers[ctx.rating] || closers[5], rand)];
  return joinSentences(parts);
}

function aiConfigured() {
  return Boolean(String(process.env.OPENAI_API_KEY || '').trim());
}

function buildSystemPrompt(lang) {
  if (lang === 'th') {
    return [
      'คุณเขียนร่างรีวิวสั้นๆ ในฐานะเจ้าของบ้านที่เพิ่งรับบริการตรวจคุณภาพน้ำจาก Water Motion',
      'เขียนเหมือนคนคุยกับเพื่อนหรือพิมพ์รีวิวบนมือถือ — เป็นธรรมชาติ สุภาพ ไม่เป็นทางการเกิน',
      '',
      'สิ่งที่ลูกค้าส่วนใหญ่พูดถึง:',
      '- ความรู้สึกระหว่างการเข้ามา / การได้รับการดูแล',
      '- การอธิบายเข้าใจง่าย ความมั่นใจ ความสุภาพ ความตรงต่อเวลา',
      '- สิ่งที่ได้ประโยชน์จริงในชีวิตประจำวัน — ไม่ใช่ค่าวัดหรือระบบคะแนน',
      '',
      'ห้ามกล่าวถึงโดยค่าเริ่มต้น (เว้นแต่รู้สึกว่าลูกค้าคนนี้จะพูดถึงเองจริงๆ):',
      '- Water Score / DWQI / คะแนนตัวเลข',
      '- กระบวนการตรวจ / ขั้นตอนการ inspection',
      '- พารามิเตอร์ทางเทคนิค เช่น chlorine, turbidity, pH, TDS, ORP',
      'ถ้าไม่แน่ใจว่าจำเป็น — ไม่ต้องพูดถึง',
      '',
      'สไตล์:',
      '- น้ำเสียงสนทนา มีทั้งประโยคสั้นและยาวปนกัน',
      '- ขึ้นต้นประโยคไม่ซ้ำแบบเดิมทุกครั้ง',
      '- ใช้คำที่ต่างกันในแต่ละครั้ง สื่อว่าคนเขียนไม่ใช่คนเดิม',
      '- จากข้อมูลบริบท เลือกได้แค่ 0–2 จุดที่เกี่ยวกับประสบการณ์เท่านั้น',
      '- ไม่ต้องครบทุกหัวข้อ และอย่าไล่เรียงข้อมูลเหมือนรายงาน',
      '',
      'หลีกเลี่ยง:',
      '- ภาษาโฆษณา / คำเว่อร์ / ประโยคแม่แบบ',
      '- สำนวนที่ฟังเหมือน AI',
      '- การสรุปเป็นข้อๆ หรือพูดถึงตัวเองว่าเป็น AI',
      '- การแต่งเรื่องที่ไม่มีในบริบท',
      '',
      'ความยาวประมาณ 40–120 คำ',
      'ตอบเฉพาะข้อความรีวิวเท่านั้น — ไม่มีหัวข้อ ไม่มีคำพูด ไม่มีคำอธิบายนำ'
    ].join('\n');
  }
  return [
    'You write as a real homeowner who just had a Water Motion water-quality visit.',
    'Draft a short review in their own words — like someone typing on their phone after the appointment.',
    '',
    'What most customers actually talk about:',
    '- How the visit felt: clarity, care, confidence, friendliness, timing',
    '- Whether explanations made sense in everyday terms',
    '- What they took away for their home — not measurements or scoring systems',
    '',
    'Do NOT mention by default (only if this specific customer would naturally say it):',
    '- “Water Score”, DWQI, or numeric scores',
    '- The inspection process / testing workflow',
    '- Technical parameters (chlorine, turbidity, pH, TDS, ORP, etc.)',
    'If unsure whether it is needed — leave it out. Prefer experience over measurements.',
    '',
    'Voice:',
    '- Conversational and human. Mix short punchy sentences with one or two longer ones.',
    '- Vary openings every time. Do not default to “Today…”, “I appreciated…”, or “Overall…”.',
    '- Change vocabulary and rhythm so each draft feels like a different person wrote it.',
    '- Mention at most 0–2 concrete details from the context — only experience-relevant ones for this star rating.',
    '- Prefer specificity over completeness. Skipping context is better than listing it.',
    '',
    'Avoid:',
    '- Marketing language, slogans, or brochure tone',
    '- Obvious AI phrasing (“highly recommend this exceptional service”, “professional and comprehensive experience”, “seamless journey”)',
    '- Formulaic structure (setup → every detail → polished closer)',
    '- Bullet points, titles, labels, or saying you are an AI',
    '- Inventing installs, equipment, or results that are not in the context',
    '',
    'Length: about 40–120 words.',
    'Return ONLY the review text — no quotes, no preamble, no explanation.'
  ].join('\n');
}

function buildUserPrompt(ctx) {
  const experiencePool = [];
  if (ctx.technicianName) experiencePool.push(`person who helped: ${ctx.technicianName}`);
  if (ctx.location) experiencePool.push(`area: ${ctx.location}`);
  if (ctx.propertyType) experiencePool.push(`home type: ${ctx.propertyType}`);
  if (ctx.packageLabel) experiencePool.push(`visit type: ${ctx.packageLabel}`);
  if (ctx.concerns.length) experiencePool.push(`what they cared about beforehand: ${ctx.concerns.join('; ')}`);
  if (ctx.inspectionDone || ctx.scoreDone) {
    experiencePool.push('visit happened and they got an explanation of their water situation');
  }

  // Kept available but explicitly demoted — experience first, metrics last-resort only.
  const measurementPool = [];
  if (Number.isFinite(ctx.waterScore)) measurementPool.push(`Water Score number (usually omit): ${ctx.waterScore}/100`);
  if (ctx.findings.length) measurementPool.push(`technical notes (usually omit): ${ctx.findings.join('; ')}`);
  if (ctx.tapsCount) measurementPool.push(`taps checked count (usually omit): ${ctx.tapsCount}`);

  const lines = [
    `Write one ${ctx.lang === 'th' ? 'Thai' : 'English'} customer review draft.`,
    `Star rating to match: ${ctx.rating}/5 — ${ratingBrief(ctx.rating, ctx.lang)}.`,
    `Freshness token (force a new voice/wording): ${ctx.variationSeed || seedFromContext(ctx)}`,
    '',
    'Experience context (preferred — use at most 0–2 items, or none):',
    experiencePool.length ? experiencePool.map(item => `- ${item}`).join('\n') : '- (none provided)',
    '',
    'Measurement context (avoid unless it would sound completely natural for this customer):',
    measurementPool.length ? measurementPool.map(item => `- ${item}`).join('\n') : '- (none provided)',
    '',
    'Instructions:',
    '- Lead with experience and feelings, not process or numbers.',
    '- Do not mention Water Score, DWQI, inspection steps, or technical parameters unless truly natural.',
    '- When in doubt, skip measurement context entirely.',
    '- Never invent missing facts.',
    '- Sound like a different customer than the last generation.'
  ];
  return lines.join('\n');
}

async function suggestWithOpenAi(ctx) {
  const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) return null;

  const baseUrl = String(process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const model = String(process.env.OPENAI_MODEL || 'gpt-4o-mini').trim() || 'gpt-4o-mini';
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      temperature: 0.9,
      max_tokens: 280,
      messages: [
        { role: 'system', content: buildSystemPrompt(ctx.lang) },
        { role: 'user', content: buildUserPrompt(ctx) }
      ]
    })
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`OpenAI error ${response.status}: ${detail.slice(0, 200)}`);
  }

  const data = await response.json();
  const text = String(data?.choices?.[0]?.message?.content || '')
    .replace(/^["'\s]+|["'\s]+$/g, '')
    .replace(/^Here(?:'s| is)[^\n]*:\s*/i, '')
    .trim();
  if (!text) throw new Error('Empty AI suggestion');
  return text;
}

async function suggestFeedback(rawContext = {}) {
  const ctx = normalizeContext({
    ...rawContext,
    variationSeed: rawContext.variationSeed || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  });

  if (aiConfigured()) {
    try {
      const text = await suggestWithOpenAi(ctx);
      return { text, source: 'ai', rating: ctx.rating };
    } catch (error) {
      console.warn('[feedback-suggest] AI unavailable, using fallback:', error.message);
    }
  }

  return {
    text: buildFallbackSuggestion(ctx),
    source: 'fallback',
    rating: ctx.rating
  };
}

module.exports = {
  suggestFeedback,
  buildFallbackSuggestion,
  aiConfigured,
  normalizeContext
};
