// Frontend test against the mock backend. Run: node tests/web.e2e.js   (needs playwright + chromium)
const http=require('http'),fs=require('fs'),path=require('path');const {chromium}=require('playwright');
const W=path.join(__dirname,'..','web');let pass=0,fail=0;const ok=(n,c,x)=>{c?(pass++,console.log('PASS',n)):(fail++,console.log('FAIL',n,x||''))};
const srv=http.createServer((q,r)=>{let f=q.url.split('?')[0].replace(/^\//,'')||'index.html';
  if(f==='backend.js'){r.setHeader('content-type','text/javascript');return r.end(fs.readFileSync(path.join(__dirname,'mock-backend.js')))}
  if(f==='config.js'){r.setHeader('content-type','text/javascript');return r.end('window.XO_CONFIG={supabaseUrl:"https://x.supabase.co",supabaseAnonKey:"k",cardPayments:true,whatsapp:"2349093813119"}')}
  const p=path.join(W,f);if(!fs.existsSync(p)){r.statusCode=404;return r.end()}r.setHeader('content-type',f.endsWith('.js')?'text/javascript':'text/html');r.end(fs.readFileSync(p))});
(async()=>{await new Promise(r=>srv.listen(5594,r));const b=await chromium.launch();
 const U1='11111111-2222-3333-4444-555555555501',U2='11111111-2222-3333-4444-555555555502';
 const pg=await b.newPage({viewport:{width:360,height:740}});const errs=[];pg.on('pageerror',e=>errs.push(e.message));
 await pg.route(/fonts\.|jsdelivr/,r=>r.abort());await pg.goto('http://localhost:5594/');await pg.waitForSelector('#homeGrid .card');
 const seed=(id,no,tok,status,ph)=>pg.evaluate(([id,no,tok,status,ph])=>{const p=window.__DB.products[0];window.__DB.orders.push({id,no,token:tok,status,method:'transfer',createdAt:Date.now(),cust:{name:'Aisha Bello',phone:ph,state:'Kaduna'},sub:34000,fee:3000,total:37000,msgs:[],items:[{item_id:'it'+id,name:p.name,colour:'Black',size:'54',qty:1,unit_price_ngn:34000,reviewed:false}]})},[id,no,tok,status,ph]);
 await seed('o1',201,U1,'paid','08030000001');await seed('o2',202,U2,'awaiting_payment','08030000002');
 const go=async h=>{await pg.evaluate(h=>{location.hash=h},h);await pg.waitForTimeout(350)};
 // ---- customer side
 await go('#/order/'+U1);await pg.waitForSelector('#msgForm');
 ok('open order banner shown',(await pg.textContent('.openbar')).includes('This order is open'));
 ok('customer sees message box after payment',await pg.locator('#msgIn').isVisible());
 await pg.fill('#msgIn','Please send it before Friday');await pg.click('#msgForm button');await pg.waitForTimeout(300);
 ok('customer message appears in thread',(await pg.textContent('#cthread')).includes('before Friday'));
 ok('message reached the business',await pg.evaluate(()=>window.__DB.calls.some(c=>c[0]==='msg')));
 ok('customer can cancel (button visible)',await pg.locator('[data-act=cancelask]').count()===1);
 // ---- CEO side
 await go('#/admin');await pg.waitForSelector('#loginForm');await pg.fill('#lgE','a@b.com');await pg.fill('#lgP','ok');await pg.click('#loginForm button[type=submit]');await pg.waitForTimeout(500);
 await pg.click('[data-act=atab][data-v=orders]');await pg.waitForTimeout(200);
 ok('orders shown as cards',await pg.locator('.ocard').count()===2);
 ok('card flags the new customer message',await pg.locator('#o-o1.unread .pill.new').count()===1);
 ok('orders tab counts unread messages',(await pg.textContent('[data-act=atab][data-v=orders]')).includes('('));
 await pg.click('#o-o1 details.chat summary');await pg.waitForTimeout(200);
 ok('CEO sees customer message in thread',(await pg.textContent('#t-o1')).includes('before Friday'));
 ok('opening the chat clears the unread flag',await pg.locator('#o-o1.unread').count()===0);
 await pg.fill('#o-o1 .ochat textarea','Yes, we will ship on Thursday');await pg.click('#o-o1 .ochat button');await pg.waitForTimeout(300);
 ok('CEO reply appears',(await pg.textContent('#t-o1')).includes('ship on Thursday'));
 // ---- back to customer: sees reply, moves through delivery, reviews, closes
 await go('#/order/'+U1);await pg.waitForSelector('#cthread');
 ok('customer sees the CEO reply',(await pg.textContent('#cthread')).includes('ship on Thursday'));
 await pg.evaluate(()=>{window.__DB.orders[0].status='shipped'});await go('#/shop');await go('#/order/'+U1);await pg.waitForSelector('[data-act=received]');
 ok('cannot cancel once shipped',await pg.locator('[data-act=cancelask]').count()===0);
 await pg.click('[data-act=received]');await pg.waitForSelector('.trev');
 ok('order still open until reviewed',(await pg.textContent('.openbar')).includes('This order is open'));
 await pg.fill('.trev textarea','Perfect fit, thank you');await pg.click('.trev button[type=submit]');await pg.waitForTimeout(1800);
 ok('order closes after the review',(await pg.textContent('.openbar')).includes('closed')&&await pg.locator('#msgForm').count()===0);
 // ---- cancel flow
 await go('#/order/'+U2);await pg.waitForSelector('[data-act=cancelask]');await pg.click('[data-act=cancelask]');
 ok('cancel asks for confirmation',await pg.locator('[data-act=cancelgo]').count()===1);
 await pg.click('[data-act=cancelgo]');await pg.waitForTimeout(500);
 ok('cancelled order is closed',(await pg.textContent('.openbar')).includes('closed')&&(await pg.textContent('.openbar')).includes('cancelled'));
 // ---- CEO deletes
 await go('#/admin');await pg.waitForSelector('.ocard');
 ok('closed orders are marked closed',await pg.locator('.ocard .pill.off').count()===2);
 await pg.click('#o-o2 [data-act=odel]');ok('delete needs a second tap',await pg.locator('#o-o2 [data-act=odelgo]').count()===1);
 await pg.click('#o-o2 [data-act=odelgo]');await pg.waitForTimeout(400);ok('owner deleted the order',await pg.locator('#o-o2').count()===0&&await pg.evaluate(()=>window.__DB.calls.some(c=>c[0]==='delorder')));
 await pg.click('[data-act=atab][data-v=customers]');await pg.click('[data-act=cdel]');await pg.click('[data-act=cdelgo]');await pg.waitForTimeout(400);
 ok('owner deleted a customer',await pg.evaluate(()=>window.__DB.calls.some(c=>c[0]==='delcust')));
 await pg.click('[data-act=atab][data-v=reports]');
 await pg.fill('#clrTxt','delete');await pg.click('#clrForm button');ok('wrong confirmation word is refused',(await pg.textContent('#clrErr')).includes('DELETE')&&!(await pg.evaluate(()=>window.__DB.calls.some(c=>c[0]==='clear'))));
 await pg.selectOption('#clrScope','all');await pg.fill('#clrTxt','DELETE');await pg.click('#clrForm button');await pg.waitForTimeout(500);
 ok('delete everything runs',await pg.evaluate(()=>window.__DB.calls.some(c=>c[0]==='clear'&&c[1]==='all')));
 // ---- mobile overflow audit (360px)
 const over=async n=>{const w=await pg.evaluate(()=>[document.documentElement.scrollWidth,innerWidth]);ok('no sideways scroll: '+n,w[0]<=w[1]+1,w.join('>'))};
 for(const h of ['#/','#/shop','#/about','#/love','#/help','#/contact','#/cart','#/privacy']){await go(h);await over(h)}
 await go('#/admin');await pg.waitForTimeout(300);
 for(const t of ['overview','products','orders','customers','inventory','reviews','delivery','profit','reports']){await pg.click('[data-act=atab][data-v='+t+']');await pg.waitForTimeout(150);await over('admin '+t)}
 ok('no page errors',errs.length===0,errs.join('|'));
 await b.close();srv.close();console.log('PASS='+pass+' FAIL='+fail)})();
