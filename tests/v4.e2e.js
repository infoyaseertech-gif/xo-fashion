// Frontend test against the mock backend. Run: node tests/web.e2e.js   (needs playwright + chromium)
const http=require('http'),fs=require('fs'),path=require('path');const {chromium}=require('playwright');
const W=path.join(__dirname,'..','web');let pass=0,fail=0;const ok=(n,c,x)=>{c?(pass++,console.log('PASS',n)):(fail++,console.log('FAIL',n,x||''))};
const srv=http.createServer((q,r)=>{let f=q.url.split('?')[0].replace(/^\//,'')||'index.html';
  if(f==='backend.js'){r.setHeader('content-type','text/javascript');return r.end(fs.readFileSync(path.join(__dirname,'mock-backend.js')))}
  if(f==='config.js'){r.setHeader('content-type','text/javascript');return r.end('window.XO_CONFIG={supabaseUrl:"https://x.supabase.co",supabaseAnonKey:"k",cardPayments:true,whatsapp:"2349093813119"}')}
  const p=path.join(W,f);if(!fs.existsSync(p)){r.statusCode=404;return r.end()}r.setHeader('content-type',f.endsWith('.js')?'text/javascript':'text/html');r.end(fs.readFileSync(p))});
(async()=>{await new Promise(r=>srv.listen(5596,r));const b=await chromium.launch();
 const pg=await b.newPage({viewport:{width:390,height:800}});const errs=[];pg.on('pageerror',e=>errs.push(e.message));
 await pg.route(/fonts\.|jsdelivr/,r=>r.abort());await pg.goto('http://localhost:5596/');await pg.waitForSelector('#homeGrid .card');
 ok('home eyebrow text',(await pg.textContent('.intro .eyebrow'))==='Premium jilbab for every occasion');
 ok('home paragraph text',(await pg.textContent('.intro .lede')).startsWith('Discover beautifully crafted jilbabs designed for comfort, elegance and effortless modesty.')&&(await pg.textContent('.intro .lede')).endsWith('special occasions.'));
 ok('menu closed at start',!(await pg.locator('#mobnav').isVisible()));
 await pg.click('#menuBtn');await pg.waitForTimeout(400);
 const bx=await pg.locator('#mobnav').boundingBox();
 ok('menu is a side panel, not the whole width',bx.x>40&&bx.width<=340&&bx.height>=790,JSON.stringify(bx));
 ok('page behind is dimmed by scrim',await pg.locator('#menuScrim').isVisible());
 await pg.click('#menuScrim',{position:{x:10,y:300}});await pg.waitForTimeout(100);ok('tapping outside closes menu',!(await pg.locator('#mobnav').isVisible()));
 await pg.click('#menuBtn');await pg.click('#mobnav [data-act=menuX]');ok('close button works',!(await pg.locator('#mobnav').isVisible()));
 await pg.click('#menuBtn');await pg.click('#mobnav a[href="#/about"]');await pg.waitForTimeout(150);ok('link closes menu and goes to page',!(await pg.locator('#mobnav').isVisible())&&pg.url().endsWith('#/about'));
 // order tracking flow
 await pg.evaluate(()=>{const p=window.__DB.products[0];window.__DB.orders.push({id:'o1',no:77,token:'11111111-2222-3333-4444-555555555577',status:'paid',method:'transfer',createdAt:Date.now(),cust:{name:'Aisha Bello',phone:'08030000000',state:'Kaduna'},sub:34000,fee:3000,total:37000,items:[{item_id:'it1',name:p.name,colour:'Black',size:'54',qty:1,unit_price_ngn:34000,reviewed:false}]})});
 await pg.evaluate(()=>{location.hash='#/order/11111111-2222-3333-4444-555555555577'});await pg.waitForTimeout(500);await pg.waitForSelector('.steps');
 ok('paid order shows 5 steps',await pg.locator('.steps li').count()===5&&await pg.locator('.steps li.done').count()===2);
 ok('no received button before shipping',await pg.locator('[data-act=received]').count()===0);
 ok('no review form before delivery',await pg.locator('.trev').count()===0);
 await pg.evaluate(()=>{window.__DB.orders[0].status='shipped'});await pg.evaluate(()=>{location.hash='#/shop'});await pg.waitForTimeout(150);await pg.evaluate(()=>{location.hash='#/order/11111111-2222-3333-4444-555555555577'});await pg.waitForTimeout(300);await pg.waitForSelector('.steps');
 ok('shipped order tells customer it was handed to delivery',(await pg.textContent('#cart')).includes('handed your order to delivery')&&await pg.locator('[data-act=received]').count()===1);
 ok('still no review form while shipped',await pg.locator('.trev').count()===0);
 await pg.click('[data-act=received]');await pg.waitForSelector('.trev');
 ok('after confirming receipt the review form appears',await pg.locator('.trev').count()===1&&(await pg.textContent('#cart')).includes('Thank you for shopping'));
 ok('all 5 steps done',await pg.locator('.steps li.done').count()===5);
 await pg.fill('.trev textarea','Beautiful fabric and a perfect fit.');await pg.click('.trev button[type=submit]');await pg.waitForTimeout(200);
 ok('review submitted',(await pg.textContent('#cart')).includes('Thank you. Your review will show after we approve it.')&&await pg.evaluate(()=>window.__DB.calls.some(c=>c[0]==='review')));
 ok('no page errors',errs.length===0,errs.join('|'));
 await b.close();srv.close();console.log('PASS='+pass+' FAIL='+fail)})();
