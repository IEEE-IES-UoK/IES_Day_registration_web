'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist');
// Publish an explicit list of browser assets; server code and setup files stay private.
const assets = ['styles.css', 'form-theme.css', 'site.js'];
let markup = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
fs.rmSync(output, {recursive: true, force: true});
fs.mkdirSync(path.join(output, 'assets'), {recursive: true});
let totalBytes = 0;
for (const source of assets) {
  const bytes = fs.readFileSync(path.join(root, source));
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 12);
  const extension = path.extname(source);
  const name = path.basename(source, extension);
  const destination = `assets/${name}.${hash}${extension}`;
  markup = markup.split(source).join(destination);
  fs.writeFileSync(path.join(output, destination), bytes);
  totalBytes += bytes.length;
}
fs.writeFileSync(path.join(output, 'index.html'), markup);
console.log(`Built index.html and ${assets.length} fingerprinted assets (${Math.round(totalBytes / 1024)} KB).`);
