// Frontend test against the mock backend. Run: node tests/web.e2e.js   (needs playwright + chromium)
const http=require('http'),fs=require('fs'),path=require('path');const {chromium}=require('playwright');
const W=path.join(__dirname,'..','web');let pass=0,fail=0;const ok=(n,c,x)=>{c?(pass++,console.log('PASS',n)):(fail++,console.log('FAIL',n,x||''))};
const srv=http.createServer((q,r)=>{let f=q.url.split('?')[0].replace(/^\//,'')||'index.html';
  if(f==='backend.js'){r.setHeader('content-type','text/javascript');return r.end(fs.readFileSync(path.join(__dirname,'mock-backend.js')))}
  if(f==='config.js'){r.setHeader('content-type','text/javascript');return r.end('window.XO_CONFIG={supabaseUrl:"https://x.supabase.co",supabaseAnonKey:"k",cardPayments:true,whatsapp:"2349093813119"}')}
  const p=path.join(W,f);if(!fs.existsSync(p)){r.statusCode=404;return r.end()}r.setHeader('content-type',f.endsWith('.js')?'text/javascript':'text/html');r.end(fs.readFileSync(p))});
(async()=>{await new Promise(r=>srv.listen(5598,r));const b=await chromium.launch();
 for(const w of [390,1280]){const pg=await b.newPage({viewport:{width:w,height:800}});const errs=[];pg.on('pageerror',e=>errs.push(e.message));
  await pg.route(/fonts\.|jsdelivr/,r=>r.abort());await pg.goto('http://localhost:5598/');await pg.waitForSelector('#homeGrid .card');
  ok(w+' login button says Login',(await pg.locator('#ownerBtn').textContent())==='Login'&&(await pg.textContent('#tabLoginL'))==='Login');
  const tb=await pg.locator('.tabbar').isVisible();ok(w+' tab bar only on phones',tb===(w<900));
  ok(w+' cart pill only on desktop',(await pg.locator('.cartpill').isVisible())===(w>=900));
  ok(w+' card has 3 rotating slides',await pg.locator('#homeGrid .card .sl').count()===3);
  const first=await pg.evaluate(()=>[...document.querySelectorAll('#homeGrid .card .sl')].findIndex(x=>x.classList.contains('on')));
  await pg.waitForTimeout(6500);
  const later=await pg.evaluate(()=>[...document.querySelectorAll('#homeGrid .card .sl')].findIndex(x=>x.classList.contains('on')));
  ok(w+' slides advance by themselves',later!==first,first+'->'+later);
  ok(w+' stage has 3D sway',(await pg.evaluate(()=>getComputedStyle(document.querySelector('.stage')).animationName))==='sway');
  await pg.click('#homeGrid .card');await pg.waitForTimeout(300);
  const sel=await pg.$('#pdp select, #pdp [data-act=size]');
  await pg.evaluate(()=>{});
  ok(w+' no page errors',errs.length===0,errs.join('|'));
  await pg.close()}
 // admin: profit and multi upload
 const pg=await b.newPage({viewport:{width:1280,height:900}});const errs=[];pg.on('pageerror',e=>errs.push(e.message));
 await pg.route(/fonts\.|jsdelivr/,r=>r.abort());await pg.goto('http://localhost:5598/#/admin');await pg.waitForSelector('#loginForm');
 ok('login design has brand panel',await pg.locator('.pbrand').count()===1&&(await pg.textContent('.pform h2'))==='Login');
 await pg.evaluate(()=>{window.__DB.admin=true});
 const src=fs.readFileSync(path.join(__dirname,'mock-backend.js'),'utf8');
 await pg.fill('#lgE','a@b.com');await pg.fill('#lgP','ok');await pg.click('#loginForm button[type=submit]');await pg.waitForTimeout(500);
 ok('dashboard opens',await pg.locator('.tabs').count()>0,await pg.locator('#lgErr').textContent().catch(()=>''));
 ok('dashboard nav says Dashboard',(await pg.textContent('#ownerBtn'))==='Dashboard');
 await pg.click('[data-act=atab][data-v=profit]');await pg.waitForTimeout(200);
 ok('profit tab shows net profit',(await pg.textContent('#admin')).includes('Net profit'));
 await pg.fill('#xAmt','2500');await pg.fill('#xNote','bags');await pg.click('#expForm button[type=submit]');await pg.waitForTimeout(200);
 ok('expense recorded',(await pg.textContent('#admin')).includes('bags')&&(await pg.textContent('#admin')).includes('2,500'));
 await pg.click('[data-act=expdel]');await pg.waitForTimeout(200);ok('expense deleted',!(await pg.textContent('#admin')).includes('bags'));
 await pg.click('[data-act=atab][data-v=products]');await pg.click('[data-act=fedit]');await pg.waitForSelector('#fCost');
 await pg.fill('#fCost','20000');
 ok('3 media tiles with cover badge',await pg.locator('.up .m').count()===3&&await pg.locator('.up .cov').count()===1);
 await pg.click('.up .m:nth-child(3) [data-act=mcov]');await pg.waitForTimeout(100);
 ok('make cover moves to first',await pg.locator('.up .m:nth-child(1) .cov').count()===1);
 ok('cost field kept after re-render',(await pg.inputValue('#fCost'))==='20000');
 ok('admin no page errors',errs.length===0,errs.join('|'));
 await b.close();srv.close();console.log('PASS='+pass+' FAIL='+fail)})();
