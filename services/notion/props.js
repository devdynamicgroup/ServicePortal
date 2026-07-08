function normalizeKey(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function findPropertyKey(properties, aliases) {
  if (!properties) return null;
  const keys = Object.keys(properties);
  const normalized = new Map(keys.map(key => [normalizeKey(key), key]));
  for (const alias of aliases) {
    const hit = normalized.get(normalizeKey(alias));
    if (hit) return hit;
  }
  return null;
}

function readPlainText(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(readPlainText).filter(Boolean).join(' ');
  if (value.plain_text) return value.plain_text;
  if (value.text?.content) return value.text.content;
  return '';
}

const EMPTY = Symbol('empty');

function readPropValue(prop) {
  if (!prop || !prop.type) return EMPTY;

  switch (prop.type) {
    case 'title': {
      const v = readPlainText(prop.title);
      return v || EMPTY;
    }
    case 'rich_text': {
      const v = readPlainText(prop.rich_text);
      return v || EMPTY;
    }
    case 'number':
      return prop.number == null ? EMPTY : prop.number;
    case 'checkbox':
      return Boolean(prop.checkbox);
    case 'select':
      return prop.select?.name || EMPTY;
    case 'status':
      return prop.status?.name || EMPTY;
    case 'phone_number':
      return prop.phone_number || EMPTY;
    case 'email':
      return prop.email || EMPTY;
    case 'url':
      return prop.url || EMPTY;
    case 'date':
      return prop.date?.start || EMPTY;
    case 'created_time':
      return prop.created_time || EMPTY;
    case 'multi_select': {
      const v = (prop.multi_select || []).map(item => item.name).filter(Boolean).join(', ');
      return v || EMPTY;
    }
    case 'formula':
      if (prop.formula?.type === 'string') return prop.formula.string || EMPTY;
      if (prop.formula?.type === 'number') return prop.formula.number == null ? EMPTY : prop.formula.number;
      if (prop.formula?.type === 'boolean') return Boolean(prop.formula.boolean);
      return EMPTY;
    default:
      return EMPTY;
  }
}

// Try each alias in order and return the first NON-EMPTY value. A property key
// that exists but holds an empty value (e.g. an empty date) is skipped so the
// next alias can be used.
function getPropertyValue(properties, aliases, fallback = '') {
  if (!properties) return fallback;
  const normalized = new Map(Object.keys(properties).map(key => [normalizeKey(key), key]));

  for (const alias of aliases) {
    const key = normalized.get(normalizeKey(alias));
    if (!key) continue;
    const value = readPropValue(properties[key]);
    if (value !== EMPTY) return value;
  }
  return fallback;
}

module.exports = { findPropertyKey, getPropertyValue, normalizeKey };
