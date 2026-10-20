// Reproducible, integrity-checked browser assets; no npm install or scripts.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const version='6.4.299',integrity='AVl138zALtfaAPvADulE0PZThbYzCBS79nL4pOSL/6Sm/4AH5A21BD9VHt97OlCuzJuCpmeZtAtkinisF4Vb1g==';
(async()=>{
  const response=await fetch(`https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-${version}.tgz`);if(!response.ok)throw Error(response.status);
  const bytes=Buffer.from(await response.arrayBuffer());if(crypto.createHash('sha512').update(bytes).digest('base64')!==integrity)throw Error('PDF.js integrity mismatch');
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'mm-pdf-assets-')),dest=path.resolve(__dirname,'../vendor/pdfjs');
  try{
    const archive=path.join(temp,'package.tgz');fs.writeFileSync(archive,bytes);cp.execFileSync('tar',['-xzf',archive,'-C',temp]);fs.mkdirSync(dest,{recursive:true});
    for(const name of ['LICENSE','build/pdf.mjs','build/pdf.worker.mjs','web/pdf_viewer.mjs','web/pdf_viewer.css','web/images','cmaps','standard_fonts','wasm']){fs.mkdirSync(path.dirname(path.join(dest,name)),{recursive:true});fs.cpSync(path.join(temp,'package',name),path.join(dest,name),{recursive:true});}
    const files=[];function scan(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,e.name);if(e.isDirectory())scan(file);else if(e.name!=='assets.json'){const b=fs.readFileSync(file);files.push({path:path.relative(dest,file).replaceAll('\\','/'),bytes:b.length,sha256:crypto.createHash('sha256').update(b).digest('hex')});}}}scan(dest);
    fs.writeFileSync(path.join(dest,'assets.json'),JSON.stringify({version,license:'Apache-2.0',source:`https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-${version}.tgz`,integrity:'sha512-'+integrity,bytes:files.reduce((n,f)=>n+f.bytes,0),files},null,2));
    console.log(`PDF.js ${version}: ${files.length} files, ${files.reduce((n,f)=>n+f.bytes,0)} bytes`);
  }finally{if(path.dirname(path.resolve(temp))===path.resolve(os.tmpdir())&&path.basename(temp).startsWith('mm-pdf-assets-'))fs.rmSync(temp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
