// Two simulated devices share one fake db document; checks every sync path.
const {chromium}=require('playwright');const path=require('path');
const U='file://'+path.resolve(__dirname,'..')+'/index.html';
(async()=>{
const b=await chromium.launch();const DB={};const pages=[];
const ok=(c,m)=>console.log((c?'PASS ':'FAIL ')+m);
async function device(name){
  const ctx=await b.newContext({viewport:{width:1280,height:900}});
  await ctx.exposeBinding('__dbGet',(src,p)=>DB[p]?JSON.stringify(DB[p]):null);
  await ctx.exposeBinding('__dbSet',async(src,p,d)=>{DB[p]=JSON.parse(d);for(const pg of pages){if(pg!==src.page)await pg.evaluate(([p,d])=>window.__notify&&window.__notify(p,d),[p,d]).catch(()=>{});}});
  await ctx.addInitScript(()=>{const subs={};window.__notify=(p,d)=>(subs[p]||[]).forEach(f=>f({exists:true,data:()=>JSON.parse(d)}));
    const doc=p=>({get:async()=>{const v=await window.__dbGet(p);return {exists:!!v,data:()=>JSON.parse(v)}},set:async d=>{await window.__dbSet(p,JSON.stringify(d))},onSnapshot:(n)=>{(subs[p]=subs[p]||[]).push(n);return()=>{}}});
    window.claude={use:async n=>n==='db'?{doc}:n==='user'?{id:async()=>'u1'}:null};});
  const p=await ctx.newPage();p.errs=[];p.on('pageerror',e=>p.errs.push(e.message));await p.route(/^https:/,r=>r.abort());
  pages.push(p);await p.goto(U+'#install');await p.waitForTimeout(1200);return p;
}
const xp=p=>p.$eval('#sXp',e=>+e.textContent);
const settle=()=>new Promise(r=>setTimeout(r,2600));
const A=await device('A');
// A: quiz, note, track, appearance, dark mode
await A.evaluate(()=>{document.querySelectorAll('#install .q').forEach(q=>{const i=+q.dataset.i;const inputs=q.querySelectorAll('input');inputs.forEach(x=>{});});});
for(let i=0;i<3;i++){await A.evaluate(i=>{const q=document.querySelector('#install .q[data-i="'+i+'"]');for(const inp of q.querySelectorAll('input')){inp.click();if(q.querySelector('label.r input')===inp)break;}},i);}
// answer correctly: click the option that got class r
for(let i=0;i<3;i++){await A.evaluate(i=>{const q=document.querySelector('#install .q[data-i="'+i+'"]');q.querySelector('label.r input').click();},i);}
await A.click('#install details.notes summary');await A.fill('#install [data-note]','note from A');
await A.goto(U+'#tracks');await A.waitForTimeout(200);await A.click('[data-track="be"]');
await A.click('#lookBtn');await A.click('[data-look="ocean"]');await A.keyboard.press('Escape');
await A.click('#themeBtn');
await settle();
const xpA=await xp(A);ok(xpA>0,'A earned XP ('+xpA+')');
// B loads fresh and receives everything
const B=await device('B');await B.waitForTimeout(500);
ok(await xp(B)===xpA,'B sees same XP ('+await xp(B)+')');
ok(await B.evaluate(()=>JSON.parse(localStorage.getItem('cca-notes')||'{}').install==='note from A'),'B sees A note');
ok(await B.evaluate(()=>JSON.parse(localStorage.getItem('cca-track'))==='be'),'B sees track');
ok(await B.evaluate(()=>document.documentElement.classList.contains('theme-ocean')),'B has ocean theme');
ok(await B.evaluate(()=>!!document.documentElement.dataset.theme),'B has light/dark choice');
// B deletes the note -> A gets it live
await B.goto(U+'#install');await B.waitForTimeout(200);await B.evaluate(()=>document.querySelector('#install details.notes').open=true);await B.fill('#install [data-note]','');await settle();
ok(await A.evaluate(()=>!JSON.parse(localStorage.getItem('cca-notes')||'{}').install),'note deletion reached A live');
// concurrent: both earn different awards, then both push
await A.evaluate(()=>{});await A.goto(U+'#tracks');
await A.evaluate(()=>window.__testAward&&0);
const before=await xp(A);
await Promise.all([A.goto(U+'#dashboard').then(()=>A.click('#dbBackup')), B.goto(U+'#analyzer').then(()=>B.click('#azDemo'))]);
await settle();await settle();
const xa=await xp(A), xb=await xp(B);
ok(xa===xb && xa>=before+30,'concurrent awards merged on both (A '+xa+', B '+xb+', before '+before+')');
// reset on A -> B resets too
await A.click('#resetBtn');await A.click('#resetBtn');await settle();
ok(await xp(A)===0,'A reset to 0');ok(await xp(B)===0,'B reset to 0 via sync');
ok(await B.evaluate(()=>JSON.parse(localStorage.getItem('cca-track'))==='be'),'preferences kept after reset');
// earn after reset on B -> A gets it (reset does not swallow new progress forever)
await B.goto(U+'#dashboard');await B.click('#dbBackup');await settle();
ok(await xp(A)===10&&await xp(B)===10,'progress after reset syncs (A '+await xp(A)+', B '+await xp(B)+')');
console.log('errors A',A.errs,'B',B.errs);
// private mode: storage throws
const ctx2=await b.newContext();await ctx2.addInitScript(()=>{Object.defineProperty(window,'localStorage',{get(){throw new Error('denied')}});});
const P=await ctx2.newPage();const pe=[];P.on('pageerror',e=>pe.push(e.message));await P.route(/^https:/,r=>r.abort());await P.goto(U+'#dashboard');await P.waitForTimeout(800);
await P.click('#toc [data-go="install"]');ok(pe.length===0,'private mode: no errors '+JSON.stringify(pe));
// tutor declined
const ctx3=await b.newContext();await ctx3.addInitScript(()=>{const s=async()=>{throw {code:'not_granted',message:'no'}};window.claude={use:async n=>n==='sample'?s:null};});
const T=await ctx3.newPage();const te=[];T.on('pageerror',e=>te.push(e.message));await T.route(/^https:/,r=>r.abort());await T.goto(U+'#install');await T.waitForTimeout(800);
await T.click('#tutorFab');await T.fill('#tutorQ','hi');await T.click('#tutorSend');await T.waitForTimeout(4000);
ok(await T.$eval('#tutorFab',e=>e.hidden),'tutor hides after not_granted');ok(te.length===0,'tutor declined: no errors '+JSON.stringify(te));
await b.close();})();
