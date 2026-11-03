const {chromium}=require('playwright');const fs=require('fs');const SP=process.argv[2]||require('os').tmpdir();require('fs').mkdirSync(SP+'/packtest',{recursive:true});
(async()=>{const b=await chromium.launch();const ctx=await b.newContext({viewport:{width:1300,height:900}});await ctx.grantPermissions(['clipboard-read','clipboard-write']);
const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));await p.route(/^https:/,r=>r.abort());
const U='file://'+require('path').resolve(__dirname,'..')+'/index.html';
await p.goto(U+'#cmdpack');await p.waitForTimeout(500);
console.log('toc',await p.$$eval('#toc button',x=>x.length),'pack items',await p.$$eval('#cpList details',x=>x.length),await p.$eval('#cpCount',e=>e.textContent));
await p.click('#cpAll');console.log('after all',await p.$eval('#cpCount',e=>e.textContent));
fs.writeFileSync(SP+'/packtest/install.sh',await p.$eval('#cpScript pre',e=>e.textContent));
await p.click('#cpFilter button:nth-child(3)');console.log('agents filter',await p.$$eval('#cpList details',x=>x.length));
await p.goto(U+'#promptpro');await p.waitForTimeout(300);console.log('patterns',await p.$$eval('#ppList .trick',x=>x.length),'score',await p.$eval('#pbScore',e=>e.textContent));
await p.click('#pbToLab');await p.waitForTimeout(200);console.log('lab',await p.evaluate(()=>location.hash),await p.$eval('.score b',e=>e.textContent));
await p.goto(U+'#gallery');await p.waitForTimeout(300);await p.click('#slTabs button:nth-child(3)');console.log('statusline',(await p.$eval('#slCode pre',e=>e.textContent)).includes('rev-list'),'hooks',await p.$$eval('#hxList .trick',x=>x.length));
await p.goto(U+'#intrecipes');await p.waitForTimeout(200);console.log('recipes',await p.$$eval('#irTabs button',x=>x.length));
await p.goto(U+'#intbuilder');await p.waitForTimeout(200);await p.check('#ibTools input[value="stripe"]');console.log('stripe in mcp',Object.keys(JSON.parse(await p.$eval('#ibMcp pre',e=>e.textContent)).mcpServers).includes('stripe'));
await p.goto(U+'#prototype');await p.waitForTimeout(300);
for(const t of ['landing','dashboard','mobile','wizard','kanban']){await p.selectOption('#ptType',t);await p.waitForTimeout(150);const f=p.frame({url:/about:srcdoc/})||p.frames()[1];const txt=f?await f.evaluate(()=>document.body.innerText.length):-1;console.log('proto',t,'text',txt);}
await p.selectOption('#ptLang','en');await p.waitForTimeout(150);console.log('en dir',await p.frames()[1].evaluate(()=>document.documentElement.dir));
fs.writeFileSync(SP+'/packtest/proto.html',await p.$eval('#ptCode pre',e=>e.textContent));
await p.screenshot({path:SP+'/p1.png'});
await p.goto(U+'#hidden');await p.waitForTimeout(200);console.log(await p.$eval('#secCount',e=>e.textContent));
// themes
await p.click('#lookBtn');console.log('looks',await p.$$eval('.look',x=>x.length),'retro locked',await p.$eval('[data-look="retro"]',e=>e.disabled));
await p.click('[data-look="midnight"]');console.log('theme class',await p.evaluate(()=>document.documentElement.className));
await p.fill('#lookScale','120');await p.dispatchEvent('#lookScale','input');console.log('fs',await p.evaluate(()=>getComputedStyle(document.body).fontSize));
await p.click('#lookCompact');await p.keyboard.press('Escape');await p.goto(U+'#dashboard');await p.waitForTimeout(200);await p.screenshot({path:SP+'/p2.png'});
await p.click('#lookBtn');await p.click('[data-look="default"]');await p.fill('#lookScale','100');await p.dispatchEvent('#lookScale','input');await p.click('#lookCompact');await p.keyboard.press('Escape');
console.log('badges',await p.$eval('#badgeBtn',e=>e.textContent));
await p.setViewportSize({width:390,height:844});
for(const id of ['cmdpack','promptpro','gallery','prototype']){await p.goto(U+'#'+id);await p.waitForTimeout(200);const w=await p.evaluate(()=>document.documentElement.scrollWidth);if(w>390)console.log('WIDE',id,w);}
console.log('errors',errs);await b.close();})();
