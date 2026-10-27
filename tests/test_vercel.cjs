'use strict';

const assert = require('node:assert/strict');
const { test, beforeEach, afterEach } = require('node:test');
const { Readable, PassThrough } = require('node:stream');
const register = require('../api/register.js');
const originalFetch = global.fetch;
const originalUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
const originalSecret = process.env.REGISTRATION_SECRET;
let logs;
const standard = {
  requestId: 'f6b279d8-6226-49f4-8d60-d01f5d94a601',
  firstName: 'Example', university: 'University of Kelaniya', faculty: 'Faculty of Science',
  whatsapp: '0712345678'
};

async function send(body = standard, options = {}) {
  const request = options.request || { method: options.method || 'POST', headers: options.headers || {}, body };
  const response = {
    headers: {}, setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(value) { this.text = value; }
  };
  await register(request, response);
  return { status: response.statusCode, headers: response.headers, data: JSON.parse(response.text), text: response.text };
}

// Tests advance this clock explicitly: retry and budget coverage never waits real seconds.
function controlledTimers(t) {
  let now = 1000;
  let sequence = 0;
  const timers = new Map();
  const scheduled = [];
  const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
  t.mock.method(Date, 'now', () => now);
  t.mock.method(global, 'setTimeout', (fn, milliseconds) => {
    const token = { id: ++sequence };
    timers.set(token, { fn, at: now + milliseconds });
    scheduled.push(milliseconds);
    return token;
  });
  t.mock.method(global, 'clearTimeout', token => timers.delete(token));
  async function advance(milliseconds) {
    const end = now + milliseconds;
    while (true) {
      const next = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      now = next[1].at;
      timers.delete(next[0]);
      next[1].fn();
      await flush();
    }
    now = end;
    await flush();
  }
  async function finish(promise) {
    let complete = false;
    let result;
    let failure;
    promise.then(value => { result = value; complete = true; }, error => { failure = error; complete = true; });
    for (let i = 0; i < 20; i++) {
      await flush();
      if (complete) {
        if (failure) throw failure;
        return result;
      }
      const next = [...timers.values()].sort((a, b) => a.at - b.at)[0];
      assert.ok(next, 'A pending request must have a deadline or backoff timer');
      await advance(next.at - now);
    }
    assert.fail('Request did not settle within its bounded attempts');
  }
  return { advance, finish, flush, scheduled, pending: () => timers.size };
}

beforeEach(t => {
  process.env.GOOGLE_APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbx123456789/exec';
  process.env.REGISTRATION_SECRET = 'test-secret-only-at-least-32-characters';
  global.fetch = async () => new Response(JSON.stringify({ success: true }));
  logs = [];
  t.mock.method(console, 'warn', message => logs.push({ level: 'warn', ...JSON.parse(message) }));
  t.mock.method(console, 'error', message => logs.push({ level: 'error', ...JSON.parse(message) }));
});
afterEach(() => {
  global.fetch = originalFetch;
  if (originalUrl === undefined) delete process.env.GOOGLE_APPS_SCRIPT_URL;
  else process.env.GOOGLE_APPS_SCRIPT_URL = originalUrl;
  if (originalSecret === undefined) delete process.env.REGISTRATION_SECRET;
  else process.env.REGISTRATION_SECRET = originalSecret;
});

test('POST guard supplies Allow and never contacts storage', async () => {
  global.fetch = () => assert.fail('Unexpected upstream request');
  const result = await send(undefined, { method: 'GET' });
  assert.equal(result.status, 405);
  assert.equal(result.headers.allow, 'POST');
  assert.equal(result.headers['x-registration-version'], '2026-10-27-ieee-ies-day-1');
  assert.equal(result.data.success, false);
});

test('missing, short, or invalid configuration fails before storage access', async () => {
  global.fetch = () => assert.fail('Unexpected upstream request');
  for (const [key, value] of [
    ['REGISTRATION_SECRET', ''], ['REGISTRATION_SECRET', 'short'], ['REGISTRATION_SECRET', 'x'.repeat(257)],
    ['GOOGLE_APPS_SCRIPT_URL', 'https://script.google.com/macros/s/example/dev'],
    ['GOOGLE_APPS_SCRIPT_URL', 'https://untrusted.example/exec']
  ]) {
    const saved = process.env[key];
    process.env[key] = value;
    assert.equal((await send()).status, 503);
    process.env[key] = saved;
  }
});

test('valid JSON is normalized and forwarded once with a server-only secret', async () => {
  let calls = 0;
  global.fetch = async (url, options) => {
    calls++;
    assert.equal(url, process.env.GOOGLE_APPS_SCRIPT_URL);
    assert.equal(options.method, 'POST');
    assert.equal(options.redirect, 'follow');
    assert.equal(options.headers['Content-Type'], 'text/plain;charset=utf-8');
    assert.equal(options.signal.aborted, false);
    const payload = JSON.parse(options.body);
    assert.equal(payload.firstName, 'Example');
    assert.equal(payload.university, standard.university);
    assert.equal(payload.faculty, standard.faculty);
    assert.equal(payload.whatsapp, '+94712345678');
    assert.equal(payload.secret, process.env.REGISTRATION_SECRET);
    assert.equal(payload.requestId, standard.requestId);
    assert.deepEqual(Object.keys(payload).sort(), ['faculty', 'firstName', 'requestId', 'secret', 'university', 'whatsapp']);
    return new Response(JSON.stringify({ success: true, privateDetail: 'hidden' }));
  };
  const result = await send({ ...standard, firstName: ' Example ', university: ' University of Kelaniya ', whatsapp: '+94 (71) 234-5678' }, {
    headers: { 'Content-Type': 'application/json; charset=UTF-8' }
  });
  assert.equal(calls, 1);
  assert.equal(result.status, 200);
  assert.deepEqual(result.data, { success: true });
  assert.equal(result.headers['cache-control'], 'no-store');
  assert.equal(result.headers['x-content-type-options'], 'nosniff');
  assert.equal(result.headers['x-registration-version'], '2026-10-27-ieee-ies-day-1');
  assert.ok(!result.text.includes(process.env.REGISTRATION_SECRET));
  assert.deepEqual(logs, []);
});

test('supports Vercel string, Buffer, object, and streamed raw JSON bodies', async () => {
  const json = JSON.stringify(standard);
  for (const body of [standard, json, Buffer.from(json)]) assert.equal((await send(body)).status, 200);
  const request = Readable.from([Buffer.from(json.slice(0, 60)), Buffer.from(json.slice(60))]);
  request.method = 'POST';
  request.headers = { 'content-type': 'application/json' };
  assert.equal((await send(null, { request })).status, 200);
});

test('university and faculty names are accepted as free text', async () => {
  let saved;
  global.fetch = async (url, options) => {
    saved = JSON.parse(options.body);
    return new Response(JSON.stringify({ success: true }));
  };
  const result = await send({ ...standard, university: 'Example University', faculty: 'Engineering' });
  assert.equal(result.status, 200);
  assert.equal(saved.university, 'Example University');
  assert.equal(saved.faculty, 'Engineering');
});

test('missing, blank, non-string, oversized and control-character fields never reach storage', async () => {
  global.fetch = () => assert.fail('Invalid registration must not reach storage');
  for (const field of ['firstName', 'university', 'faculty', 'whatsapp', 'requestId']) {
    const missing = { ...standard };
    delete missing[field];
    assert.equal((await send(missing)).status, 400, `missing ${field}`);
  }
  const invalid = [
    { firstName: 123 }, { firstName: 'x' }, { firstName: 'x'.repeat(81) }, { firstName: 'Name\nInjected' },
    { university: null }, { university: ' ' }, { university: 'U'.repeat(121) },
    { faculty: {} }, { faculty: '' }, { faculty: 'F'.repeat(121) },
    { whatsapp: 712345678 }, { whatsapp: 'abc' },
    { requestId: 'short' }, { requestId: 'request id with spaces' },
    { website: 'bot.example' }, { website: true }
  ];
  for (const change of invalid) {
    const result = await send({ ...standard, ...change });
    assert.equal(result.status, 400, JSON.stringify(change));
    assert.equal(result.data.success, false);
  }
});

test('request IDs are preserved on retries and confirmed idempotent results are successful', async () => {
  const ids = [];
  global.fetch = async (url, options) => {
    ids.push(JSON.parse(options.body).requestId);
    return new Response(JSON.stringify({ success: true, alreadyStored: ids.length > 1 }));
  };
  assert.equal((await send()).status, 200);
  assert.equal((await send()).status, 200);
  assert.deepEqual(ids, [standard.requestId, standard.requestId]);
});

test('bounds all body representations by UTF-8 bytes before parsing raw JSON', async () => {
  global.fetch = () => assert.fail('Unexpected upstream request');
  for (const body of ['x'.repeat(8193), Buffer.alloc(8193), { ...standard, extra: '🌲'.repeat(2100) }]) {
    assert.equal((await send(body)).status, 413);
  }
  const request = Readable.from([Buffer.alloc(4096), Buffer.alloc(4097)]);
  request.method = 'POST';
  request.headers = {};
  assert.equal((await send(null, { request })).status, 413);
  let getterTouched = false;
  const oversized = { method: 'POST', headers: { 'content-length': '8193' }, get body() { getterTouched = true; throw Error('Must not parse'); } };
  assert.equal((await send(null, { request: oversized })).status, 413);
  assert.equal(getterTouched, false);
});

test('malformed JSON, lazy getter failures, incorrect media types and non-objects are rejected', async () => {
  global.fetch = () => assert.fail('Unexpected upstream request');
  for (const body of ['{broken', '', 'null', '[]', '42', null, []]) assert.equal((await send(body)).status, 400);
  assert.equal((await send(standard, { headers: { 'content-type': 'text/plain' } })).status, 415);
  assert.equal((await send(standard, { headers: { 'content-type': 'application/jsonp' } })).status, 415);
  assert.equal((await send(standard, { headers: { 'content-length': '-1' } })).status, 400);
  const request = { method: 'POST', get body() { throw Error('Vercel parser details'); } };
  const result = await send(null, { request });
  assert.equal(result.status, 400);
  assert.ok(!result.text.includes('Vercel parser details'));
});

test('interrupted raw streams fail safely even when aborted is followed by an error', async () => {
  global.fetch = () => assert.fail('Unexpected upstream request');
  const request = new PassThrough();
  request.method = 'POST';
  const pending = send(null, { request });
  request.emit('aborted');
  request.emit('error', Error('private connection details'));
  assert.equal((await pending).status, 400);
  request.end();
});

test('unfinished raw requests have a six-second input deadline', async t => {
  let fireTimeout;
  const token = {};
  t.mock.method(global, 'setTimeout', (fn, ms) => {
    assert.equal(ms, 6000);
    fireTimeout = fn;
    return token;
  });
  t.mock.method(global, 'clearTimeout', value => assert.equal(value, token));
  global.fetch = () => assert.fail('Unexpected upstream request');
  const request = new PassThrough();
  request.method = 'POST';
  const pending = send(null, { request });
  fireTimeout();
  assert.equal((await pending).status, 408);
  request.end();
});

test('validates field types, value limits, and honeypot without coercion', async () => {
  global.fetch = () => assert.fail('Unexpected upstream request');
  const invalid = [
    { firstName: 123 }, { firstName: 'x' }, { firstName: 'x'.repeat(81) }, { firstName: 'Name\tInjected' },
    { university: null }, { university: '' }, { university: 'U'.repeat(121) },
    { faculty: 23 }, { faculty: ' ' }, { faculty: 'F'.repeat(121) },
    { whatsapp: 712345678 }, { whatsapp: 'abc' },
    { requestId: 'short' }, { requestId: 'request id with spaces' },
    { website: 'bot.example' }, { website: true }
  ];
  for (const change of invalid) {
    const result = await send({ ...standard, ...change });
    assert.equal(result.status, 400, JSON.stringify(change));
    assert.equal(result.data.success, false);
  }
});

test('maps storage error codes while hiding private storage responses', async t => {
  const clock = controlledTimers(t);
  for (const [code, status] of [['DUPLICATE', 409], ['INVALID', 400], ['PAYLOAD_TOO_LARGE', 413], ['UNAUTHORIZED', 503], ['NOT_CONFIGURED', 503], ['SCHEMA_MISMATCH', 503], ['CONFIG', 503], ['BUSY', 503], ['STORAGE_UNAVAILABLE', 503]]) {
    let calls = 0;
    global.fetch = async () => { calls++; return new Response(JSON.stringify({ success: false, code, error: 'private spreadsheet ID and secret' })); };
    const result = await clock.finish(send());
    assert.equal(result.status, status, code);
    assert.ok(!result.text.includes('private spreadsheet'));
    assert.equal(calls, ['BUSY', 'STORAGE_UNAVAILABLE'].includes(code) ? 3 : 1, code);
  }
  assert.equal(clock.pending(), 0);
});

test('handles upstream HTTP errors, HTML responses and network failures', async t => {
  const clock = controlledTimers(t);
  for (const [status, expected] of [[400, 502], [401, 503], [403, 503], [404, 502], [429, 503], [500, 503], [502, 503], [503, 503], [504, 503]]) {
    let calls = 0;
    global.fetch = async () => { calls++; return new Response('private error', { status }); };
    const result = await clock.finish(send());
    assert.equal(result.status, expected);
    assert.ok(!result.text.includes('private error'));
    assert.equal(calls, [429, 500, 502, 503, 504].includes(status) ? 3 : 1);
  }
  let calls = 0;
  global.fetch = async () => { calls++; return new Response('<html>Google sign-in screen</html>'); };
  assert.equal((await clock.finish(send())).status, 502);
  assert.equal(calls, 1, 'HTML 2xx must fail without hiding a configuration/access issue behind retries');
  calls = 0;
  global.fetch = async () => { calls++; throw Error('private network details'); };
  const result = await clock.finish(send());
  assert.equal(result.status, 503);
  assert.equal(calls, 3);
  assert.ok(!result.text.includes('private network details'));
  assert.equal(clock.pending(), 0);
});

test('aborts storage requests after 16 seconds and exposes a safe retry error', async t => {
  let fireTimeout;
  let duration;
  const token = {};
  t.mock.method(global, 'setTimeout', (fn, ms) => { fireTimeout = fn; duration = ms; return token; });
  t.mock.method(global, 'clearTimeout', value => assert.equal(value, token));
  global.fetch = async (url, options) => {
    assert.equal(duration, 16000);
    fireTimeout();
    assert.equal(options.signal.aborted, true);
    throw new DOMException('private abort details', 'AbortError');
  };
  const result = await send();
  assert.equal(result.status, 503);
  assert.match(result.data.error, /retry safely/);
  assert.ok(!result.text.includes('private abort details'));
});

test('an abort while reading the storage response also returns the safe retry error', async () => {
  global.fetch = async () => ({
    ok: true,
    async json() { throw new DOMException('private response details', 'AbortError'); }
  });
  const result = await send();
  assert.equal(result.status, 503);
  assert.match(result.data.error, /retry safely/);
});

test('transient HTTP and storage failures recover within one budget using identical bodies', async t => {
  const clock = controlledTimers(t);
  const bodies = [];
  const signals = [];
  global.fetch = async (url, options) => {
    bodies.push(options.body);
    signals.push(options.signal);
    if (bodies.length === 1) return new Response('private upstream HTML', { status: 503 });
    if (bodies.length === 2) return new Response(JSON.stringify({ success: false, code: 'BUSY' }));
    return new Response(JSON.stringify({ success: true, alreadyStored: true }));
  };
  const result = await clock.finish(send());
  assert.equal(result.status, 200);
  assert.equal(bodies.length, 3);
  assert.ok(bodies.every(body => body === bodies[0]), 'All attempts must reuse the exact serialized payload');
  assert.ok(signals.every(signal => signal === signals[0]), 'All attempts must share one abort budget');
  assert.equal(JSON.parse(bodies[0]).requestId, standard.requestId);
  assert.equal(clock.scheduled.filter(milliseconds => milliseconds === 16000).length, 1);
  assert.ok(clock.scheduled[1] >= 300 && clock.scheduled[1] <= 400);
  assert.ok(clock.scheduled[2] >= 800 && clock.scheduled[2] <= 900);
  assert.deepEqual(logs.map(log => [log.event, log.attempt, log.upstreamCode]), [
    ['registration_retry', 1, 'HTTP_ERROR'], ['registration_retry', 2, 'BUSY'], ['registration_recovered', 3, 'SUCCESS']
  ]);
  assert.equal(clock.pending(), 0);
});

test('a transport failure after a possible write can recover as already stored', async t => {
  const clock = controlledTimers(t);
  const bodies = [];
  global.fetch = async (url, options) => {
    bodies.push(options.body);
    if (bodies.length === 1) throw TypeError('private connection lost after write');
    return new Response(JSON.stringify({ success: true, alreadyStored: true }));
  };
  assert.equal((await clock.finish(send())).status, 200);
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0], bodies[1]);
  assert.equal(logs[0].upstreamCode, 'NETWORK_ERROR');
  assert.equal(logs.at(-1).event, 'registration_recovered');
  assert.equal(clock.pending(), 0);
});

test('a lost response body retries without changing the request and confirms the existing save', async t => {
  const clock = controlledTimers(t);
  const bodies = [];
  global.fetch = async (url, options) => {
    bodies.push(options.body);
    if (bodies.length === 1) return {
      ok: true, status: 200,
      async json() { throw new TypeError('private response body connection lost after write'); }
    };
    return new Response(JSON.stringify({ success: true, alreadyStored: true }));
  };
  assert.equal((await clock.finish(send())).status, 200);
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0], bodies[1]);
  assert.equal(logs[0].upstreamStatus, 200);
  assert.equal(logs[0].upstreamCode, 'NETWORK_ERROR');
  assert.equal(logs.at(-1).event, 'registration_recovered');
  assert.ok(!JSON.stringify(logs).includes('private response body'));
  assert.equal(clock.pending(), 0);
});

test('insufficient budget skips a backoff and never starts another attempt', async t => {
  const clock = controlledTimers(t);
  let calls = 0;
  let signal;
  let resolveFetch;
  global.fetch = (url, options) => {
    calls++;
    signal = options.signal;
    return new Promise(resolve => { resolveFetch = resolve; });
  };
  const pending = send();
  await clock.flush();
  await clock.advance(15800);
  resolveFetch(new Response(JSON.stringify({ success: false, code: 'BUSY' })));
  await clock.flush();
  const result = await clock.finish(pending);
  assert.equal(result.status, 503);
  assert.match(result.data.error, /retry safely/);
  assert.equal(calls, 1);
  assert.equal(signal.aborted, false, 'No in-flight fetch remains when backoff cannot fit');
  assert.equal(logs.at(-1).upstreamCode, 'TIMEOUT');
  assert.equal(clock.pending(), 0);
});

test('the shared deadline aborts an in-flight retry without allowing a fourth attempt', async t => {
  const clock = controlledTimers(t);
  let calls = 0;
  global.fetch = async (url, options) => {
    calls++;
    if (calls < 3) return new Response(JSON.stringify({ success: false, code: 'STORAGE_UNAVAILABLE' }));
    return new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new DOMException('private request detail', 'AbortError')), { once: true });
    });
  };
  const result = await clock.finish(send());
  assert.equal(result.status, 503);
  assert.match(result.data.error, /retry safely/);
  assert.equal(calls, 3);
  assert.equal(logs.at(-1).elapsedMs, 16000);
  assert.equal(logs.at(-1).upstreamCode, 'TIMEOUT');
  assert.equal(clock.pending(), 0);
});

test('abort-aware backoff removes its listener and timer when interrupted', async t => {
  const clock = controlledTimers(t);
  const listeners = new Set();
  const addListener = AbortSignal.prototype.addEventListener;
  const removeListener = AbortSignal.prototype.removeEventListener;
  t.mock.method(AbortSignal.prototype, 'addEventListener', function(type, callback, options) {
    if (type === 'abort') listeners.add(callback);
    return addListener.call(this, type, callback, options);
  });
  t.mock.method(AbortSignal.prototype, 'removeEventListener', function(type, callback, options) {
    if (type === 'abort') listeners.delete(callback);
    return removeListener.call(this, type, callback, options);
  });
  let signal;
  let calls = 0;
  global.fetch = async (url, options) => {
    calls++;
    signal = options.signal;
    return { ok: true, status: 200, async json() { return { success: false, code: 'BUSY' }; } };
  };
  const pending = send();
  await clock.flush();
  assert.equal(listeners.size, 1);
  // Deliver an abort while the first backoff timer is still pending.
  const abort = new Event('abort');
  signal.dispatchEvent(abort);
  const result = await clock.finish(pending);
  assert.equal(result.status, 503);
  assert.equal(calls, 1);
  assert.equal(listeners.size, 0);
  assert.equal(clock.pending(), 0);
});

test('completed backoffs remove their abort listeners before a recovered response', async t => {
  const clock = controlledTimers(t);
  const listeners = new Set();
  const addListener = AbortSignal.prototype.addEventListener;
  const removeListener = AbortSignal.prototype.removeEventListener;
  t.mock.method(AbortSignal.prototype, 'addEventListener', function(type, callback, options) {
    if (type === 'abort') listeners.add(callback);
    return addListener.call(this, type, callback, options);
  });
  t.mock.method(AbortSignal.prototype, 'removeEventListener', function(type, callback, options) {
    if (type === 'abort') listeners.delete(callback);
    return removeListener.call(this, type, callback, options);
  });
  let calls = 0;
  global.fetch = async () => ({
    ok: true, status: 200,
    async json() { return ++calls < 3 ? { success: false, code: 'BUSY' } : { success: true }; }
  });
  assert.equal((await clock.finish(send())).status, 200);
  assert.equal(calls, 3);
  assert.equal(listeners.size, 0);
  assert.equal(clock.pending(), 0);
});

test('structured failure logs contain only safe diagnostic fields', async t => {
  const clock = controlledTimers(t);
  const privateMarker = 'private-name-phone-url-secret';
  global.fetch = async () => new Response(JSON.stringify({ success: false, code: privateMarker, error: privateMarker }));
  const result = await clock.finish(send({ ...standard, firstName: privateMarker }));
  assert.equal(result.status, 503);
  assert.equal(logs.length, 1);
  assert.deepEqual(Object.keys(logs[0]).sort(), ['level', 'event', 'requestId', 'attempt', 'upstreamStatus', 'upstreamCode', 'elapsedMs'].sort());
  assert.equal(logs[0].upstreamCode, 'UNKNOWN');
  assert.equal(logs[0].requestId, standard.requestId);
  const serialized = JSON.stringify(logs);
  for (const value of [privateMarker, standard.whatsapp, standard.university, process.env.GOOGLE_APPS_SCRIPT_URL, process.env.REGISTRATION_SECRET]) {
    assert.ok(!serialized.includes(value));
  }
});
