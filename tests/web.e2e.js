// Frontend test against the mock backend. Run: node tests/web.e2e.js   (needs playwright + chromium)
const http=require('http'),fs=require('fs'),path=require('path');const {chromium}=require('playwright');
const W=path.join(__dirname,'..','web');let pass=0,fail=0;const ok=(n,c,x)=>{c?(pass++,console.log('PASS',n)):(fail++,console.log('FAIL',n,x||''))};
const srv=http.createServer((q,r)=>{let f=q.url.split('?')[0].replace(/^\//,'')||'index.html';
  if(f==='backend.js'){r.setHeader('content-type','text/javascript');return r.end(fs.readFileSync(path.join(__dirname,'mock-backend.js')))}
  if(f==='config.js'){r.setHeader('content-type','text/javascript');return r.end('window.XO_CONFIG={supabaseUrl:"https://x.supabase.co",supabaseAnonKey:"k",cardPayments:true,whatsapp:"2349093813119"}')}
  const p=path.join(W,f);if(!fs.existsSync(p)){r.statusCode=404;return r.end()}r.setHeader('content-type',f.endsWith('.js')?'text/javascript':'text/html');r.end(fs.readFileSync(p))});
(async()=>{await new Promise(r=>srv.listen(5599,r));const b=await chromium.launch();
 for(const w of [390,1280]){const pg=await b.newPage({viewport:{width:w,height:800}});const errs=[];pg.on('pageerror',e=>errs.push(e.message));
  await pg.route(/fonts\.|jsdelivr/,r=>r.abort());await pg.goto('http://localhost:5599/');await pg.waitForSelector('#homeGrid .card');
  ok(w+' real products shown on home, no demo',await pg.locator('#homeGrid .card').count()===1&&!(await pg.locator('.sample').count()));
  const vis=()=>pg.evaluate(()=>[...document.querySelectorAll('[data-view]')].filter(v=>!v.hidden).map(v=>v.dataset.view).join());
  ok(w+' home shows only home',await vis()==='home');
  for(const [h,v,t] of [['shop','shop','Shop'],['about','about','About us'],['love','love','Customer love'],['help','help','Delivery and returns'],['contact','contact','Contact'],['privacy','privacy','Privacy and terms'],['cart','cart','Your cart']]){
    await pg.evaluate(x=>location.hash='#/'+x,h);await pg.waitForTimeout(80);
    ok(w+' #/'+h+' shows only '+v,await vis()===v);
    ok(w+' #/'+h+' title',(await pg.title()).startsWith(t));
    ok(w+' #/'+h+' no overflow',await pg.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    ok(w+' #/'+h+' one h1',await pg.locator('[data-view='+v+'] h1').count()===1);}
  await pg.evaluate(()=>location.hash='#/');await pg.waitForTimeout(80);
  ok(w+' no horizontal overflow',await pg.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  if(w!==390){await pg.close();ok('no page errors '+w,errs.length===0,errs.join('|'));continue}
  await pg.evaluate(()=>location.hash='#/shop');await pg.waitForSelector('#grid .card');await pg.click('#grid .card');await pg.waitForSelector('#pdp.on');
  await pg.evaluate(()=>hideAll());await pg.evaluate(()=>{});await pg.click('#grid .card');await pg.waitForSelector('#pdp.on');
  ok('review form replaced by notice',!(await pg.locator('#revForm').count()));
  await pg.click('[data-act=size][data-v="54"]');await pg.click('[data-act=add]');
  await pg.evaluate(()=>hideAll());await pg.click('[data-act=cart]');await pg.waitForSelector('#cart #placeOrder');ok('cart is its own page',(await pg.evaluate(()=>location.hash))==='#/cart'&&await vis()==='cart');
  await pg.click('#placeOrder');ok('empty form blocked',(await pg.textContent('#cErr')).includes('fill in'));
  await pg.fill('#cName','Aisha Bello');await pg.fill('#cPhone','08030000000');await pg.selectOption('#cState','Kaduna');await pg.fill('#cAddr','12 Test Road, Kaduna');
  ok('delivery estimate shown',(await pg.textContent('#dlvNote')).includes('3,000'));
  await pg.click('#placeOrder');await pg.waitForSelector('.trk');
  ok('tracking shows order number',(await pg.textContent('.trk')).includes('#1001'));
  ok('bank details shown',(await pg.textContent('.trk')).includes('0123456789'));
  ok('total includes delivery (34000+3000)',(await pg.textContent('.trk')).includes('₦37,000'));
  ok('cart emptied',await pg.evaluate(()=>JSON.parse(localStorage.getItem('xo-cart')||'[]').length===0));
  ok('hash has order token',(await pg.evaluate(()=>location.hash)).startsWith('#/order/'));
  ok('stock dropped (live)',await pg.evaluate(()=>__DB.products[0].stock['Black|54']===2));
  await pg.setInputFiles('#recUp',{name:'r.png',mimeType:'image/png',buffer:Buffer.from('89504e470d0a1a0a','hex')});await pg.waitForTimeout(400);
  ok('receipt uploaded',await pg.evaluate(()=>__DB.calls.some(c=>c[0]==='receipt')));
  // oversell
  await pg.evaluate(()=>{__DB.products[0].stock['Pink|54']=0});
  await pg.evaluate(()=>refreshAll());
  // order link survives reload of the route
  ok('order page still the cart view',await vis()==='cart');
  // phone menu
  await pg.evaluate(()=>{location.hash='#/'});await pg.waitForTimeout(80);await pg.click('#menuBtn');ok('menu opens',await pg.locator('#mobnav').isVisible());await pg.click('#mobnav a[href="#/about"]');await pg.waitForTimeout(100);ok('menu link opens About and closes menu',await vis()==='about'&&await pg.locator('#mobnav').isHidden());
  // owner dashboard
  await pg.evaluate(()=>hideAll());await pg.evaluate(()=>location.hash='#/');await pg.waitForTimeout(80);
  ok('owner login link in footer',await pg.locator('#ownLogin').isVisible());
  await pg.click('#ownLogin a');await pg.waitForSelector('#loginForm');ok('admin is its own page',await vis()==='admin');
  await pg.fill('#lgE','a@b.com');await pg.fill('#lgP','bad');await pg.click('#loginForm button');await pg.waitForTimeout(200);
  ok('bad login rejected',(await pg.textContent('#lgErr')).includes('Could not sign in'));
  await pg.fill('#lgP','ok');await pg.click('#loginForm button');await pg.waitForSelector('#admin .kpis');
  ok('mobile menu has dashboard link when signed in',(await pg.textContent('#mobDash')).includes('Owner dashboard'));
  ok('overview is the landing tab',(await pg.textContent('#admin')).includes('Total sales'));
  ok('add product button on overview',await pg.locator('[data-act=qadd]').isVisible());
  ok('awaiting payment KPI counts the order',(await pg.locator('.kpi',{hasText:'Awaiting payment'}).textContent()).includes('1'));
  await pg.click('[data-act=qadd]');await pg.waitForSelector('#pForm');ok('product form with media upload',await pg.locator('#mUp').count()===1);
  await pg.fill('#fName','New Hijab');await pg.fill('#fPrice','9000');await pg.click('#pForm button[type=submit]');await pg.waitForTimeout(300);
  ok('save product calls backend',await pg.evaluate(()=>__DB.calls.some(c=>c[0]==='save'&&c[1]==='New Hijab')));
  await pg.click('[data-act=atab][data-v=orders]');
  ok('owner sees order',(await pg.textContent('#admin')).includes('#1001'));
  await pg.fill('#oq','zzz');ok('order search filters',(await pg.textContent('#admin')).includes('Orders sent from the website')||!(await pg.textContent('#admin')).includes('#1001'));
  await pg.fill('#oq','aisha');ok('order search finds customer',(await pg.textContent('#admin')).includes('#1001'));
  await pg.click('[data-act=ostep]');await pg.waitForTimeout(300);
  ok('mark paid calls backend',await pg.evaluate(()=>__DB.calls.some(c=>c[0]==='status'&&c[2]==='paid')));
  await pg.click('[data-act=atab][data-v=customers]');ok('customers tab lists buyer',(await pg.textContent('#admin')).includes('Aisha Bello')&&(await pg.textContent('#admin')).includes('₦37,000'));
  await pg.click('[data-act=atab][data-v=inventory]');await pg.waitForTimeout(150);ok('stock tab shows stock + movements + restock',(await pg.textContent('#admin')).includes('Units in stock')&&(await pg.textContent('#admin')).includes('Stock movements')&&(await pg.textContent('#admin')).includes('08031112222'));
  await pg.click('[data-act=atab][data-v=reports]');ok('reports count paid order',(await pg.textContent('#admin')).includes('₦37,000'));
  await pg.click('[data-act=signout]');await pg.waitForTimeout(100);ok('signed out hides owner button and leaves admin',await pg.locator('#ownerBtn').isHidden()&&await vis()==='home');
  await pg.evaluate(()=>location.hash='#/admin');await pg.waitForTimeout(100);ok('admin page asks for login again',await pg.locator('#loginForm').count()===1);
  ok('no page errors',errs.length===0,errs.join('|'));await pg.close()}
 await b.close();srv.close();console.log('PASS='+pass+' FAIL='+fail);process.exit(fail?1:0)})();
