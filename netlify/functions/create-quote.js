// Netlify Function: create-quote
// Creates a DRAFT quote in Simpro from the Quote Wizard summary screen:
//   customer (find or create) -> site (find or create) -> quote (draft)
//   -> one section per door -> cost centres per section -> quote note (full wizard output)
// Nothing is priced and nothing is sent to the customer. The salesperson prices it in Simpro.

const https = require('https');

const API_KEY = '8222557f31f04c8f626568f88bc5c8458215078e';
const BASE = 'https://2ndfix.simprosuite.com/api/v1.0/companies/3';

// Simpro employee IDs for the wizard logins (Salesperson on the quote)
const SALESPEOPLE = {
  'george kalliontzis': 10,
  'cherie lanzon': 22,
  'andrew lewis': 411,
  'princess lei': 389,
  'princess matilos': 389,
  'princess lei matilos': 389,
  'kel smith': 365
};
const DEFAULT_SALESPERSON = 10; // George

// Cost centres that the wizard is allowed to add (see /setup/accounts/costCenters/)
const COST_CENTRES = {
  19: 'Showroom Sales', 20: 'Private Labour', 21: 'Door Supplied & Installed',
  22: 'Materials Supplied & Installed', 23: 'Callbacks / Warranty',
  24: 'Hardware Supplied & Installed', 26: 'Consultation Fee',
  27: 'Supply Only - Materials', 28: 'Screen Door', 29: 'Painting',
  30: 'Locksmith Keying Charge'
};

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

const ok = (r) => r && r.status >= 200 && r.status < 300;
const brief = (r) => {
  try { return typeof r.data === 'string' ? r.data.slice(0, 300) : JSON.stringify(r.data).slice(0, 300); }
  catch (e) { return String(r && r.status); }
};
// Loose comparison for addresses / names: case + punctuation + whitespace insensitive
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const htmlNote = (t) => String(t || '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/\r\n/g, '\n').replace(/\n/g, '<br>');

function salespersonId(name) {
  if (!name) return DEFAULT_SALESPERSON;
  return SALESPEOPLE[String(name).trim().toLowerCase()] || DEFAULT_SALESPERSON;
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

  const log = [];
  const fail = (status, error, extra) => ({
    statusCode: status,
    headers,
    body: JSON.stringify(Object.assign({ success: false, error, log }, extra || {}))
  });

  let customerId = null;
  let siteId = null;
  let quoteId = null;

  try {
    const payload = JSON.parse(event.body || '{}');

    // Accept the wizard payload; fall back to the older flat shape for safety.
    const c = payload.customer || payload || {};
    const givenName = (c.givenName || '').trim();
    const familyName = (c.familyName || '').trim();
    const mobile = (c.mobile || '').trim();
    const email = (c.email || '').trim();
    const address = (c.address || '').trim();
    const city = (c.city || '').trim();
    const state = (c.state || 'SA').trim();
    const postalCode = (c.postalCode || '').trim();
    const existingCustomerId = c.customerId || null;

    const salespersonName = payload.salespersonName || '';
    const jobNumber = (payload.jobNumber || '').trim();
    const fullOutput = payload.fullOutput || '';
    const doors = Array.isArray(payload.doors) ? payload.doors : [];

    if (!familyName && !givenName) {
      return fail(400, 'Customer name is required.');
    }
    if (!address) {
      return fail(400, 'Site address is required.');
    }

    // ---------- 1. Find or create the customer ----------
    let customerCreated = false;
    if (existingCustomerId) {
      customerId = existingCustomerId;
      log.push(`Using supplied customer ID ${customerId}`);
    } else {
      const searches = [];
      if (mobile) searches.push({ label: `mobile ${mobile}`, qs: `CellPhone=${encodeURIComponent(mobile)}` });
      if (email) searches.push({ label: `email ${email}`, qs: `Email=${encodeURIComponent(email)}` });
      if (givenName && familyName) {
        searches.push({
          label: `name ${givenName} ${familyName}`,
          qs: `GivenName=${encodeURIComponent(givenName)}&FamilyName=${encodeURIComponent(familyName)}`
        });
      }
      for (const s of searches) {
        const res = await simproRequest('GET', `/customers/?${s.qs}&pageSize=5`, null);
        if (ok(res) && Array.isArray(res.data) && res.data.length > 0) {
          customerId = res.data[0].ID;
          log.push(`Matched existing customer by ${s.label}: ID ${customerId}`);
          break;
        }
      }
      if (!customerId) {
        const customerData = {
          GivenName: givenName,
          FamilyName: familyName || givenName,
          CellPhone: mobile,
          Email: email,
          Address: { Address: address, City: city, State: state, PostalCode: postalCode }
        };
        const created = await simproRequest('POST', '/customers/individuals/', customerData);
        if (ok(created) && created.data && created.data.ID) {
          customerId = created.data.ID;
          customerCreated = true;
          log.push(`Created new customer "${givenName} ${familyName}": ID ${customerId}`);
        } else {
          return fail(502, `Could not create the customer in Simpro (HTTP ${created.status}): ${brief(created)}`);
        }
      }
    }

    // ---------- 2. Find or create the site ----------
    let siteCreated = false;
    const siteName = [address, city, postalCode].filter(Boolean).join(' ');
    const custDetail = await simproRequest('GET', `/customers/individuals/${customerId}?columns=ID,Sites`, null);
    const existingSites = (ok(custDetail) && custDetail.data && Array.isArray(custDetail.data.Sites))
      ? custDetail.data.Sites : [];
    for (const s of existingSites.slice(0, 25)) {
      if (norm(s.Name) === norm(siteName) || norm(s.Name).indexOf(norm(address)) === 0) {
        siteId = s.ID;
        log.push(`Matched existing site "${s.Name}": ID ${siteId}`);
        break;
      }
      const detail = await simproRequest('GET', `/sites/${s.ID}?columns=ID,Name,Address`, null);
      const a = ok(detail) && detail.data && detail.data.Address ? detail.data.Address : null;
      if (a && norm(a.Address) === norm(address) && (!city || !a.City || norm(a.City) === norm(city))) {
        siteId = s.ID;
        log.push(`Matched existing site "${detail.data.Name || s.Name}": ID ${siteId}`);
        break;
      }
    }
    if (!siteId) {
      const siteData = {
        Name: siteName,
        Address: { Address: address, City: city, State: state, PostalCode: postalCode },
        Customers: [customerId]
      };
      const created = await simproRequest('POST', '/sites/', siteData);
      if (ok(created) && created.data && created.data.ID) {
        siteId = created.data.ID;
        siteCreated = true;
        log.push(`Created new site "${siteName}": ID ${siteId}`);
      } else {
        return fail(502, `Could not create the site in Simpro (HTTP ${created.status}): ${brief(created)}`, { customerId });
      }
      // Make sure the site is linked to the customer (required before it can be quoted)
      const check = await simproRequest('GET', `/sites/${siteId}?columns=ID,Customers`, null);
      const linked = ok(check) && check.data && Array.isArray(check.data.Customers)
        && check.data.Customers.some(x => x.ID === customerId);
      if (!linked) {
        const ids = existingSites.map(s => s.ID).filter(id => id !== siteId).concat([siteId]);
        const patch = await simproRequest('PATCH', `/customers/individuals/${customerId}`, { Sites: ids });
        log.push(ok(patch)
          ? `Linked site ${siteId} to customer ${customerId}`
          : `Warning: could not link site ${siteId} to customer ${customerId} (HTTP ${patch.status}): ${brief(patch)}`);
      }
    }

    // ---------- 3. Create the draft quote ----------
    const displayName = [familyName, givenName].filter(Boolean).join(', ');
    const quoteName = `${displayName} - Supply and Install`;
    // NOTE: CustomerStage is read-only on POST (Simpro defaults it to "Pending");
    // it is corrected with a PATCH below if Simpro ever changes that default.
    const quoteData = {
      Customer: customerId,
      Site: siteId,
      Type: 'Project',
      Stage: 'InProgress',
      ValidityDays: 30,
      Salesperson: salespersonId(salespersonName),
      Name: quoteName,
      RequestNo: jobNumber ? `${quoteName} (Job ${jobNumber})` : quoteName
    };
    const quoteRes = await simproRequest('POST', '/quotes/', quoteData);
    if (ok(quoteRes) && quoteRes.data && quoteRes.data.ID) {
      quoteId = quoteRes.data.ID;
      log.push(`Created draft quote ${quoteId} for ${salespersonName || 'George Kalliontzis'} (Stage: InProgress)`);
      if (quoteRes.data.CustomerStage && quoteRes.data.CustomerStage !== 'Pending') {
        const patch = await simproRequest('PATCH', `/quotes/${quoteId}`, { CustomerStage: 'Pending' });
        log.push(ok(patch)
          ? 'Set CustomerStage to Pending'
          : `Warning: could not set CustomerStage to Pending (HTTP ${patch.status})`);
      }
    } else {
      return fail(502, `Could not create the quote in Simpro (HTTP ${quoteRes.status}): ${brief(quoteRes)}`,
        { customerId, siteId });
    }

    // ---------- 4. Sections + cost centres (one section per door) ----------
    // Never abort the whole quote for one bad section — collect warnings instead.
    for (let i = 0; i < doors.length; i++) {
      const door = doors[i] || {};
      const sectionName = (door.sectionName || `Door ${i + 1}`).slice(0, 255);
      try {
        const secRes = await simproRequest('POST', `/quotes/${quoteId}/sections/`, {
          Name: sectionName,
          Description: door.description || '',
          DisplayOrder: i + 1
        });
        if (!ok(secRes) || !secRes.data || !secRes.data.ID) {
          log.push(`Warning: section "${sectionName}" failed (HTTP ${secRes.status}): ${brief(secRes)}`);
          continue;
        }
        const sectionId = secRes.data.ID;
        log.push(`Added section "${sectionName}": ID ${sectionId}`);
        const centres = Array.isArray(door.costCentres) ? door.costCentres : [];
        for (const raw of centres) {
          const ccId = parseInt(raw, 10);
          if (!ccId || !COST_CENTRES[ccId]) {
            log.push(`Warning: skipped unknown cost centre "${raw}" on "${sectionName}"`);
            continue;
          }
          try {
            const ccRes = await simproRequest('POST', `/quotes/${quoteId}/sections/${sectionId}/costCenters/`, { CostCenter: ccId });
            log.push(ok(ccRes)
              ? `  + cost centre ${ccId} ${COST_CENTRES[ccId]}`
              : `Warning: cost centre ${ccId} (${COST_CENTRES[ccId]}) failed on "${sectionName}" (HTTP ${ccRes.status}): ${brief(ccRes)}`);
          } catch (e) {
            log.push(`Warning: cost centre ${ccId} errored on "${sectionName}": ${e.message}`);
          }
        }
      } catch (e) {
        log.push(`Warning: section "${sectionName}" errored: ${e.message}`);
      }
    }

    // ---------- 5. Attach the full wizard output as a quote note ----------
    if (fullOutput) {
      try {
        const noteRes = await simproRequest('POST', `/quotes/${quoteId}/notes/`, {
          Subject: 'Quote Wizard \u2014 On-Site Capture',
          Note: htmlNote(fullOutput)
        });
        log.push(ok(noteRes)
          ? 'Attached quote note "Quote Wizard — On-Site Capture"'
          : `Warning: quote note failed (HTTP ${noteRes.status}): ${brief(noteRes)}`);
      } catch (e) {
        log.push(`Warning: quote note errored: ${e.message}`);
      }
    } else {
      log.push('Warning: no wizard output supplied, quote note skipped');
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        quoteId,
        customerId,
        siteId,
        quoteUrl: `https://2ndfix.simprosuite.com/staff/quote.php?mode=view&quoteID=${quoteId}`,
        created: { customer: customerCreated, site: siteCreated },
        log
      })
    };
  } catch (err) {
    return fail(500, err.message || 'Unexpected error creating the quote', { customerId, siteId, quoteId });
  }
};
