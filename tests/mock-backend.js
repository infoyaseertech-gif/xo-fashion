// Test double for window.XO_BE: same method names as web/backend.js, in-memory data, same rules as the SQL.
(function(){
  const mk=(id,name,cat,origin,price,cols,sizes,stock)=>{const colours=cols.map(([n,h])=>({name:n,hex:h}));const st={},vid={};colours.forEach(c=>sizes.forEach(s=>{st[c.name+'|'+s]=stock[c.name+'|'+s]??0;vid[c.name+'|'+s]='v-'+id+'-'+c.name+'-'+s}));
    return{id,name,category:cat,origin,price,fabric:'Soft',desc:'Nice',colours,sizes,stock:st,vid,media:id==='p1'?[1,2,3].map(n=>({type:'image',url:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="50"><rect width="40" height="50" fill="hsl('+n*90+',50%,70%)"/></svg>'),colour:''})):[],active:true,createdAt:Date.now()}};
  const DB={products:[mk('p1','Classic Jilbab','Jilbab','Egypt',34000,[['Black','#231c1c'],['Pink','#e8a1b5']],['54','56'],{'Black|54':3,'Black|56':0,'Pink|54':1,'Pink|56':5})],orders:[],reviews:[],zones:{Kaduna:{fee:3000,days:3}},admin:false,calls:[]};
  window.__DB=DB;
  const find=v=>{for(const p of DB.products)for(const k in p.vid)if(p.vid[k]===v)return[p,k]};
  window.XO_BE={cardEnabled:true,
    async products(){return JSON.parse(JSON.stringify(DB.products))},async reviews(){return DB.reviews.filter(r=>r.approved||DB.admin)},async shots(){return[]},async zones(){return DB.zones},
    async orders(){return DB.orders.map(o=>({id:o.id,no:o.no,status:o.status,method:o.method,createdAt:o.createdAt,total:o.total,receipt:o.receipt,msgs:(o.msgs||[]).map(m=>({...m})),unread:(o.msgs||[]).some(m=>m.from==='customer'&&m.at>(o.ownerRead||0)),open:!['cancelled','expired'].includes(o.status)&&!(o.status==='delivered'&&o.items.every(i=>i.reviewed)),customer:{name:o.cust.name,phone:o.cust.phone,state:o.cust.state},items:o.items.map(i=>({name:i.name,colour:i.colour,size:i.size,n:i.qty}))}))},
    _exp:[],async costs(){return{}},async expenses(){return this._exp},async addExpense(x){const r={...x,id:'e'+(this._exp.length+1)};this._exp.push(r);return r},async deleteExpense(id){this._exp=this._exp.filter(e=>e.id!==id)},async stockLog(){return[{at:Date.now(),delta:-2,reason:'order',item:'Classic Jilbab · Black 54'}]},async restocks(){return[{phone:'08031112222',item:'Classic Jilbab · Black 56'}]},async bank(){return{bank:'Test Bank',name:'X and O',number:'0123456789'}},watchStock(){},
    async placeOrder(items,cust,method){DB.calls.push(['place',method]);
      for(const it of items){const[p,k]=find(it.variant_id)||[];if(!p)throw new Error('unavailable');if(p.stock[k]<it.qty)throw new Error('out_of_stock:'+it.variant_id)}
      let sub=0;const its=items.map((it,i)=>{const[p,k]=find(it.variant_id);p.stock[k]-=it.qty;sub+=p.price*it.qty;const[c,s]=k.split('|');return{item_id:'i'+i,name:p.name,colour:c,size:s,qty:it.qty,unit_price_ngn:p.price}});
      const fee=DB.zones[cust.state]?DB.zones[cust.state].fee:null;
      const o={id:'o'+(DB.orders.length+1),no:1001+DB.orders.length,token:'11111111-1111-1111-1111-11111111111'+DB.orders.length,status:'awaiting_payment',method,createdAt:Date.now(),cust,items:its,sub,fee,total:sub+(fee||0)};DB.orders.push(o);return{order_no:o.no,token:o.token}},
    async getOrder(t){const o=DB.orders.find(x=>x.token===t);if(!o)return null;return{order_id:o.id,order_no:o.no,status:o.status,payment_method:o.method==='paystack'?'paystack':o.method,customer_name:o.cust.name,state:o.cust.state,subtotal_ngn:o.sub,delivery_fee_ngn:o.fee,total_ngn:o.total,expires_at:new Date(Date.now()+36e5).toISOString(),receipt_uploaded:!!o.receipt,is_open:!['cancelled','expired'].includes(o.status)&&!(o.status==='delivered'&&o.items.every(i=>i.reviewed)),cancellable:['awaiting_payment','paid','packed'].includes(o.status),messages:(o.msgs||[]).map(m=>({...m,at:new Date(m.at).toISOString()})),bank:o.status==='awaiting_payment'&&o.method!=='paystack'?{bank:'Test Bank',account_name:'X and O',account_number:'0123456789'}:null,items:o.items}},
    async payByCard(t){DB.calls.push(['card',t]);return'https://paystack.test/pay'},
    async sendReceipt(t,oid,f){DB.orders.find(x=>x.id===oid).receipt='x';DB.calls.push(['receipt',oid])},
    async confirmReceived(t){const o=DB.orders.find(x=>x.token===t);if(!o)throw new Error('not_found');if(o.status!=='shipped')throw new Error('not_shipped');o.status='delivered';DB.calls.push(['received',t])},async review(t,i,st,n,c,sz){DB.calls.push(['review',i,st]);const o=DB.orders.find(x=>x.token===t);if(o)o.items.forEach(x=>{if(x.item_id===i)x.reviewed=true})},
    async postMessage(t,b){const o=DB.orders.find(x=>x.token===t);if(!o)throw new Error('not_found');if(['cancelled','expired'].includes(o.status))throw new Error('closed');(o.msgs=o.msgs||[]).push({from:'customer',text:b,at:Date.now()});DB.calls.push(['msg',b])},
    async cancelMine(t){const o=DB.orders.find(x=>x.token===t);if(!o||!['awaiting_payment','paid','packed'].includes(o.status))throw new Error('not_cancellable');o.status='cancelled';(o.msgs=o.msgs||[]).push({from:'system',text:'The customer cancelled this order.',at:Date.now()});DB.calls.push(['cancel',t])},
    async adminMessage(id,b){const o=DB.orders.find(x=>x.id===id);(o.msgs=o.msgs||[]).push({from:'owner',text:b,at:Date.now()});o.ownerRead=Date.now()+1;DB.calls.push(['reply',b])},
    async markRead(id){const o=DB.orders.find(x=>x.id===id);if(o)o.ownerRead=Date.now()+1},
    async deleteOrder(id){DB.orders=DB.orders.filter(x=>x.id!==id);DB.calls.push(['delorder',id])},
    async deleteCustomer(ph){const n=DB.orders.filter(x=>x.cust.phone===ph).length;DB.orders=DB.orders.filter(x=>x.cust.phone!==ph);DB.calls.push(['delcust',ph]);return n},
    async clearData(sc){DB.calls.push(['clear',sc]);if(sc==='orders'||sc==='all')DB.orders=[];if(sc==='all'||sc==='products')DB.products=[]},
    watchOrders(){},
    async signIn(e,p){if(p==='ok'){DB.admin=true;return true}throw new Error('bad')},async signOut(){DB.admin=false},async isAdmin(){return DB.admin},
    async setStatus(id,st){const o=DB.orders.find(x=>x.id===id);o.status=st;DB.calls.push(['status',id,st])},async receiptUrl(){return'about:blank'},
    async upload(){return{url:'https://x.test/a.jpg',type:'image'}},async saveProduct(d,id){DB.calls.push(['save',d.name,Object.keys(d.stock).length])},async deleteProduct(){return'deleted'},
    async approveReview(){},async deleteReview(){},async addShot(){},async deleteShot(){},async saveBank(){},async saveZones(){}};
})();
