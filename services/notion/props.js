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

function getPropertyValue(properties, aliases, fallback = '') {
  const key = findPropertyKey(properties, aliases);
  if (!key) return fallback;
  const prop = properties[key];
  if (!prop || !prop.type) return fallback;

  switch (prop.type) {
    case 'title':
      return readPlainText(prop.title) || fallback;
    case 'rich_text':
      return readPlainText(prop.rich_text) || fallback;
    case 'number':
      return prop.number == null ? fallback : prop.number;
    case 'checkbox':
      return Boolean(prop.checkbox);
    case 'select':
      return prop.select?.name || fallback;
    case 'status':
      return prop.status?.name || fallback;
    case 'phone_number':
      return prop.phone_number || fallback;
    case 'email':
      return prop.email || fallback;
    case 'url':
      return prop.url || fallback;
    case 'date':
      return prop.date?.start || fallback;
    case 'created_time':
      return prop.created_time || fallback;
    case 'multi_select':
      return (prop.multi_select || []).map(item => item.name).filter(Boolean).join(', ') || fallback;
    case 'formula':
      if (prop.formula?.type === 'string') return prop.formula.string || fallback;
      if (prop.formula?.type === 'number') return prop.formula.number == null ? fallback : prop.formula.number;
      if (prop.formula?.type === 'boolean') return Boolean(prop.formula.boolean);
      return fallback;
    default:
      return fallback;
  }
}

module.exports = { findPropertyKey, getPropertyValue, normalizeKey };
