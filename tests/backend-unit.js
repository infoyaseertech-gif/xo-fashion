// Checks web/backend.js against a fake supabase-js client (no network): shaping, RPC names, args.
const fs=require('fs'),vm=require('vm'),path=require('path');let pass=0,fail=0;const ok=(n,c,x)=>{c?(pass++,console.log('PASS',n)):(fail++,console.log('FAIL',n,x||''))};
const calls=[];const chain=(rows)=>{const c={select:()=>c,order:()=>c,limit:()=>c,eq:()=>c,maybeSingle:()=>Promise.resolve({data:rows[0]||null}),single:()=>Promise.resolve({data:rows[0]}),insert:(v)=>{calls.push(['insert',v]);return c},update:(v)=>{calls.push(['update',v]);return c},upsert:(v,o)=>{calls.push(['upsert',v,o]);return Promise.resolve({data:null})},delete:()=>{calls.push(['delete']);return c},then:(f)=>Promise.resolve({data:rows}).then(f)};return c};
const client={from:(t)=>{calls.push(['from',t]);return chain(t==='products'?[{id:'p',name:'N',category:'Hijab',origin:'Nigeria',price_ngn:5000,fabric_note:'f',description:'d',active:true,created_at:'2026-01-01T00:00:00Z',
   variants:[{id:'b',colour_name:'Pink',colour_hex:'#e8a1b5',size:'56',stock:2,sort:101},{id:'a',colour_name:'Pink',colour_hex:'#e8a1b5',size:'54',stock:1,sort:100},{id:'c',colour_name:'Black',colour_hex:'#000000',size:'54',stock:0,sort:0}],
   media:[{kind:'video',url:'https://x/v.mp4',colour_name:null,sort_order:1},{kind:'image',url:'https://x/i.jpg',colour_name:'Pink',sort_order:0}]}]:[])},
  rpc:(n,a)=>{calls.push(['rpc',n,a]);return Promise.resolve({data:{ok:1}})},channel:()=>({on:()=>({subscribe:()=>{}})}),auth:{getSession:()=>Promise.resolve({data:{session:{}}}),signInWithPassword:()=>Promise.resolve({}),signOut:()=>Promise.resolve()},storage:{from:()=>({upload:()=>Promise.resolve({}),getPublicUrl:(p)=>({data:{publicUrl:'https://s/'+p}}),createSignedUrl:()=>Promise.resolve({data:{signedUrl:'u'}})})}};
const win={XO_CONFIG:{supabaseUrl:'https://x.supabase.co',supabaseAnonKey:'k'},supabase:{createClient:()=>client},fetch:async()=>({ok:true,json:async()=>({authorization_url:'https://pay'})})};win.window=win;
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','web','backend.js'),'utf8'),win);
(async()=>{const B=win.XO_BE;ok('backend loads with config',!!B);
 const [p]=await B.products();
 ok('colours in typed order (Black first? sort 0)',p.colours.map(c=>c.name).join()==='Black,Pink');
 ok('sizes sorted numerically',p.sizes.join()==='54,56');
 ok('stock map keys',p.stock['Pink|54']===1&&p.stock['Black|54']===0&&p.vid['Pink|56']==='b');
 ok('media ordered, colour mapped',p.media[0].type==='image'&&p.media[0].colour==='Pink'&&p.media[1].colour==='');
 await B.placeOrder([{variant_id:'a',qty:1}],{name:'A B'},'transfer');
 ok('place_order rpc args',calls.some(c=>c[0]==='rpc'&&c[1]==='place_order'&&c[2].p_payment_method==='transfer'&&c[2].p_items[0].variant_id==='a'));
 await B.setStatus('o','paid');ok('admin_set_status rpc',calls.some(c=>c[1]==='admin_set_status'&&c[2].p_status==='paid'));
 await B.saveProduct({name:'N',category:'Hijab',origin:'Nigeria',desc:'',fabric:'',price:5000,active:true,colours:[{name:'Pink',hex:'#e8a1b5'}],sizes:['54','56'],stock:{'Pink|54':3},media:[]},'p');
 const up=calls.find(c=>c[0]==='upsert'&&Array.isArray(c[1]));ok('variants upserted with sort + conflict key',up&&up[1].length===2&&up[1][1].sort===1&&up[2].onConflict==='product_id,colour_name,size');
 ok('card init posts token to function',await B.payByCard('t')==='https://pay');
 console.log('PASS='+pass+' FAIL='+fail);process.exit(fail?1:0)})();
