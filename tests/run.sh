#!/usr/bin/env bash
# Usage: PGHOST=<socket dir> PGPORT=5544 ./run.sh   (needs a database 'xo_test' with stub.sql applied + migration)
H=${PGHOST:-/tmp}; PORT=${PGPORT:-5544}; DB=${DB:-t}
PASS=0; FAIL=0
q(){ psql -h "$H" -p "$PORT" -U postgres -d "$DB" -Atq -v ON_ERROR_STOP=1 "$@" 2>&1; }
as(){ local role=$1 sub=$2; shift 2; q -c "set role $role; select set_config('request.jwt.claim.sub','$sub',false); select set_config('request.jwt.claim.role','$role',false);" -c "$1" | tail -n +3; }
ok(){ if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "PASS $1"; else FAIL=$((FAIL+1)); echo "FAIL $1 (got: $2 | want: $3)"; fi; }
has(){ if echo "$2" | grep -qi "$3"; then PASS=$((PASS+1)); echo "PASS $1"; else FAIL=$((FAIL+1)); echo "FAIL $1 (got: $2 | want ~ $3)"; fi; }
OIX=1; ADMIN=00000000-0000-0000-0000-0000000000aa; USER=00000000-0000-0000-0000-0000000000bb
q -c "truncate orders, products cascade; delete from admin_users; delete from auth.users;" >/dev/null
q -c "insert into auth.users(id,email) values ('$ADMIN','a@x.com'),('$USER','u@x.com'); insert into admin_users(user_id,role) values ('$ADMIN','owner');
 insert into products(slug,name,category,origin,price_ngn) values ('test-jilbab','Test Jilbab','Jilbab','Nigeria',25000);
 insert into variants(product_id,colour_name,colour_hex,size,stock) select id,'Black','#000000','M',3 from products;
 insert into variants(product_id,colour_name,colour_hex,size,stock) select id,'Black','#000000','L',0 from products;
 update delivery_zones set fee_ngn=3000 where state='Kaduna';" >/dev/null
VM=$(q -c "select id from variants where size='M'"); VL=$(q -c "select id from variants where size='L'")
CUST='{"name":"Aisha Bello","phone":"0803 000 0000","state":"Kaduna","address":"12 Test Road, Kaduna"}'

has "anon reads active products" "$(as anon '' "select count(*) from products")" "^1$"
has "anon cannot read orders" "$(as anon '' "select count(*) from orders")" "denied"
has "anon cannot read stock_log" "$(as anon '' "select count(*) from stock_log")" "denied"
has "anon cannot read admin_users" "$(as anon '' "select count(*) from admin_users")" "denied"
has "anon cannot update variants" "$(as anon '' "update variants set stock=999")" "denied"
has "anon cannot call confirm_paystack_payment" "$(as anon '' "select confirm_paystack_payment(1,'x',1)")" "denied"
has "authenticated cannot call confirm_paystack_payment" "$(as authenticated $USER "select confirm_paystack_payment(1,'x',1)")" "denied"

R=$(as anon '' "select place_order('[{\"variant_id\":\"$VM\",\"qty\":2}]'::jsonb,'$CUST'::jsonb,'transfer')")
has "place_order returns token" "$R" "token"
ok "stock decremented 3->1" "$(q -c "select stock from variants where id='$VM'")" "1"
TOKEN=$(echo "$R" | grep -o '"token": *"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
has "oversell rejected" "$(as anon '' "select place_order('[{\"variant_id\":\"$VM\",\"qty\":2}]'::jsonb,'$CUST'::jsonb,'transfer')")" "stock\|enough\|available"
ok "stock unchanged after rejected oversell" "$(q -c "select stock from variants where id='$VM'")" "1"
has "sold-out variant rejected" "$(as anon '' "select place_order('[{\"variant_id\":\"$VL\",\"qty\":1}]'::jsonb,'$CUST'::jsonb,'transfer')")" "stock\|enough\|available"
has "qty 0 rejected" "$(as anon '' "select place_order('[{\"variant_id\":\"$VM\",\"qty\":0}]'::jsonb,'$CUST'::jsonb,'transfer')")" "error"
has "negative qty rejected" "$(as anon '' "select place_order('[{\"variant_id\":\"$VM\",\"qty\":-5}]'::jsonb,'$CUST'::jsonb,'transfer')")" "error"
has "bad phone rejected" "$(as anon '' "select place_order('[{\"variant_id\":\"$VM\",\"qty\":1}]'::jsonb,'{\"name\":\"A B\",\"phone\":\"12\",\"state\":\"Kaduna\",\"address\":\"somewhere long\"}'::jsonb,'transfer')")" "error"
has "bad payment method rejected" "$(as anon '' "select place_order('[{\"variant_id\":\"$VM\",\"qty\":1}]'::jsonb,'$CUST'::jsonb,'bitcoin')")" "error"
has "empty cart rejected" "$(as anon '' "select place_order('[]'::jsonb,'$CUST'::jsonb,'transfer')")" "error"
ok "price from DB (total 50000 + 3000 delivery)" "$(q -c "select subtotal_ngn||'/'||coalesce(delivery_fee_ngn,0) from orders limit 1" 2>&1 | head -1)" "50000/3000"
has "get_order by token works" "$(as anon '' "select get_order('$TOKEN')")" "order_no"
has "get_order wrong token -> nothing" "$(as anon '' "select coalesce(get_order('11111111-1111-1111-1111-111111111111')::text,'NULL')")" "NULL\|error\|not found"
has "customer cannot set status" "$(as authenticated $USER "select admin_set_status((select id from orders limit 1),'paid')")" "forbidden"
has "admin can mark paid" "$(as authenticated $ADMIN "select admin_set_status((select id from orders limit 1),'paid')" ; q -c "select status from orders limit 1")" "paid"
OI=$(q -c "select id from order_items limit 1")
has "review before delivery rejected" "$(as anon '' "select submit_review('$TOKEN','$OI',5,'Aisha','Lovely','true_to_size')")" "error"
as authenticated $ADMIN "select admin_set_status((select id from orders limit 1),'packed')" >/dev/null
as authenticated $ADMIN "select admin_set_status((select id from orders limit 1),'shipped','GIG','123')" >/dev/null
as authenticated $ADMIN "select admin_set_status((select id from orders limit 1),'delivered')" >/dev/null
has "review after delivery ok" "$(as anon '' "select submit_review('$TOKEN','$OI',5,'Aisha','Lovely','true_to_size')")" "[0-9a-f]\{8\}-"
has "duplicate review rejected" "$(as anon '' "select submit_review('$TOKEN','$OI',4,'Aisha','Again',null)")" "error"
ok "review hidden until approved" "$(as anon '' "select count(*) from reviews")" "0"
q -c "update reviews set approved=true" >/dev/null
ok "approved review visible" "$(as anon '' "select count(*) from reviews")" "1"
has "invalid transition rejected" "$(as authenticated $ADMIN "select admin_set_status((select id from orders limit 1),'paid')")" "error"

# expiry releases stock
R2=$(as anon '' "select place_order('[{\"variant_id\":\"$VM\",\"qty\":1}]'::jsonb,'$CUST'::jsonb,'paystack')")
ok "stock held (1->0)" "$(q -c "select stock from variants where id='$VM'")" "0"
q -c "update orders set expires_at=now()-interval '1 minute' where status='awaiting_payment'" >/dev/null
q -c "select expire_orders()" >/dev/null
ok "expiry restores stock (0->1)" "$(q -c "select stock from variants where id='$VM'")" "1"
ok "expiry marks expired" "$(q -c "select count(*) from orders where status='expired'")" "1"

# paystack confirm
R3=$(as anon '' "select place_order('[{\"variant_id\":\"$VM\",\"qty\":1}]'::jsonb,'$CUST'::jsonb,'paystack')")
NO=$(q -c "select order_no from orders where status='awaiting_payment' limit 1")
has "wrong amount flagged not paid" "$(as service_role '' "select confirm_paystack_payment($NO,'ref1',1)"; q -c "select status from orders where order_no=$NO")" "needs_review\|awaiting"

# 003: profit and records
PID=$(q -c "select id from products limit 1")
has "anon cannot read product_costs" "$(as anon '' "select count(*) from product_costs")" "denied"
has "anon cannot read expenses" "$(as anon '' "select count(*) from expenses")" "denied"
has "customer cannot read expenses" "$(as authenticated $USER "select count(*) from expenses")" "^0$"
has "customer cannot write costs" "$(as authenticated $USER "insert into product_costs values ('$PID',100)")" "row-level\|denied"
has "admin can set cost" "$(as authenticated $ADMIN "insert into product_costs values ('$PID',15000) returning cost_ngn")" "15000"
has "admin can add expense" "$(as authenticated $ADMIN "insert into expenses(category,amount_ngn,note) values ('Packaging',2000,'bags') returning amount_ngn")" "2000"
has "bad expense category rejected" "$(as authenticated $ADMIN "insert into expenses(category,amount_ngn) values ('Beer',5)")" "error\|violates"
has "zero expense rejected" "$(as authenticated $ADMIN "insert into expenses(category,amount_ngn) values ('Other',0)")" "error\|violates"
q -c "update variants set stock=5" >/dev/null
as anon '' "select place_order('[{\"variant_id\":\"$VM\",\"qty\":1}]'::jsonb,'$CUST'::jsonb,'transfer')" >/dev/null
ok "order item snapshots cost" "$(q -c "select unit_cost_ngn from order_items order by (select created_at from orders o where o.id=order_id) desc limit 1")" "15000"
q -c "update product_costs set cost_ngn=99999" >/dev/null
ok "cost snapshot unchanged after cost edit" "$(q -c "select count(*) from order_items where unit_cost_ngn=15000")" "1"

# 004: customer confirms receipt, then reviews
q -c "update variants set stock=5" >/dev/null
R4=$(as anon '' "select place_order('[{\"variant_id\":\"$VM\",\"qty\":1}]'::jsonb,'$CUST'::jsonb,'transfer')")
T4=$(echo "$R4" | grep -o '"token": *"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
has "confirm before shipping rejected" "$(as anon '' "select confirm_received('$T4')")" "not_shipped"
OID=$(q -c "select id from orders where public_token='$T4'"); OI4=$(q -c "select id from order_items where order_id='$OID'")
as authenticated $ADMIN "select admin_set_status('$OID','paid')" >/dev/null
as authenticated $ADMIN "select admin_set_status('$OID','shipped','GIG','777')" >/dev/null
has "shipped_at stamped" "$(q -c "select shipped_at is not null from orders where id='$OID'")" "^t$"
has "get_order shows not reviewed" "$(as anon '' "select get_order('$T4')")" "\"reviewed\": false"
has "review before receipt rejected" "$(as anon '' "select submit_review('$T4','$OI4',5,'Aisha','Lovely','true_to_size')")" "not_eligible"
has "customer confirms receipt" "$(as anon '' "select confirm_received('$T4')"; q -c "select status from orders where id='$OID'")" "delivered"
has "delivered_at stamped" "$(q -c "select delivered_at is not null from orders where id='$OID'")" "^t$"
has "wrong token cannot confirm" "$(as anon '' "select confirm_received('11111111-1111-1111-1111-111111111111')")" "not_found"
has "review now accepted" "$(as anon '' "select submit_review('$T4','$OI4',5,'Aisha','Lovely','true_to_size')")" "[0-9a-f]\{8\}-"
has "get_order shows reviewed" "$(as anon '' "select get_order('$T4')")" "\"reviewed\": true"
echo; echo "PASS=$PASS FAIL=$FAIL"
