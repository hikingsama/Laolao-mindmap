'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{patch}=require('./patch-pdf-background.cjs');
const root=path.resolve(__dirname,'../vendor/pdfjs'),file=fs.readFileSync(path.join(root,'build/pdf.mjs')),source=file.toString('utf8'),manifest=JSON.parse(fs.readFileSync(path.join(root,'assets.json'),'utf8'));
assert.equal(patch(source),source,'Vendor extension must be idempotent');
assert.throws(()=>patch('a future PDF.js version with a different API'),/review/,'Future vendor versions cannot silently lose the extension');
const entry=manifest.files.find(f=>f.path==='build/pdf.mjs');assert.equal(entry.sha256,crypto.createHash('sha256').update(file).digest('hex'));assert.equal(entry.bytes,file.length);assert.equal(manifest.bytes,manifest.files.reduce((n,f)=>n+f.bytes,0));assert(manifest.patches.includes('offscreen-render-scheduling-v1'));
console.log('PASS PDF.js patch is idempotent, version-guarded and covered by the asset integrity manifest.');
