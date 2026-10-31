const {chromium}=require('playwright');
(async()=>{const b=await chromium.launch();const ctx=await b.newContext({viewport:{width:1300,height:900}});
await ctx.grantPermissions(['clipboard-read','clipboard-write']);
const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));await p.route(/^https:/,r=>r.abort());
const U='file://'+require('path').resolve(__dirname,'..')+'/index.html';await p.goto(U);await p.waitForTimeout(600);
// static link checks
const bad=await p.evaluate(()=>{const ids=new Set([...document.querySelectorAll('.mod')].map(m=>m.id));const out=[];
 document.querySelectorAll('[data-go]').forEach(e=>{if(!ids.has(e.dataset.go))out.push('data-go '+e.dataset.go)});
 document.querySelectorAll('a[href^="#"]').forEach(e=>{const h=e.getAttribute('href').slice(1);if(h&&!ids.has(h))out.push('href #'+h)});
 document.querySelectorAll('.quiz').forEach(q=>{if(!q.children.length)out.push('empty quiz '+q.dataset.q)});
 document.querySelectorAll('.mod').forEach(m=>{if(!m.querySelector('h1'))out.push('no h1 '+m.id)});
 return out;});
console.log('static issues',bad);
const ids=await p.$$eval('.mod',x=>x.map(m=>m.id));
const sig=()=>p.evaluate(()=>{const m=document.querySelector('.mod.on');return [location.hash,(m?m.innerHTML.length+'|'+m.innerText.length:''),document.querySelector('#toast')?.className,[...document.querySelectorAll('.pal,.tutor')].map(x=>x.hidden).join(),document.documentElement.className,localStorage.length,JSON.stringify(Object.keys(localStorage).map(k=>localStorage.getItem(k).length))].join('#')});
const dead=[];
for(const id of ids){
  await p.goto(U+'#'+id);await p.waitForTimeout(150);
  const n=await p.$$eval('.mod.on button',x=>x.length);
  for(let i=0;i<n;i++){
    await p.goto(U+'#'+id);await p.waitForTimeout(80);
    const btns=await p.$$('.mod.on button');const bt=btns[i];if(!bt)continue;
    if(!(await bt.isVisible())||!(await bt.isEnabled())||await bt.evaluate(e=>e.classList.contains('on')))continue;
    const label=(await bt.innerText()).trim().slice(0,30);
    if(/איפוס/.test(label))continue;
    const before=await sig();let clip0=await p.evaluate(()=>navigator.clipboard.readText().catch(()=>''));
    try{await bt.click({timeout:2000});}catch(e){dead.push(id+': "'+label+'" not clickable');continue;}
    await p.waitForTimeout(120);
    const after=await sig();const clip1=await p.evaluate(()=>navigator.clipboard.readText().catch(()=>''));
    if(before===after&&clip0===clip1)dead.push(id+': "'+label+'"');
  }
}
console.log('buttons without visible effect:',dead.length);dead.forEach(d=>console.log('  ',d));
// rail tools
console.log('errors',errs.slice(0,10));await b.close();})();
