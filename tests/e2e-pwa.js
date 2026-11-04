// Serves site/ locally and checks the installable app: manifest, service worker, offline start, update notice.
const {chromium}=require('playwright');const http=require('http');const fs=require('fs');const path=require('path');
const ROOT=path.resolve(__dirname,'..','site');let swOverride=null;
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript','.webmanifest':'application/manifest+json','.png':'image/png','.svg':'image/svg+xml'};
const srv=http.createServer((q,r)=>{let f=decodeURIComponent(q.url.split('?')[0]);if(f.endsWith('/'))f+='index.html';const fp=path.join(ROOT,f);
  if(f==='/sw.js'&&swOverride){r.writeHead(200,{'content-type':'text/javascript'});return r.end(swOverride);}
  fs.readFile(fp,(e,d)=>{if(e){r.writeHead(404);return r.end('nf');}r.writeHead(200,{'content-type':types[path.extname(fp)]||'application/octet-stream'});r.end(d);});}).listen(8765);
const ok=(c,m)=>console.log((c?'PASS ':'FAIL ')+m);
(async()=>{const b=await chromium.launch();const ctx=await b.newContext();const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));
await ctx.route(/^https:\/\/fonts/,r=>r.abort());
await p.goto('http://localhost:8765/');await p.waitForFunction(()=>navigator.serviceWorker.controller||navigator.serviceWorker.ready,null,{timeout:10000});
await p.evaluate(()=>navigator.serviceWorker.ready);await p.reload();await p.waitForTimeout(800);
ok(await p.evaluate(()=>!!navigator.serviceWorker.controller),'service worker controls the page');
const man=await p.evaluate(async()=>{const l=document.querySelector('link[rel=manifest]');const j=await (await fetch(l.href)).json();return j;});
ok(man.name&&man.start_url&&man.display==='standalone'&&man.icons.some(i=>i.sizes==='512x512'),'manifest valid ('+man.short_name+')');
for(const i of man.icons){const s=await p.evaluate(async u=>(await fetch(u)).status,new URL(i.src,'http://localhost:8765/').href);ok(s===200,'icon '+i.src);}
ok(await p.$$eval('#toc button',x=>x.length)===58,'58 chapters online');
await ctx.setOffline(true);await p.reload();await p.waitForTimeout(800);
ok(await p.$$eval('#toc button',x=>x.length)===58,'app opens offline with 58 chapters');
await p.goto('http://localhost:8765/#sim');await p.waitForTimeout(300);ok(await p.$eval('.mod.on',e=>e.id)==='sim','offline deep link #sim');
await p.waitForTimeout(1200);ok((await p.$eval('#syncStatus',e=>e.textContent)).includes('לא מקוון'),'status shows offline note');
await ctx.setOffline(false);
// update flow: serve a changed service worker
swOverride=fs.readFileSync(path.join(ROOT,'sw.js'),'utf8').replace(/const VERSION = "[^"]+"/,'const VERSION = "test-update"');
await p.reload();await p.waitForTimeout(500);await p.evaluate(()=>navigator.serviceWorker.getRegistration().then(r=>r.update()));await p.waitForTimeout(1500);
ok(await p.evaluate(()=>[...document.querySelectorAll('.rail-tools button')].some(b=>b.textContent.includes('גרסה חדשה'))),'update button appears for a new version');
ok(await p.evaluate(()=>!!document.getElementById('installBtn')),'install button exists');
ok(errs.length===0,'no page errors '+JSON.stringify(errs));
await b.close();srv.close();})();
