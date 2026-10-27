'use strict';

// Vercel Node function. The Apps Script URL and secret stay on the server.
const MAX_BODY_BYTES = 8 * 1024;
const SERVICE_VERSION = '2026-10-27-ieee-ies-day-1';
const INVALID = 'Please check your details and try again.';
const UNAVAILABLE = 'Registration storage is temporarily unavailable. Please try again.';
const RETRY_HTTP = new Set([429, 500, 502, 503, 504]);
const STORAGE_CODES = new Set([
  'DUPLICATE', 'INVALID', 'PAYLOAD_TOO_LARGE', 'UNAUTHORIZED', 'NOT_CONFIGURED',
  'SCHEMA_MISMATCH', 'CONFIG', 'BUSY', 'STORAGE_UNAVAILABLE'
]);

function aborted() {
  return Object.assign(new Error('Storage request deadline exceeded.'), { name: 'AbortError' });
}

function backoff(milliseconds, signal) {
  if (signal.aborted) return Promise.reject(aborted());
  return new Promise((resolve, reject) => {
    function cleanup() {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    }
    function onAbort() { cleanup(); reject(aborted()); }
    const timer = setTimeout(() => { cleanup(); resolve(); }, milliseconds);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function reply(response, status, data) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Registration-Version', SERVICE_VERSION);
  response.end(JSON.stringify(data));
}

function problem(status, message) {
  return Object.assign(new Error(message), { status });
}

function header(request, name) {
  const headers = request.headers || {};
  const key = Object.keys(headers).find(key => key.toLowerCase() === name);
  const value = key === undefined ? undefined : headers[key];
  return typeof value === 'string' ? value : undefined;
}

function rawBody(request) {
  if (typeof request.on !== 'function' || request.readableEnded) return Promise.resolve('');
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const deadline = setTimeout(() => finish(problem(408, 'The form request timed out. Please try again.')), 6000);
    const cleanup = () => {
      clearTimeout(deadline);
      request.removeListener('data', onData);
      request.removeListener('end', onEnd);
      request.removeListener('error', onError);
      request.removeListener('aborted', onAborted);
    };
    function finish(error, value) {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) {
        // Drain without retaining bytes so the HTTP response can still carry the error.
        // IncomingMessage can emit an error after its aborted event.
        request.once('error', () => {});
        request.resume?.();
        reject(error);
      } else resolve(value);
    }
    function onData(chunk) {
      let bytes;
      try { bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); }
      catch { finish(problem(400, 'Invalid form data.')); return; }
      size += bytes.length;
      if (size > MAX_BODY_BYTES) {
        finish(problem(413, 'Form data is too large.'));
        return;
      }
      chunks.push(bytes);
    }
    function onEnd() { finish(null, Buffer.concat(chunks, size).toString('utf8')); }
    function onError() { finish(problem(400, 'Could not read the form data.')); }
    function onAborted() { finish(problem(400, 'The form request was interrupted. Please try again.')); }
    request.on('data', onData);
    request.once('end', onEnd);
    request.once('error', onError);
    request.once('aborted', onAborted);
  });
}

async function readBody(request) {
  const contentType = header(request, 'content-type');
  if (contentType && !/^application\/json(?:\s*;.*)?$/i.test(contentType.trim())) {
    throw problem(415, 'Send form data as JSON.');
  }
  const length = header(request, 'content-length');
  if (length !== undefined) {
    if (!/^\d+$/.test(length.trim())) throw problem(400, 'Invalid form data.');
    if (Number(length) > MAX_BODY_BYTES) throw problem(413, 'Form data is too large.');
  }

  // Vercel's body helper is a lazy getter: malformed JSON can throw on access.
  let body;
  try { body = request.body; }
  catch (error) {
    throw problem(error?.statusCode === 413 ? 413 : 400, 'Invalid form data.');
  }
  if (body === undefined) body = await rawBody(request);
  if (Buffer.isBuffer(body)) {
    if (body.length > MAX_BODY_BYTES) throw problem(413, 'Form data is too large.');
    body = body.toString('utf8');
  }
  if (typeof body === 'string') {
    if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) throw problem(413, 'Form data is too large.');
    try { body = JSON.parse(body); }
    catch { throw problem(400, 'Invalid form data.'); }
  } else {
    // Parsed helpers need a byte limit too; Content-Length was checked before access.
    let serialized;
    try { serialized = JSON.stringify(body); }
    catch { throw problem(400, 'Invalid form data.'); }
    if (serialized && Buffer.byteLength(serialized, 'utf8') > MAX_BODY_BYTES) {
      throw problem(413, 'Form data is too large.');
    }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw problem(400, 'Invalid form data.');
  return body;
}

function validate(data) {
  const required = ['firstName', 'university', 'faculty', 'whatsapp', 'requestId'];
  if (required.some(key => typeof data[key] !== 'string') ||
      (data.website !== undefined && typeof data.website !== 'string')) throw problem(400, INVALID);
  if (data.website) throw problem(400, 'Could not process the registration.');

  const firstName = data.firstName.trim();
  const university = data.university.trim();
  const faculty = data.faculty.trim();
  const whatsapp = data.whatsapp.replace(/[\s().-]+/g, '').trim();
  const requestId = data.requestId.trim();
  const validText = (value, max) => value.length >= 2 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
  if (!validText(firstName, 80) || !validText(university, 120) || !validText(faculty, 120) ||
      !/^(?:07\d{8}|\+?947\d{8}|\+?\d{8,15})$/.test(whatsapp) ||
      !/^[a-zA-Z0-9-]{8,100}$/.test(requestId)) throw problem(400, INVALID);
  return {
    requestId, firstName, university, faculty, whatsapp
  };
}

module.exports = async function register(request, response) {
  const fail = (status, error) => reply(response, status, { success: false, error });
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return fail(405, 'Method not allowed.');
  }
  const url = process.env.GOOGLE_APPS_SCRIPT_URL;
  const secret = process.env.REGISTRATION_SECRET;
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url || '') ||
      !secret || secret.length < 32 || secret.length > 256) {
    return fail(503, 'Registration is not configured yet. Please contact the organizers.');
  }

  let payload;
  try { payload = validate(await readBody(request)); }
  catch (error) { return fail(error.status || 400, error.status ? error.message : 'Invalid form data.'); }

  const upstreamBody = JSON.stringify({ ...payload, secret });
  if (Buffer.byteLength(upstreamBody, 'utf8') > MAX_BODY_BYTES) {
    return fail(413, 'Form data is too large.');
  }

  const started = Date.now();
  const aborter = new AbortController();
  const deadline = setTimeout(() => aborter.abort(), 16000);
  let attempt = 0;
  let upstreamStatus = null;
  const report = (level, event, code) => console[level](JSON.stringify({
    event, requestId: payload.requestId, attempt, upstreamStatus, upstreamCode: code,
    elapsedMs: Math.max(0, Date.now() - started)
  }));
  const assertBudget = () => {
    if (aborter.signal.aborted || Date.now() - started >= 16000) throw aborted();
  };
  try {
    for (attempt = 1; attempt <= 3; attempt++) {
      assertBudget();
      upstreamStatus = null;
      let upstream;
      let failure;
      try {
        // Every attempt uses the exact same body/request ID: Apps Script deduplicates saves.
        upstream = await fetch(url, {
          method: 'POST', redirect: 'follow',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: upstreamBody, signal: aborter.signal
        });
      } catch (error) {
        if (error?.name === 'AbortError' || aborter.signal.aborted) throw aborted();
        failure = {
          retry: true, code: 'NETWORK_ERROR', status: 503,
          message: 'Could not connect to registration storage. Please try again.'
        };
      }
      assertBudget();
      if (upstream) {
        upstreamStatus = Number.isInteger(upstream.status) ? upstream.status : null;
        if (!upstream.ok) {
          // Release an unused error response without reading or logging its body.
          try { upstream.body?.cancel?.().catch(() => {}); } catch {}
          failure = {
            retry: RETRY_HTTP.has(upstreamStatus), code: 'HTTP_ERROR',
            status: RETRY_HTTP.has(upstreamStatus) || [401, 403].includes(upstreamStatus) ? 503 : 502,
            message: UNAVAILABLE
          };
        } else {
          let result;
          try { result = await upstream.json(); }
          catch (error) {
            if (error?.name === 'AbortError' || aborter.signal.aborted) throw aborted();
            // A TypeError while reading the body can mean a connection lost after a save.
            // Malformed JSON/HTML remains terminal because it can indicate a wrong deployment.
            const transportFailure = error?.name === 'TypeError';
            failure = {
              retry: transportFailure,
              code: transportFailure ? 'NETWORK_ERROR' : 'INVALID_RESPONSE',
              status: transportFailure ? 503 : 502,
              message: transportFailure ? UNAVAILABLE : 'We could not confirm the registration. Please try again.'
            };
          }
          assertBudget();
          if (!failure && result?.success === true) {
            if (attempt > 1) report('warn', 'registration_recovered', 'SUCCESS');
            return reply(response, 200, { success: true });
          }
          if (!failure) {
            const code = STORAGE_CODES.has(result?.code) ? result.code : 'UNKNOWN';
            failure = {
              retry: code === 'BUSY' || code === 'STORAGE_UNAVAILABLE',
              code, status: 503, message: UNAVAILABLE
            };
            if (code === 'DUPLICATE') {
              failure.status = 409;
              failure.message = 'This registration has already been submitted.';
            } else if (code === 'INVALID') {
              failure.status = 400;
              failure.message = INVALID;
            } else if (code === 'PAYLOAD_TOO_LARGE') {
              failure.status = 413;
              failure.message = 'Form data is too large.';
            }
          }
        }
      }
      if (!failure?.retry || attempt === 3) {
        report('error', 'registration_failed', failure?.code || 'UNKNOWN');
        return fail(failure?.status || 503, failure?.message || UNAVAILABLE);
      }
      const delay = [300, 800][attempt - 1] + Math.floor(Math.random() * 101);
      if (Date.now() - started + delay >= 16000) throw aborted();
      report('warn', 'registration_retry', failure.code);
      await backoff(delay, aborter.signal);
    }
  } catch (error) {
    const timedOut = error?.name === 'AbortError' || aborter.signal.aborted;
    report('error', 'registration_failed', timedOut ? 'TIMEOUT' : 'NETWORK_ERROR');
    return fail(503, timedOut ?
      'The server took too long to respond. You can retry safely without creating a duplicate.' :
      'Could not connect to registration storage. Please try again.');
  } finally { clearTimeout(deadline); }
};
