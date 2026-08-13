exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  try {
    const data = JSON.parse(event.body || '{}');
    const suggestion = String(data.suggestion || '').trim();
    if (!suggestion) return { statusCode: 400, headers, body: JSON.stringify({ error: 'No suggestion provided' }) };
    const token = process.env.GITHUB_TOKEN;
    if (!token) return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server not configured' }) };
    const short = suggestion.replace(/\s+/g, ' ').slice(0, 60);
    const title = 'Wizard suggestion: ' + short + (suggestion.length > 60 ? '...' : '');
    const body = [
      '**Suggestion**', '', suggestion, '', '---', '',
      '- **From:** ' + (data.submittedBy || 'Unknown'),
      '- **Date:** ' + (data.date || ''),
      '- **Screen:** ' + ((data.context && data.context.screen) || 'unknown'),
      '- **Source:** ' + (data.source || 'Quote Wizard')
    ].join('\n');
    const res = await fetch('https://api.github.com/repos/george-2ndfix/2ndfix-quote-wizard/issues', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'quote-wizard'
      },
      body: JSON.stringify({ title: title, body: body })
    });
    if (!res.ok) {
      const t = await res.text();
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'GitHub error', detail: t.slice(0, 300) }) };
    }
    const issue = await res.json();
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, issue: issue.number, url: issue.html_url }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: String(e && e.message || e) }) };
  }
};
