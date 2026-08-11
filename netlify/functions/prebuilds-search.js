// Netlify Function: prebuilds-search
// Searches Simpro prebuilds by group and/or name

const https = require('https');

const API_KEY = '8222557f31f04c8f626568f88bc5c8458215078e';
const BASE = 'https://2ndfix.simprosuite.com/api/v1.0/companies/3';

function simproGet(path) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
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
          const total = res.headers['result-total'] || null;
          resolve({ status: res.statusCode, data: JSON.parse(data), total });
        } catch (e) {
          resolve({ status: res.statusCode, data: data, total: null });
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

// Prebuild group IDs (confirmed from Simpro)
const PREBUILD_GROUPS = {
  'commercial': 1,
  'residential': 2,
  'private-labour': 3,
  'door-packages-online': 4,
  'external-showroom': 5,
  'internal-door': 6,
  'hume-external': 7,
  'screen-doors': 8,
  'supply-only-showroom': 9,
  'materials-estimating': 10,
  'test-website': 11,
  'price-update': 12,
  'custom': 13,
  'fls-weatherguard': 14
};

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
    const group = (params.group || '').trim();
    const q = (params.q || '').trim().toLowerCase();
    const page = parseInt(params.page) || 1;
    const pageSize = Math.min(parseInt(params.pageSize) || 50, 250);

    // If "list-groups" is requested, return available groups
    if (params.listGroups === 'true') {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ groups: PREBUILD_GROUPS })
      };
    }

    // Build query
    const queryParts = [`page=${page}`, `pageSize=${pageSize}`];
    if (group) {
      const groupId = PREBUILD_GROUPS[group] || group;
      queryParts.push(`Group=${groupId}`);
    }

    const result = await simproGet(`/prebuilds/?${queryParts.join('&')}`);

    if (result.status !== 200) {
      return {
        statusCode: result.status,
        headers,
        body: JSON.stringify({ error: 'Simpro API error', details: result.data })
      };
    }

    let items = Array.isArray(result.data) ? result.data.map(item => ({
      id: item.ID,
      name: item.Name || '',
      group: item.Group ? item.Group.Name : '',
      groupId: item.Group ? item.Group.ID : null,
      sellPrice: item.SellPrice || 0,
      costPrice: item.CostPrice || 0
    })) : [];

    // Client-side name filter if q provided
    if (q) {
      items = items.filter(item => item.name.toLowerCase().includes(q));
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        items,
        total: result.total ? parseInt(result.total) : items.length,
        page,
        pageSize
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
