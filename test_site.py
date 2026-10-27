"""Browser checks against real localhost assets, with all backend writes mocked."""

from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
import os
import shutil
import subprocess

ROOT = Path(__file__).resolve().parent
RUNTIME = Path.home() / ".cache/codex-runtimes/codex-primary-runtime/dependencies/node"


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def node_runtime():
    bundled = RUNTIME / "bin/node"
    node = str(bundled) if bundled.is_file() else shutil.which("node")
    if not node:
        raise SystemExit("Node.js is required to run the browser checks.")
    candidates = [ROOT / "node_modules", RUNTIME / "node_modules"]
    if os.environ.get("PLAYWRIGHT_NODE_MODULES"):
        candidates.insert(0, Path(os.environ["PLAYWRIGHT_NODE_MODULES"]))
    module = next((p / "playwright" for p in candidates if (p / "playwright").is_dir()), None)
    if module is None:
        probe = subprocess.run([node, "-p", "require.resolve('playwright')"],
                               cwd=ROOT, capture_output=True, text=True)
        if probe.returncode:
            raise SystemExit("Playwright is required. Install it locally with npm install --no-save playwright.")
        module = Path(probe.stdout.strip())
    return node, module


SCRIPT = r"""
const assert = require('node:assert/strict');
const {chromium} = require(process.env.SITE_TEST_PLAYWRIGHT);
const errors = [], submissions = [];

async function openPage(browser, width, height, reducedMotion = 'no-preference') {
  const context = await browser.newContext({
    viewport: {width, height}, deviceScaleFactor: 1,
    hasTouch: width < 1000, isMobile: width < 768, reducedMotion,
  });
  await context.route('**/*', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    submissions.push(route.request().postDataJSON());
    await route.fulfill({status: 200, contentType: 'application/json', body: '{"success":true}'});
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(process.env.SITE_TEST_URL, {waitUntil: 'load'});
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({content: 'html{scroll-behavior:auto!important}'});
  await page.waitForFunction(() => typeof validate === 'function' && typeof payload === 'function');
  assert.equal(await page.evaluate(() => CONFIG.submissionEndpoint), '/api/register');
  assert.equal(await page.evaluate(() => CONFIG.previewMode), true);
  return {context, page};
}

async function checkLayout(browser, width, height) {
  const {context, page} = await openPage(browser, width, height);
  try {
    const layout = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      ctaBottom: document.querySelector('.register-cta').getBoundingClientRect().bottom,
      cardWidth: document.querySelector('.event-card').getBoundingClientRect().width,
      cardHeight: document.querySelector('.event-card').clientHeight,
      cardContentHeight: document.querySelector('.event-card').scrollHeight,
      cardOverflow: getComputedStyle(document.querySelector('.event-card')).overflow,
    }));
    assert(layout.scrollWidth <= width, `Horizontal overflow at ${width}px: ${JSON.stringify(layout)}`);
    assert(layout.cardWidth >= Math.min(width - 48, 260), 'Event card should remain prominent.');
    assert(layout.cardContentHeight <= layout.cardHeight, `Event card contents are clipped at ${width}x${height}px.`);
    assert.notEqual(layout.cardOverflow, 'hidden', 'The event card must not clip its content.');
    if (height > 560) assert(layout.ctaBottom <= height + 15, `Hero CTA falls below the viewport at ${width}px.`);
    assert.equal(await page.locator('.event-card > strong').innerText(), 'IEEE\nIES DAY');
    assert.match(await page.locator('.event-card-date').innerText(), /12 NOVEMBER 2026/);
    assert.deepEqual(await page.locator('.event-card-time > span').allInnerTexts(), ['9:00 AM', '\u2014', '12 NOON']);
    assert.match(await page.locator('.event-card-location').innerText(), /A11 Building Auditorium.*University of Kelaniya/s);
    assert.equal(await page.locator('.certificate-perk').innerText(), 'E-CERTIFICATE\nFor attendees');
    assert.equal(await page.locator('.quiz-perk').innerText(), 'QUIZ & WIN\nCompete for prizes!');
    assert((await page.locator('.register-cta').innerText()).includes('Register for IEEE IES Day'));
    await page.locator('.register-cta').click();
    await page.locator('#registration').scrollIntoViewIfNeeded();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  } finally { await context.close(); }
}

async function checkRegistration(browser) {
  const {context, page} = await openPage(browser, 390, 844);
  try {
    assert.equal(await page.locator('#registrationForm input[required]').count(), 4);
    assert.equal(await page.locator('#instrumentToggle, #supportToggle, input[name="rehearsal"]').count(), 0);
    assert.equal(await page.locator('#studentId').count(), 0);
    assert.equal(await page.locator('#university').getAttribute('required'), '');
    assert.equal(await page.locator('#faculty').getAttribute('required'), '');
    assert.equal(await page.evaluate(() => validate()), false);

    await page.locator('#firstName').fill('Example User');
    await page.locator('#university').fill('Example University');
    await page.locator('#faculty').fill('Engineering');
    await page.locator('#whatsapp').fill('071 234 5678');
    assert.equal(await page.evaluate(() => validate()), true);
    const previewPayload = await page.evaluate(() => payload());
    assert.equal(previewPayload.university, 'Example University');
    assert.equal(previewPayload.faculty, 'Engineering');
    assert.equal(previewPayload.whatsapp, '0712345678');
    for (const removed of ['studentId', 'singing', 'instruments', 'support', 'rehearsal']) {
      assert.equal(Object.hasOwn(previewPayload, removed), false, `${removed} must not be submitted.`);
    }

    await page.locator('#submitButton').click();
    await page.locator('#confirmationOverlay').waitFor({state: 'visible'});
    assert.match(await page.locator('#confirmationText').innerText(), /IEEE IES Day/);
    assert.match(await page.locator('.modal-perks').innerText(), /e-certificate.*quiz.*win prizes/i);
    assert.equal(submissions.length, 0, 'Local preview must not save registration data.');
    await page.keyboard.press('Escape');
    assert(await page.locator('#confirmationOverlay').isHidden());

    await page.evaluate(() => {
      CONFIG.previewMode = false;
      window.__requests = [];
      window.fetch = async (url, options) => {
        window.__requests.push({url, body: JSON.parse(options.body)});
        return new Response(JSON.stringify({success: true}), {status: 200});
      };
    });
    await page.locator('#submitButton').click();
    await page.locator('#confirmationOverlay').waitFor({state: 'visible'});
    const requests = await page.evaluate(() => window.__requests);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, '/api/register');
    assert.equal(requests[0].body.university, 'Example University');
    assert.equal(requests[0].body.faculty, 'Engineering');
    assert.equal(await page.locator('#registrationForm').isHidden(), true);
    assert.equal(await page.locator('#completedBanner').isVisible(), true);
  } finally { await context.close(); }
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? {executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH} : {}),
  });
  try {
    for (const [width, height] of [[280,640], [320,568], [320,700], [390,844], [430,932], [768,1024], [844,390], [1440,900]]) {
      await checkLayout(browser, width, height);
    }
    await checkRegistration(browser);
    const {context, page} = await openPage(browser, 390, 844, 'reduce');
    try {
      assert.equal(await page.locator('.snow-canvas').count(), 0);
      assert.equal(await page.locator('.event-card').evaluate(element => getComputedStyle(element).animationName), 'none');
    } finally { await context.close(); }
    assert.deepEqual(errors, [], 'No uncaught browser errors are allowed.');
    console.log('PASS: responsive IEEE IES Day hero, four registration fields, removed legacy questions, local preview, mocked submission, and reduced motion.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
"""


def main():
    node, playwright_module = node_runtime()
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=str(ROOT)))
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    environment = os.environ.copy()
    environment.update({
        "SITE_TEST_PLAYWRIGHT": str(playwright_module),
        "SITE_TEST_URL": f"http://127.0.0.1:{server.server_port}/",
    })
    try:
        return subprocess.run([node, "-"], input=SCRIPT, text=True, cwd=ROOT, env=environment).returncode
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


if __name__ == "__main__":
    raise SystemExit(main())
