// Netlify Function: create-quote
// Creates a full draft quote in Simpro: customer → site → quote → section → note
// Also handles: customer creation, site creation

const https = require('https');

const API_KEY = '8222557f31f04c8f626568f88bc5c8458215078e';
const BASE = 'https://2ndfix.simprosuite.com/api/v1.0/companies/3';

function simproRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const postData = body ? JSON.stringify(body) : null;
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    };
    if (postData) {
      options.headers['Content-Length'] = Buffer.byteLength(postData);
    }
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: data ? JSON.parse(data) : null });
        } catch (e) {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout')); });
    if (postData) req.write(postData);
    req.end();
  });
}

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'POST only' }) };
  }

  try {
    const payload = JSON.parse(event.body);
    const {
      // Customer fields
      givenName, familyName, mobile, email, address, city, state, postalCode,
      // Existing customer ID (skip creation if provided)
      customerId: existingCustomerId,
      // Quote details
      sectionName = 'Supply & Install',
      noteTitle = 'Enquiry Details',
      noteText = '',
      salesConsultant = 'George Kalliontzis'
    } = payload;

    const log = [];
    let customerId = existingCustomerId;
    let siteId = null;
    let quoteId = null;
    let sectionId = null;

    // Step 1: Find or create customer
    if (!customerId) {
      // Search by mobile first
      if (mobile) {
        const search = await simproRequest('GET', `/customers/?CellPhone=${encodeURIComponent(mobile)}`, null);
        if (search.status === 200 && Array.isArray(search.data) && search.data.length > 0) {
          customerId = search.data[0].ID;
          log.push(`Found existing customer: ID ${customerId}`);
        }
      }

      // Create if not found
      if (!customerId) {
        if (!givenName || !familyName) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'givenName and familyName required for new customer' })
          };
        }
        const customerData = {
          Type: 'Individual',
          GivenName: givenName,
          FamilyName: familyName,
          CellPhone: mobile || '',
          Email: email || ''
        };
        if (address) {
          customerData.Address = {
            Address: address,
            City: city || '',
            State: state || 'SA',
            PostalCode: postalCode || ''
          };
        }
        const created = await simproRequest('POST', '/customers/', customerData);
        if (created.status === 200 || created.status === 201) {
          customerId = created.data.ID;
          log.push(`Created customer: ID ${customerId}`);
        } else {
          return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Failed to create customer', details: created.data })
          };
        }
      }
    } else {
      log.push(`Using existing customer: ID ${customerId}`);
    }

    // Step 2: Create site
    const siteData = {
      Name: address ? `${address}, ${city || ''}`.replace(/, $/, '') : `${givenName || ''} ${familyName || ''} Site`.trim()
    };
    if (address) {
      siteData.Address = {
        Address: address,
        City: city || '',
        State: state || 'SA',
        PostalCode: postalCode || ''
      };
    }
    const siteResult = await simproRequest('POST', `/customers/${customerId}/sites/`, siteData);
    if (siteResult.status === 200 || siteResult.status === 201) {
      siteId = siteResult.data.ID;
      log.push(`Created site: ID ${siteId}`);
    } else {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to create site', details: siteResult.data })
      };
    }

    // Step 3: Create quote (Project type for named cost centres)
    const quoteData = {
      Customer: customerId,
      Site: siteId,
      Type: 'Project',
      Status: 'Progress'
    };
    const quoteResult = await simproRequest('POST', '/quotes/', quoteData);
    if (quoteResult.status === 200 || quoteResult.status === 201) {
      quoteId = quoteResult.data.ID;
      log.push(`Created quote: ID ${quoteId}`);
    } else {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to create quote', details: quoteResult.data })
      };
    }

    // Step 4: Create section/cost centre
    const sectionData = { Name: sectionName };
    const sectionResult = await simproRequest('POST', `/quotes/${quoteId}/sections/`, sectionData);
    if (sectionResult.status === 200 || sectionResult.status === 201) {
      sectionId = sectionResult.data.ID;
      log.push(`Created section "${sectionName}": ID ${sectionId}`);
    } else {
      log.push(`Warning: Failed to create section: ${JSON.stringify(sectionResult.data)}`);
    }

    // Step 5: Add note
    if (noteText) {
      const noteData = {
        Subject: noteTitle,
        Note: noteText
      };
      const noteResult = await simproRequest('POST', `/quotes/${quoteId}/notes/`, noteData);
      if (noteResult.status === 200 || noteResult.status === 201) {
        log.push(`Added note: "${noteTitle}"`);
      } else {
        log.push(`Warning: Failed to add note: ${JSON.stringify(noteResult.data)}`);
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        customerId,
        siteId,
        quoteId,
        sectionId,
        log
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
