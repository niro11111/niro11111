// Runs the expert-pack install script in a temp dir and validates every generated file with the in-page checker.
const {chromium}=require('playwright');const fs=require('fs');const path=require('path');const os=require('os');const {execSync}=require('child_process');
const U='file://'+path.resolve(__dirname,'..')+'/index.html';
(async()=>{const b=await chromium.launch();const p=await b.newPage();await p.route(/^https:/,r=>r.abort());
await p.goto(U+'#cmdpack');await p.waitForTimeout(500);await p.click('#cpAll');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pack-'));fs.writeFileSync(dir+'/install.sh',await p.$eval('#cpScript pre',e=>e.textContent));
execSync('bash install.sh',{cwd:dir});const again=execSync('bash install.sh',{cwd:dir}).toString();
const files=[];(function walk(d){for(const f of fs.readdirSync(d)){const q=path.join(d,f);fs.statSync(q).isDirectory()?walk(q):files.push(q)}})(dir+'/.claude');
let errs=0,warns=0;for(const f of files){const r=await p.evaluate(t=>window.checkConfig(t),fs.readFileSync(f,'utf8'));const e=r.items.filter(x=>x[0]==='err'),w=r.items.filter(x=>x[0]==='warn');errs+=e.length;warns+=w.length;if(e.length||w.length)console.log(path.relative(dir,f),e.concat(w).map(x=>x[1]).join(' | '));}
console.log('files',files.length,'skipped on rerun',(again.match(/skip/g)||[]).length,'errors',errs,'warnings',warns);
fs.rmSync(dir,{recursive:true});await b.close();process.exit(errs?1:0);})();
