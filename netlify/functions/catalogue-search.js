// Netlify Function: catalogue-search
// Searches Simpro catalogue items by supplier group + keyword
// Group filter is REQUIRED — unfiltered global catalogue returns blank items
// Strategy: fetch all items from group, then filter in-memory by search term

const https = require('https');

const API_KEY = '8222557f31f04c8f626568f88bc5c8458215078e';
const BASE_HOST = '2ndfix.simprosuite.com';
const BASE_PATH = '/api/v1.0/companies/3';

// ALL confirmed 2nd Fix Simpro catalogue supplier groups (May 2026)
const SUPPLIER_GROUPS = {
  'zanda':              { id: 8,     label: 'Zanda' },
  'tradco':             { id: 39,    label: 'Tradco Hardware' },
  'superior-brass':     { id: 1061,  label: 'Superior Brass' },
  'nidus':              { id: 10,    label: 'Nidus' },
  'trio':               { id: 786,   label: 'Trio Hardware' },
  'n2lok':              { id: 118,   label: 'N2Lok Hardware' },
  'four-seas':          { id: 382,   label: 'Four Seas' },
  'mcgrath':            { id: 8469,  label: 'LSC - McGrath' },
  'domino-brass':       { id: 49,    label: 'Domino Brass' },
  'allegion-brio':      { id: 115,   label: 'Allegion / Brio' },
  'distinction':        { id: 38,    label: 'Distinction' },
  'lock-and-handle':    { id: 6880,  label: 'Lock and Handle' },
  'raven':              { id: 95,    label: 'Raven Products' },
  'cowdroy':            { id: 928,   label: 'Cowdroy' },
  'sabs':               { id: 0,     label: 'SABS' },  // placeholder — check if group exists
  'centor':             { id: 19,    label: 'Centor Screens' },
  'freedom-screens':    { id: 7028,  label: 'Freedom Screens' },
  'hume':               { id: 1241,  label: 'Hume Doors & Timber' },
  'corinthian':         { id: 1898,  label: 'Corinthian Industries' },
  'parkwood':           { id: 200,   label: 'Parkwood' },
  'statesman':          { id: 4,     label: 'Statesman Doors' },
  'doors-depot':        { id: 434,   label: 'Doors Depot' },
  'moyle-bendale':      { id: 17,    label: 'Moyle Bendale Timber' },
  'bone-timber':        { id: 98,    label: 'Bone Timber' },
  'au-barn-doors':      { id: 914,   label: 'AU Barn Doors' },
  'ideal-barn-doors':   { id: 99,    label: 'Ideal Barn Doors' },
  'tea-tree-mouldings': { id: 7976,  label: 'Tea Tree Mouldings' },
  'cavity-sliders':     { id: 8199,  label: 'Cavity Sliders' },
  'hirline':            { id: 833,   label: 'Trade Hirline Hinges' },
  'hinges':             { id: 2665,  label: 'Hinges' },
  'hardware':           { id: 9134,  label: 'Hardware (General)' },
  'bifold':             { id: 2780,  label: 'Bi-fold & Multi-fold' },
  'shaker':             { id: 8095,  label: 'Shaker Doors' },
  'classic-ceilings':   { id: 8088,  label: 'Classic Ceilings' },
  'elite-aluminium':    { id: 10025, label: 'Elite Aluminium Frames' },
  'bunnings':           { id: 53,    label: 'Bunnings' },
  'adx':                { id: 285,   label: 'ADX' },
  'lorenzin':           { id: 59,    label: 'AF Lorenzin' },
  'access':             { id: 50,    label: 'Access Hardware' },
  'assa-abloy':         { id: 18,    label: 'Assa Abloy' }
};

function simproGet(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: BASE_HOST,
      path: BASE_PATH + path,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Accept': 'application/json'
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(25000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

// Fetch ALL items from a group (paginate up to 10 pages = 2500 items max)
async function fetchGroupItems(groupId, maxPages = 10) {
  const allItems = [];
  for (let page = 1; page <= maxPages; page++) {
    const result = await simproGet(`/catalogs/?Group=${groupId}&pageSize=250&page=${page}`);
    if (result.status !== 200 || !Array.isArray(result.data) || result.data.length === 0) break;
    allItems.push(...result.data);
    if (result.data.length < 250) break;
  }
  return allItems;
}

// Filter items by search terms (all terms must match name or part number)
function filterItems(items, query) {
  if (!query) return items;
  const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 0);
  return items.filter(item => {
    const combined = ((item.Name || '') + ' ' + (item.PartNo || '')).toLowerCase();
    return terms.every(term => combined.includes(term));
  });
}

// Clean item for response
function cleanItem(item) {
  return {
    id: item.ID,
    partNo: item.PartNo || '',
    name: item.Name || '',
    tradePriceEx: item.TradePriceEx || 0,
    tradePriceInc: item.TradePriceInc || 0,
    group: item.Group ? item.Group.Name : '',
    groupId: item.Group ? item.Group.ID : null
  };
}

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const params = event.queryStringParameters || {};

    // === LIST GROUPS ===
    if (params.listGroups === 'true') {
      const groups = Object.entries(SUPPLIER_GROUPS)
        .filter(([, val]) => val.id > 0)
        .map(([key, val]) => ({ key, id: val.id, label: val.label }))
        .sort((a, b) => a.label.localeCompare(b.label));
      return { statusCode: 200, headers, body: JSON.stringify({ groups }) };
    }

    const q = (params.q || '').trim();
    const groupKey = (params.group || '').trim().toLowerCase();
    const groupId = params.groupId ? parseInt(params.groupId) : null;
    const searchAll = params.searchAll === 'true';
    const page = parseInt(params.page) || 1;
    const pageSize = Math.min(parseInt(params.pageSize) || 50, 250);

    // Resolve group ID
    let resolvedGroupId = groupId;
    if (!resolvedGroupId && groupKey && SUPPLIER_GROUPS[groupKey]) {
      resolvedGroupId = SUPPLIER_GROUPS[groupKey].id;
    }

    // === SEARCH ALL GROUPS ===
    if (searchAll && q) {
      const allMatches = [];
      const groupEntries = Object.entries(SUPPLIER_GROUPS).filter(([, v]) => v.id > 0);
      
      // Search up to 10 groups in parallel batches of 5
      for (let i = 0; i < groupEntries.length; i += 5) {
        const batch = groupEntries.slice(i, i + 5);
        const results = await Promise.all(
          batch.map(([, val]) => fetchGroupItems(val.id, 2).catch(() => []))
        );
        for (const items of results) {
          const matches = filterItems(items, q);
          allMatches.push(...matches);
        }
        // If we already have plenty of results, stop early
        if (allMatches.length >= 200) break;
      }

      const start = (page - 1) * pageSize;
      const paged = allMatches.slice(start, start + pageSize);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          items: paged.map(cleanItem),
          total: allMatches.length,
          page, pageSize,
          query: q,
          searchAll: true
        })
      };
    }

    // === SEARCH WITHIN GROUP ===
    if (!resolvedGroupId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: 'Provide a supplier group (e.g. group=zanda) or groupId, or use searchAll=true with a search term',
          hint: 'Use ?listGroups=true to see available supplier groups'
        })
      };
    }

    const allItems = await fetchGroupItems(resolvedGroupId);
    const filtered = filterItems(allItems, q);

    const start = (page - 1) * pageSize;
    const paged = filtered.slice(start, start + pageSize);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        items: paged.map(cleanItem),
        total: filtered.length,
        totalInGroup: allItems.length,
        page, pageSize,
        query: q || null,
        group: groupKey || null,
        groupId: resolvedGroupId
      })
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message })
    };
  }
};
