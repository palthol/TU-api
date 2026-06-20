import { REPORTING_VIEWS, REPORTING_VIEW_CONFIG } from '../routes/admin/reportingViews.js';

const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 200;
const MAX_OFFSET = 100000;

const parseNonNegativeInt = (raw) => {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
};

/**
 * Runs a whitelisted reporting view query. Returns a result object for route handlers.
 * @param {import('@supabase/supabase-js').SupabaseClient | null} supabase
 * @param {string} slug
 * @param {Record<string, string | undefined>} query
 */
export async function queryReportingView(supabase, slug, query) {
  if (!supabase) {
    return { status: 500, body: { ok: false, error: 'supabase_not_configured' } };
  }

  const normalizedSlug = String(slug || '').toLowerCase();
  const viewName = REPORTING_VIEWS[normalizedSlug];
  const cfg = REPORTING_VIEW_CONFIG[normalizedSlug];
  if (!viewName) {
    return {
      status: 400,
      body: {
        ok: false,
        error: 'unknown_view',
        allowed: Object.keys(REPORTING_VIEWS),
      },
    };
  }

  let limit = Number.parseInt(String(query.limit || ''), 10);
  if (!Number.isFinite(limit) || limit < 1) limit = DEFAULT_LIMIT;
  limit = Math.min(limit, MAX_LIMIT);
  let offset = Number.parseInt(String(query.offset || ''), 10);
  if (!Number.isFinite(offset) || offset < 0) offset = 0;
  offset = Math.min(offset, MAX_OFFSET);

  const sortRaw = String(query.sort || '').trim();
  const orderRaw = String(query.order || '').trim().toLowerCase();
  let order = null;
  if (orderRaw === 'asc' || orderRaw === 'desc') {
    order = orderRaw;
  }

  const sort = sortRaw || cfg?.defaultSort || null;
  if (sort && !cfg?.sortableColumns?.includes(sort)) {
    return {
      status: 400,
      body: {
        ok: false,
        error: 'invalid_sort_column',
        allowedSort: cfg?.sortableColumns ?? [],
      },
    };
  }
  if (orderRaw && !order) {
    return {
      status: 400,
      body: {
        ok: false,
        error: 'invalid_order',
        allowedOrder: ['asc', 'desc'],
      },
    };
  }

  const startRaw = String(query.start || '').trim();
  const endRaw = String(query.end || '').trim();
  const hasDateFilter = Boolean(startRaw || endRaw);
  if (hasDateFilter && !cfg?.dateColumn) {
    return {
      status: 400,
      body: {
        ok: false,
        error: 'date_filter_not_supported_for_view',
        slug: normalizedSlug,
      },
    };
  }
  const isIsoDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v);
  if (startRaw && !isIsoDate(startRaw)) {
    return { status: 400, body: { ok: false, error: 'invalid_start_date_format' } };
  }
  if (endRaw && !isIsoDate(endRaw)) {
    return { status: 400, body: { ok: false, error: 'invalid_end_date_format' } };
  }
  if (startRaw && endRaw && startRaw > endRaw) {
    return { status: 400, body: { ok: false, error: 'invalid_date_range' } };
  }

  let dbQuery = supabase.from(viewName).select('*');
  if (startRaw) dbQuery = dbQuery.gte(cfg.dateColumn, startRaw);
  if (endRaw) dbQuery = dbQuery.lte(cfg.dateColumn, endRaw);
  const appliedFilters = {};
  for (const [filterKey, filterCfg] of Object.entries(cfg?.filters ?? {})) {
    const raw = String(query[filterKey] || '').trim();
    if (!raw) continue;
    const value = parseNonNegativeInt(raw);
    if (value === null) {
      return {
        status: 400,
        body: {
          ok: false,
          error: 'invalid_filter_value',
          filter: filterKey,
          expected: 'non_negative_integer',
        },
      };
    }
    if (filterCfg.op === 'lte') dbQuery = dbQuery.lte(filterCfg.column, value);
    if (filterCfg.op === 'gte') dbQuery = dbQuery.gte(filterCfg.column, value);
    appliedFilters[filterKey] = value;
  }
  if (sort) dbQuery = dbQuery.order(sort, { ascending: order === 'asc' });
  dbQuery = dbQuery.range(offset, offset + limit - 1);

  const { data, error } = await dbQuery;
  if (error) {
    console.error('reporting view select', viewName, error);
    return { status: 400, body: { ok: false, error: error.message, view: viewName } };
  }

  const responseOrder = order || (sort ? 'desc' : null);
  return {
    status: 200,
    body: {
      ok: true,
      slug: normalizedSlug,
      view: viewName,
      limit,
      offset,
      sort,
      order: responseOrder,
      start: startRaw || null,
      end: endRaw || null,
      filters: appliedFilters,
      rowCount: Array.isArray(data) ? data.length : 0,
      rows: data ?? [],
    },
  };
}
