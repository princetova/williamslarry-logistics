import {HttpError} from './http.js';

export function parsePagination(searchParams, {defaultLimit = 25, maxLimit = 100} = {}) {
  const rawPage = searchParams.get('page');
  const rawLimit = searchParams.get('limit');
  const page = rawPage == null || rawPage === '' ? 1 : Number(rawPage);
  const limit = rawLimit == null || rawLimit === '' ? defaultLimit : Number(rawLimit);
  if (!Number.isInteger(page) || page < 1 || page > 10_000) {
    throw new HttpError(422, 'Page must be an integer from 1 to 10000.');
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > maxLimit) {
    throw new HttpError(422, `Limit must be an integer from 1 to ${maxLimit}.`);
  }
  return {page, limit, offset: (page - 1) * limit};
}

export function optionalText(value, name, max) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') throw new HttpError(422, `${name} must be text.`);
  const cleaned = value.trim();
  if (!cleaned) return null;
  if ([...cleaned].length > max) throw new HttpError(422, `${name} is too long.`);
  if (/[\u0000-\u001F\u007F]/.test(cleaned)) throw new HttpError(422, `${name} contains unsupported characters.`);
  return cleaned;
}

export function optionalIsoDateTime(value, name, {endOfDay = false} = {}) {
  const cleaned = optionalText(value, name, 35);
  if (!cleaned) return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(cleaned);
  if (!dateOnly && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(cleaned)) {
    throw new HttpError(422, `${name} must be an ISO date or date-time.`);
  }
  const candidate = dateOnly
    ? `${cleaned}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`
    : cleaned;
  const parsed = Date.parse(candidate);
  if (Number.isNaN(parsed) || (dateOnly && new Date(parsed).toISOString().slice(0, 10) !== cleaned)) {
    throw new HttpError(422, `${name} must be an ISO date or date-time.`);
  }
  return new Date(parsed).toISOString();
}

export function validateDateRange(from, to) {
  if (from && to && from > to) throw new HttpError(422, 'From must not be later than to.');
}
