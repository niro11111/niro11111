const {chromium}=require('playwright');
(async()=>{const b=await chromium.launch();const ctx=await b.newContext({viewport:{width:1300,height:900}});await ctx.grantPermissions(['clipboard-read','clipboard-write']);
await ctx.addInitScript(()=>{const store={};let subs=[];window.__store=store;
 const doc=p=>({get:async()=>({exists:p in store,data:()=>store[p]}),set:async d=>{store[p]=d;subs.forEach(f=>f({exists:true,data:()=>d}));},onSnapshot:(n)=>{subs.push(n);if(p in store)n({exists:true,data:()=>store[p]});return()=>{};}});
 window.__remote=(d)=>{subs.forEach(f=>f({exists:true,data:()=>d}));};
 window.claude={use:async n=>n==="db"?{doc}:n==="user"?{id:async()=>"u1"}:null};});
const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));await p.route(/^https:/,r=>r.abort());
const U='file://'+require('path').resolve(__dirname,'..')+'/index.html';
await p.goto(U+'#dashboard');await p.waitForTimeout(1500);
console.log('toc',await p.$$eval('#toc button',x=>x.length),'kpis',await p.$$eval('#dbKpis div',x=>x.length),'levels',await p.$$eval('.lvrow',x=>x.length),'sync',await p.$eval('#dbSync',e=>e.textContent));
// mistakes: answer wrong in install quiz
await p.goto(U+'#install');await p.waitForTimeout(200);
const wrong=await p.evaluate(()=>{const q=document.querySelector('#install .q');const labels=[...q.querySelectorAll('label')];return labels.findIndex(l=>true)});
// choose an option that is wrong: find via Q
const wi=await p.evaluate(()=>{for(let j=0;j<4;j++){} return 0});
await p.evaluate(()=>{const q=document.querySelector('#install .q[data-i="0"]');const inputs=q.querySelectorAll('input');for(const inp of inputs){inp.click();break;}});
await p.goto(U+'#dashboard');await p.waitForTimeout(300);console.log('mistakes',await p.$eval('#dbMist',e=>e.innerText.split('\n')[0]));
// placement
await p.click('#plStart');for(let n=0;n<10;n++)await p.click(`#dbPlace input[name="pq${n}"] >> nth=0`);await p.click('#plDone');console.log('placement',await p.$eval('#dbPlace',e=>e.innerText.slice(0,60)));
// backup / restore
await p.click('#dbBackup');const code=await p.evaluate(()=>navigator.clipboard.readText());console.log('backup prefix',code.slice(0,5),code.length>50);
await p.click('#dbRestoreBtn');await p.fill('#dbRestoreIn',code);await p.click('#dbRestoreGo');console.log('restore',await p.$eval('#dbRestoreMsg',e=>e.textContent));
await p.fill('#dbRestoreIn','garbage');await p.click('#dbRestoreGo');console.log('bad restore',await p.$eval('#dbRestoreMsg',e=>e.textContent).then(t=>t.slice(0,20)));
// live sync from "other device"
const xpBefore=await p.$eval('#sXp',e=>+e.textContent);
await p.evaluate(()=>{const data={state:{done:{},xp:999,awarded:{"remote-thing":500},days:[]}};window.__remote({v:2,at:Date.now()+5000,dev:"other",data:JSON.stringify(data)});});
await p.waitForTimeout(300);console.log('xp before',xpBefore,'after remote',await p.$eval('#sXp',e=>e.textContent));
await p.click('#dbSyncNow');await p.waitForTimeout(300);console.log('sync now',await p.$eval('#dbSync',e=>e.textContent));
// analyzer demo + real file upload
await p.goto(U+'#analyzer');await p.waitForTimeout(200);await p.click('#azDemo');
console.log('az report',await p.$eval('#azReport',e=>e.innerText.replace(/\s+/g,' ').slice(0,200)));
console.log('az settings ok',!!JSON.parse(await p.$eval('#azSet pre',e=>e.textContent)).permissions,'mcp lines',(await p.$eval('#azMcp pre',e=>e.textContent)).split('\n').length);
await p.setInputFiles('#azFiles',[''+require('path').resolve(__dirname,'..')+'/examples/kitzur/package.json',''+require('path').resolve(__dirname,'..')+'/examples/kitzur/Dockerfile',''+require('path').resolve(__dirname,'..')+'/examples/kitzur/tsconfig.json']);await p.waitForTimeout(300);
console.log('kitzur detect',await p.$eval('#azReport',e=>e.innerText.replace(/\s+/g,' ').slice(0,160)));
console.log('kitzur mem cmds',(await p.$eval('#azMem pre',e=>e.textContent)).match(/`npm[^`]*`/g));
// shortcuts
await p.keyboard.press('?');console.log('keys open',!(await p.$eval('#keys',e=>e.hidden)));await p.keyboard.press('Escape');
await p.keyboard.press('g');await p.keyboard.press('s');await p.waitForTimeout(100);console.log('g s ->',await p.evaluate(()=>location.hash));
await p.keyboard.press('Alt+ArrowLeft');await p.waitForTimeout(100);console.log('alt-left ->',await p.evaluate(()=>location.hash),'title',await p.title());
console.log('badges',await p.$eval('#badgeBtn',e=>e.textContent));
await p.goto(U+'#dashboard');await p.waitForTimeout(200);await p.screenshot({path:''+require('path').resolve(__dirname,'..')+'/.work/d1.png'});
await p.goto(U+'#analyzer');await p.waitForTimeout(200);await p.screenshot({path:''+require('path').resolve(__dirname,'..')+'/.work/d2.png'});
await p.setViewportSize({width:390,height:844});
for(const id of ['dashboard','analyzer']){await p.goto(U+'#'+id);await p.waitForTimeout(200);const w=await p.evaluate(()=>document.documentElement.scrollWidth);if(w>390)console.log('WIDE',id,w);}
console.log('errors',errs);await b.close();})();
