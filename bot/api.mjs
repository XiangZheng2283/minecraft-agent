// Local HTTP API for one agent (127.0.0.1 only).
import http from 'node:http';

export function createApiHandler(agent, { log = () => {} } = {}) {
  const invalid = (message) => Object.assign(new Error(message), { status: 400 });
  const textParam = (value, max = 512) => {
    if (value == null) return '';
    if (typeof value !== 'string' || value.length > max) throw invalid(`Text must be at most ${max} characters`);
    return value;
  };
  const numeric = (value, fallback, max) => {
    if (value == null || value === '') return fallback;
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n < 1 || n > max) throw invalid(`Number must be an integer between 1 and ${max}`);
    return n;
  };
  const json = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data, null, 2)); };
  const body = (req) => new Promise((resolve, reject) => {
    let text = '';
    req.setEncoding('utf8');
    let oversized = false;
    req.on('data', (c) => { if (oversized) return; text += c; if (text.length > 16_000) { oversized = true; reject(Object.assign(new Error('Request body too large'), { status: 413 })); } });
    req.on('end', () => { try { resolve(text ? JSON.parse(text) : {}); } catch { reject(invalid('Body must be JSON')); } });
    req.on('aborted', () => reject(invalid('Request aborted')));
    req.on('error', reject);
  });

  const routes = {
    'GET /': () => ({ agent: agent.config.name, endpoints: ['GET /status', 'GET /plan', 'POST /goal {text}', 'POST /stop', 'POST /resume', 'POST /received', 'GET /world?name=&kind=&radius=&limit=', 'GET /world/summary?radius=', 'GET /notes?q=', 'GET /knowledge?q=&limit='] }),
    'GET /status': () => agent.status(),
    'GET /plan': () => agent.status().plan,
    'POST /goal': async (req) => { const payload = await body(req); const text = textParam(payload?.text, 4000).trim(); if (!text) throw invalid('text is required'); return agent.request(text, 'api'); },
    'POST /stop': () => agent.pause('api'),
    'POST /resume': () => agent.resume('api'),
    'POST /received': () => agent.confirmDelivery('api'),
    'GET /world': (req, q) => agent.queryWorld({ name: textParam(q.get('name'), 100) || null, kind: textParam(q.get('kind'), 40) || null, radius: numeric(q.get('radius'), 128, 1024), limit: numeric(q.get('limit'), 10, 20) }),
    'GET /world/summary': (req, q) => agent.worldSummary(numeric(q.get('radius'), 96, 1024)),
    'GET /notes': (req, q) => agent.world.searchNotes(textParam(q.get('q')), { limit: numeric(q.get('limit'), 10, 20) }),
    'GET /knowledge': (req, q) => agent.recall(textParam(q.get('q')), numeric(q.get('limit'), 5, 10)),
  };

  return async (req, res) => {
    try {
      const u = new URL(req.url, 'http://localhost');
      const route = routes[`${req.method} ${u.pathname.replace(/\/+$/, '') || '/'}`];
      if (!route) return json(res, 404, { error: 'not found' });
      json(res, 200, await route(req, u.searchParams));
    } catch (e) { log('api_request_error', { error: e.message }); json(res, e.status || 500, { error: e.status ? e.message : 'Internal request error' }); }
  };
}

export function startApi(port, agent, { host = '127.0.0.1', log = () => {} } = {}) {
  if (!port) return null;
  const server = http.createServer(createApiHandler(agent, { log }));
  server.on('error', (e) => log('api_error', { error: e.message, port }));
  server.listen(port, host, () => log('api_ready', { url: `http://${host}:${port}/` }));
  return server;
}
