// Frontend test against the mock backend. Run: node tests/web.e2e.js   (needs playwright + chromium)
const http=require('http'),fs=require('fs'),path=require('path');const {chromium}=require('playwright');
const W=path.join(__dirname,'..','web');let pass=0,fail=0;const ok=(n,c,x)=>{c?(pass++,console.log('PASS',n)):(fail++,console.log('FAIL',n,x||''))};
const srv=http.createServer((q,r)=>{let f=q.url.split('?')[0].replace(/^\//,'')||'index.html';
  if(f==='backend.js'){r.setHeader('content-type','text/javascript');return r.end(fs.readFileSync(path.join(__dirname,'mock-backend.js')))}
  if(f==='config.js'){r.setHeader('content-type','text/javascript');return r.end('window.XO_CONFIG={supabaseUrl:"https://x.supabase.co",supabaseAnonKey:"k",cardPayments:true,whatsapp:"2349093813119"}')}
  const p=path.join(W,f);if(!fs.existsSync(p)){r.statusCode=404;return r.end()}r.setHeader('content-type',f.endsWith('.js')?'text/javascript':'text/html');r.end(fs.readFileSync(p))});
(async()=>{await new Promise(r=>srv.listen(5592,r));const b=await chromium.launch();
 for(const w of [360,1280]){const pg=await b.newPage({viewport:{width:w,height:800}});const errs=[];pg.on('pageerror',e=>errs.push(e.message));
  await pg.route(/fonts\.|jsdelivr/,r=>r.abort());await pg.goto('http://localhost:5592/#/love');await pg.waitForSelector('.rcard');
  ok(w+' shows 9 approved reviews first',await pg.locator('.rcard').count()===9);
  ok(w+' unapproved review hidden',!(await pg.textContent('#love')).includes('Not approved yet'));
  ok(w+' summary shows count and average',(await pg.textContent('#loveSum')).includes('12 customer reviews'));
  ok(w+' verified badge and fit label',(await pg.textContent('#loveRev')).includes('Verified purchase')&&(await pg.textContent('#loveRev')).includes('True to size'));
  ok(w+' screenshots section still on the same page',(await pg.textContent('#love')).includes('Messages from our customers'));
  await pg.click('[data-act=lovemore]');ok(w+' show more reveals the rest',await pg.locator('.rcard').count()===12&&await pg.locator('[data-act=lovemore]').count()===0);
  await pg.click('.rcard .rprod');await pg.waitForTimeout(300);ok(w+' review links to the product',await pg.locator('#pdp.on').count()===1);
  const sw=await pg.evaluate(()=>[document.documentElement.scrollWidth,innerWidth]);ok(w+' no sideways scroll',sw[0]<=sw[1]+1);
  ok(w+' no page errors',errs.length===0,errs.join('|'));await pg.close()}
 {const pg=await b.newPage({viewport:{width:390,height:800}});await pg.route(/fonts\.|jsdelivr/,r=>r.abort());await pg.goto('http://localhost:5592/');await pg.waitForSelector('#homeGrid .card');
  await pg.evaluate(()=>{window.__DB.orders.push({id:'o9',no:909,token:'11111111-2222-3333-4444-555555555509',status:'paid',method:'transfer',createdAt:Date.now(),cust:{name:'Zainab',phone:'08030000009',state:'Kaduna'},sub:34000,fee:3000,total:37000,msgs:[],items:[{item_id:'i9',name:'Classic Jilbab',colour:'Black',size:'54',qty:1,unit_price_ngn:34000}]})});
  await pg.evaluate(()=>{location.hash='#/admin'});await pg.waitForSelector('#loginForm');await pg.fill('#lgE','a@b.com');await pg.fill('#lgP','ok');await pg.click('#loginForm button[type=submit]');await pg.waitForTimeout(400);await pg.click('[data-act=atab][data-v=orders]');
  await pg.click('#o-o9 [data-act=ostep]');ok('send for delivery asks for courier and tracking',await pg.locator('#o-o9 .shipform').count()===1);
  await pg.fill('#o-o9 input[name=c]','GIG Logistics');await pg.fill('#o-o9 input[name=t]','GIG-4471');await pg.click('#o-o9 .shipform button[type=submit]');await pg.waitForTimeout(400);
  ok('courier and tracking saved with the shipment',await pg.evaluate(()=>window.__DB.calls.some(c=>c[0]==='status'&&c[2]==='shipped'&&c[3]==='GIG Logistics'&&c[4]==='GIG-4471'))&&(await pg.textContent('#o-o9')).includes('GIG-4471'));await pg.close()}
 await b.close();srv.close();console.log('PASS='+pass+' FAIL='+fail)})();
