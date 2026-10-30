'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {execFileSync} = require('node:child_process');

const root = path.resolve(__dirname, '..');
const browserAssets = ['styles.css', 'form-theme.css', 'site.js', 'assets/ies-day-logo.png', 'assets/ies-day-main-poster.webp'];

function fingerprint(source, bytes) {
  const extension = path.extname(source);
  const digest = createHash('sha256').update(bytes).digest('hex').slice(0, 12);
  return `assets/${path.basename(source, extension)}.${digest}${extension}`;
}

function filesIn(directory, prefix = '') {
  return fs.readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
    const relative = prefix + entry.name;
    return entry.isDirectory() ? filesIn(path.join(directory, entry.name), relative + '/') : [relative];
  });
}

test('production build publishes only fingerprinted browser assets and rewrites local references', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'carols-build-'));
  try {
    const fixtureFiles = ['index.html', 'scripts/build.cjs', ...browserAssets];
    for (const source of fixtureFiles) {
      const destination = path.join(fixture, source);
      fs.mkdirSync(path.dirname(destination), {recursive: true});
      fs.copyFileSync(path.join(root, source), destination);
    }
    // Private/deployment inputs must never be copied to the public output.
    for (const source of ['.env', '.env.local', '.env.example', 'README.md', 'google-apps-script/Code.gs', 'netlify/functions/register.js', 'test_site.py',
      'package.json', 'dist/stale-secret.txt']) {
      const destination = path.join(fixture, source);
      fs.mkdirSync(path.dirname(destination), {recursive: true});
      fs.writeFileSync(destination, 'PRIVATE_BUILD_SENTINEL');
    }
    const build = () => execFileSync(process.execPath, [path.join(fixture, 'scripts/build.cjs')],
      {cwd: fixture, encoding: 'utf8'});
    build();
    const output = path.join(fixture, 'dist');
    const markup = fs.readFileSync(path.join(output, 'index.html'), 'utf8');
    const expectedFiles = ['index.html'];
    for (const source of browserAssets) {
      const bytes = fs.readFileSync(path.join(fixture, source));
      const destination = fingerprint(source, bytes);
      expectedFiles.push(destination);
      assert.deepEqual(fs.readFileSync(path.join(output, destination)), bytes);
      assert(markup.includes(destination), `Missing rewritten reference for ${source}`);
      assert(!markup.includes(`"${source}"`), `Unfingerprinted HTML reference remains: ${source}`);
    }
    assert.deepEqual(filesIn(output).sort(), expectedFiles.sort());
    assert(!markup.includes('PRIVATE_BUILD_SENTINEL'));
    for (const [, reference] of markup.matchAll(/(?:src|href|content)="(assets\/[^"?#]+)(?:[?#][^"]*)?"/g)) {
      assert(fs.statSync(path.join(output, reference)).isFile(), `Missing local asset: ${reference}`);
    }

    const originalScript = fs.readFileSync(path.join(fixture, 'site.js'));
    const oldFilename = fingerprint('site.js', originalScript);
    const changedScript = Buffer.concat([originalScript, Buffer.from('\n// fingerprint regression\n')]);
    fs.writeFileSync(path.join(fixture, 'site.js'), changedScript);
    build();
    const newFilename = fingerprint('site.js', changedScript);
    assert.notEqual(newFilename, oldFilename);
    assert(!fs.existsSync(path.join(output, oldFilename)), 'A rebuild should remove stale hashed assets.');
    assert(fs.readFileSync(path.join(output, 'index.html'), 'utf8').includes(newFilename));
    assert.equal(filesIn(output).length, expectedFiles.length);
  } finally {
    fs.rmSync(fixture, {recursive: true, force: true});
  }
});
