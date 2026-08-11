// Netlify Function: customer-lookup
// Searches Simpro customers by mobile number
// CellPhone filter on /customers/ doesn't work server-side
// Strategy: use CompanyName search for name, or paginated scan for phone

const https = require('https');

const API_KEY = '8222557f31f04c8f626568f88bc5c8458215078e';
const BASE_HOST = '2ndfix.simprosuite.com';
const BASE_PATH = '/api/v1.0/companies/3';

function simproRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: BASE_HOST,
      path: BASE_PATH + path,
      method: method,
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
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
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// Normalize Australian mobile: strip spaces, +61 → 0
function normalizePhone(phone) {
  let p = (phone || '').replace(/[\s\-()]/g, '');
  if (p.startsWith('+61')) p = '0' + p.slice(3);
  if (p.startsWith('61') && p.length === 11) p = '0' + p.slice(2);
  return p;
}

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const params = event.queryStringParameters || {};

    // === SEARCH BY PHONE ===
    if (params.phone) {
      const searchPhone = normalizePhone(params.phone);
      if (searchPhone.length < 8) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Phone number too short' }) };
      }

      // Simpro's CellPhone filter doesn't work on list endpoint
      // But we can try the search parameter which sometimes works
      // Scan recent customers (most likely to be the one we want)
      let found = null;
      for (let page = 1; page <= 20; page++) {
        const result = await simproRequest('GET', `/customers/?pageSize=250&page=${page}&orderby=ID&direction=desc`);
        if (result.status !== 200 || !Array.isArray(result.data) || result.data.length === 0) break;
        
        for (const cust of result.data) {
          const custPhone = normalizePhone(cust.CellPhone || '');
          if (custPhone === searchPhone) {
            found = cust;
            break;
          }
        }
        if (found) break;
      }

      if (found) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            found: true,
            customer: {
              id: found.ID,
              name: `${found.GivenName || ''} ${found.FamilyName || ''}`.trim(),
              givenName: found.GivenName || '',
              familyName: found.FamilyName || '',
              email: found.Email || '',
              phone: found.CellPhone || '',
              address: found.Address || ''
            }
          })
        };
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ found: false, phone: searchPhone })
      };
    }

    // === SEARCH BY NAME ===
    if (params.name) {
      const result = await simproRequest('GET', `/customers/?CompanyName=${encodeURIComponent(params.name)}&pageSize=20`);
      if (result.status === 200 && Array.isArray(result.data)) {
        // Also do a fuzzy match on GivenName/FamilyName
        const searchLower = params.name.toLowerCase();
        const nameResult = await simproRequest('GET', `/customers/?pageSize=250&orderby=ID&direction=desc`);
        
        let matches = [];
        if (nameResult.status === 200 && Array.isArray(nameResult.data)) {
          matches = nameResult.data.filter(c => {
            const fullName = `${c.GivenName || ''} ${c.FamilyName || ''}`.toLowerCase();
            return fullName.includes(searchLower) || searchLower.includes(c.FamilyName?.toLowerCase() || '---');
          });
        }

        const customers = matches.slice(0, 10).map(c => ({
          id: c.ID,
          name: `${c.GivenName || ''} ${c.FamilyName || ''}`.trim(),
          phone: c.CellPhone || '',
          email: c.Email || ''
        }));

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ customers, total: matches.length })
        };
      }
    }

    // === CREATE CUSTOMER ===
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { givenName, familyName, phone, email } = body;

      if (!givenName || !familyName) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'givenName and familyName required' }) };
      }

      const customerData = {
        GivenName: givenName,
        FamilyName: familyName,
        Type: 'Individual'
      };
      if (phone) customerData.CellPhone = normalizePhone(phone);
      if (email) customerData.Email = email;

      const result = await simproRequest('POST', '/customers/', customerData);
      
      if (result.status === 200 || result.status === 201) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            created: true,
            customer: {
              id: result.data.ID,
              name: `${givenName} ${familyName}`,
              phone: phone || '',
              email: email || ''
            }
          })
        };
      }

      return {
        statusCode: result.status,
        headers,
        body: JSON.stringify({ error: 'Failed to create customer', details: result.data })
      };
    }

    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Provide ?phone=04XXXXXXXX or ?name=Smith, or POST to create' })
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message })
    };
  }
};
