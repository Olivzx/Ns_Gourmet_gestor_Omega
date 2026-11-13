(() => {
"use strict";
const $=s=>document.querySelector(s);
const days=[["sun","Domingo"],["mon","Segunda"],["tue","Terça"],["wed","Quarta"],["thu","Quinta"],["fri","Sexta"],["sat","Sábado"]];
const statusLabels={received:"Recebido",preparing:"Em preparo",ready:"Pronto",out_for_delivery:"Saiu para entrega",completed:"Concluído",cancelled:"Cancelado"};
const paymentLabels={pending:"Pendente",paid:"Pago",refunded:"Estornado"};
const methodLabels={pix:"Pix",cash:"Dinheiro",debit:"Débito",credit:"Crédito",transfer:"Transferência",other:"Outro"};
const unitLabels={un:"un",kg:"kg",g:"g",l:"L",ml:"ml",pct:"pacote",cx:"caixa"};
let token=sessionStorage.getItem("omega_admin_token")||"",user=null;
let autoRefreshTimer=null,loading=false;
let pendingImageFile=null,pendingImage=null,pendingImageObjectUrl=null;
let data={orders:[],products:[],settings:null,rates:[],finance:[],categories:[],inventory:[],movements:[]};
const money=c=>(Number(c||0)/100).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const localDate=()=>{const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0")].join("-");};
const dateLabel=v=>{if(!v)return "—";const raw=String(v);const d=new Date(/^\\d{4}-\\d{2}-\\d{2}$/.test(raw)?raw+"T12:00:00":raw);return d.toLocaleDateString("pt-BR");};
const localDateOf=v=>{const d=new Date(v);return [d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0")].join("-");};
const dateTime=v=>v?new Date(v).toLocaleString("pt-BR"):"—";
const cents=v=>Math.round(Number(v||0)*100);
const number=v=>Number(v||0).toLocaleString("pt-BR",{maximumFractionDigits:3});
function notice(msg,bad=false){const n=$("#notice");n.textContent=msg;n.className="notice show"+(bad?" bad":"");}
async function api(path,options={}){const res=await fetch(path,{...options,headers:{"content-type":"application/json",...(token?{authorization:"Bearer "+token}:{}),...(options.headers||{})}});const body=await res.json().catch(()=>({}));if(!res.ok){if(res.status===401&&path!=="/api/admin/login")logout(false);throw new Error(body.error||body.message||"Não foi possível concluir a operação.");}return body;}
function showLogin(){ $("#login-view").hidden=false;$("#dashboard").hidden=true;$("#logout").hidden=true;$("#refresh").hidden=true; }
function showApp(){ $("#login-view").hidden=true;$("#dashboard").hidden=false;$("#logout").hidden=false;$("#refresh").hidden=false;$("#admin-email").textContent=user?.email||""; }
function logout(show=true){if(autoRefreshTimer){clearInterval(autoRefreshTimer);autoRefreshTimer=null;}token="";user=null;sessionStorage.removeItem("omega_admin_token");showLogin();if(show)notice("Sessão encerrada.");}
function monthEntries(){const now=new Date();return data.finance.filter(e=>{const raw=e.paid_at||e.due_date;if(!raw)return false;const d=new Date(raw);return d.getFullYear()===now.getFullYear()&&d.getMonth()===now.getMonth()&&e.status==="paid";});}
function sums(entries){return entries.reduce((a,e)=>{if(e.kind==="income")a.income+=Number(e.amount_cents||0);else a.expense+=Number(e.amount_cents||0);return a;},{income:0,expense:0});}
function stat(label,value,note){return '<article><small>'+esc(label)+'</small><b>'+value+'</b>'+(note?'<span class="stat-note">'+esc(note)+'</span>':'')+'</article>';}
function empty(msg){return '<p class="empty">'+esc(msg)+'</p>';}
async function login(e){e.preventDefault();$("#login-error").textContent="";const btn=$("#login-form button[type=submit]");btn.disabled=true;try{const r=await api("/api/admin/login",{method:"POST",body:JSON.stringify({email:$("#email").value.trim(),password:$("#password").value})});token=r.access_token;user=r.user;sessionStorage.setItem("omega_admin_token",token);$("#password").value="";showApp();switchView("overview");await load();startAutoRefresh();}catch(err){$("#login-error").textContent=err.message;}finally{btn.disabled=false;}}
async function load(){if(loading)return;loading=true;try{data=await api("/api/admin/data");renderAll();}catch(e){notice(e.message,true);}finally{loading=false;}}
async function refreshOrdersSilently(){if(!token||document.visibilityState==="hidden"||loading)return;loading=true;try{data=await api("/api/admin/data");renderOverview();renderOrders();renderDeliveries();renderCustomers();renderFinance();renderReports();}catch(e){console.warn("Falha na atualização automática dos pedidos:",e);}finally{loading=false;}}
function startAutoRefresh(){if(autoRefreshTimer)clearInterval(autoRefreshTimer);autoRefreshTimer=setInterval(refreshOrdersSilently,5000);}
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")refreshOrdersSilently();});
function renderAll(){renderOverview();renderOrders();renderDeliveries();renderProducts();renderCustomers();renderInventory();renderFinance();renderReports();renderSettings();}
function renderOverview(){
 const orders=data.orders||[],paid=monthEntries(),s=sums(paid),pendingOrders=orders.filter(o=>["received","preparing","ready"].includes(o.status)).length;
 const today=localDate(),todayOrders=orders.filter(o=>localDateOf(o.created_at)===today),low=(data.inventory||[]).filter(i=>i.active&&Number(i.quantity_on_hand)<=Number(i.minimum_quantity));
 $("#today-label").textContent=new Date().toLocaleDateString("pt-BR",{weekday:"long",day:"2-digit",month:"long"});
 $("#overview-stats").innerHTML=[stat("Pedidos em aberto",pendingOrders,"Aguardando conclusão"),stat("Pedidos de hoje",todayOrders.length,"Todos os canais"),stat("Receitas recebidas no mês",money(s.income),"Lançamentos efetivamente pagos"),stat("Saldo do mês",money(s.income-s.expense),"Receitas menos despesas pagas")].join("");
 $("#overview-finance").innerHTML=[["Receitas recebidas",s.income],["Despesas pagas",s.expense],["Resultado do mês",s.income-s.expense]].map(x=>'<div class="finance-metric"><small>'+x[0]+'</small><b>'+money(x[1])+'</b></div>').join("");
 $("#overview-stock").innerHTML=low.length?low.slice(0,5).map(i=>'<div class="report-row"><div><strong>'+esc(i.name)+'</strong><small>'+number(i.quantity_on_hand)+' '+esc(unitLabels[i.unit]||i.unit)+' · mínimo '+number(i.minimum_quantity)+'</small></div><span class="status-pill pending">Repor</span></div>').join(""):empty("Nenhum item abaixo do estoque mínimo.");
 $("#overview-orders").innerHTML=orders.length?orders.slice(0,5).map(orderCard).join(""):empty("Os pedidos recentes aparecerão aqui.");
}
function orderCard(o){
 const items=(o.public_order_items||[]).map(i=>number(i.quantity)+"x "+esc(i.product_name)).join(" · ");
 return '<article class="order-card"><div class="order-main"><strong>'+esc(o.customer_name)+' <span class="price">'+money(o.total_cents)+'</span></strong><small>'+dateTime(o.created_at)+' · '+(o.fulfillment_type==="delivery"?"Entrega":"Retirada")+' · '+esc(o.neighborhood||"")+'</small><div class="order-items">'+(items||"Itens indisponíveis")+'<br>'+esc(o.address||"")+' '+(o.phone?"· "+esc(o.phone):"")+'<br>Pagamento: '+esc(methodLabels[o.payment_method]||o.payment_method||"—")+'</div><div class="finance-meta"><span class="status-pill">'+esc(statusLabels[o.status]||o.status)+'</span><span class="status-pill '+(o.payment_status==="paid"?"paid":"pending")+'">'+esc(paymentLabels[o.payment_status]||"Pendente")+'</span></div></div><div class="order-actions"><select data-order-status="'+esc(o.id)+'" aria-label="Etapa do pedido">'+Object.entries(statusLabels).map(([v,l])=>'<option value="'+v+'" '+(o.status===v?"selected":"")+'>'+l+'</option>').join("")+'</select><select class="payment-select" data-payment-status="'+esc(o.id)+'" aria-label="Situação do pagamento">'+Object.entries(paymentLabels).map(([v,l])=>'<option value="'+v+'" '+((o.payment_status||"pending")===v?"selected":"")+'>'+l+'</option>').join("")+'</select></div></article>';
}
function renderOrders(){
 const orders=data.orders||[],pending=orders.filter(o=>["received","preparing","ready"].includes(o.status)).length;$("#pending-count").textContent=pending;
 const filter=$("#order-filter").value,shown=orders.filter(o=>filter==="all"||o.status===filter);
 $("#orders-list").innerHTML=shown.length?shown.map(orderCard).join(""):empty("Nenhum pedido encontrado neste filtro.");
}
function renderDeliveries(){
 const list=(data.orders||[]).filter(o=>o.fulfillment_type==="delivery"),active=list.filter(o=>!["completed","cancelled"].includes(o.status)),done=list.filter(o=>o.status==="completed");
 $("#delivery-stats").innerHTML=[stat("Entregas ativas",active.length),stat("Prontas para sair",list.filter(o=>o.status==="ready").length),stat("Concluídas",done.length)].join("");
 $("#deliveries-list").innerHTML=list.length?list.map(orderCard).join(""):empty("Não há pedidos de entrega registrados.");
}
function getMenuProducts(){
 const products=[...(data.products||[])],mode=$("#product-sort-mode")?.value||"manual";
 const collator=new Intl.Collator("pt-BR",{sensitivity:"base",numeric:true});
 const sorters={"name-asc":(a,b)=>collator.compare(a.name,b.name),"name-desc":(a,b)=>collator.compare(b.name,a.name),"price-asc":(a,b)=>Number(a.unit_price_cents)-Number(b.unit_price_cents),"price-desc":(a,b)=>Number(b.unit_price_cents)-Number(a.unit_price_cents),"date-desc":(a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0),"date-asc":(a,b)=>new Date(a.created_at||0)-new Date(b.created_at||0)};
 return sorters[mode]?products.sort(sorters[mode]):products.sort((a,b)=>Number(a.sort_order||0)-Number(b.sort_order||0));
}
function getMenuCategories(){
 const names=[...new Set((data.products||[]).map(p=>String(p.category||"").trim()).filter(Boolean))],saved=data.menuCategories||[],mode=$("#category-sort-mode")?.value||"manual";
 const collator=new Intl.Collator("pt-BR",{sensitivity:"base",numeric:true}),count=n=>(data.products||[]).filter(p=>p.category===n).length;
 const created=n=>saved.find(c=>c.name===n)?.created_at||Math.min(...(data.products||[]).filter(p=>p.category===n).map(p=>new Date(p.created_at||0).getTime()));
 const sorters={"name-asc":(a,b)=>collator.compare(a,b),"name-desc":(a,b)=>collator.compare(b,a),"count-desc":(a,b)=>count(b)-count(a)||collator.compare(a,b),"count-asc":(a,b)=>count(a)-count(b)||collator.compare(a,b),"date-desc":(a,b)=>new Date(created(b))-new Date(created(a)),"date-asc":(a,b)=>new Date(created(a))-new Date(created(b))};
 return names.sort(sorters[mode]||((a,b)=>{const order=n=>saved.find(c=>c.name===n)?.sort_order;return (order(a)??999999)-(order(b)??999999)||collator.compare(a,b)}));
}
function renderCategoryOrder(){
 const holder=$("#menu-category-order");if(!holder)return;const categories=getMenuCategories();
 holder.innerHTML=categories.length?categories.map((name,i)=>'<div class="menu-category-row"><strong>'+esc(name)+'</strong><span>'+((data.products||[]).filter(p=>p.category===name).length)+' produtos</span><div><button type="button" data-category-up="'+esc(name)+'" '+(i===0?'disabled':'')+'>↑</button><button type="button" data-category-down="'+esc(name)+'" '+(i===categories.length-1?'disabled':'')+'>↓</button></div></div>').join(""):empty("Cadastre produtos para organizar as categorias.");
}
function renderProducts(){
 const list=$("#products-list"),products=getMenuProducts();
 list.innerHTML=products.length?products.map(p=>{
 const margin=Number(p.unit_price_cents||0)-Number(p.cost_price_cents||0),pct=Number(p.unit_price_cents)>0?Math.round(margin/Number(p.unit_price_cents)*100):0;
 return '<article class="product-row" data-product-row="'+esc(p.id)+'"><div class="product-info">'+(p.image_url?'<img class="product-thumb" src="'+esc(p.image_url)+'" alt="">':'<div class="product-thumb"></div>')+'<div><strong>'+esc(p.name)+'</strong><div class="product-detail">'+esc(p.category)+' · '+money(p.unit_price_cents)+' · custo '+money(p.cost_price_cents)+' · margem bruta '+pct+'%</div><small>'+(p.sku?"SKU "+esc(p.sku)+" · ":"")+(p.prep_minutes?esc(p.prep_minutes)+" min · ":"")+(p.available?"Visível no cardápio":"Indisponível")+'</small></div></div><div class="product-actions"><button type="button" data-product-up="'+esc(p.id)+'">↑</button><button type="button" data-product-down="'+esc(p.id)+'">↓</button><button data-edit-product="'+esc(p.id)+'">Editar</button><button data-delete-product="'+esc(p.id)+'">Excluir</button></div></article>';
 }).join(""):empty("Nenhum produto cadastrado.");
 const cats=[...new Set((data.products||[]).map(p=>p.category).filter(Boolean))];$("#category-options").innerHTML=cats.map(c=>'<option value="'+esc(c)+'"></option>').join("");
 renderCategoryOrder();
}
function openProduct(p=null){
 $("#product-form").hidden=false;$("#product-form-title").textContent=p?"Editar produto":"Novo produto";$("#product-id").value=p?.id||"";
 $("#product-name").value=p?.name||"";$("#product-category").value=p?.category||"";$("#product-sku").value=p?.sku||"";
 $("#product-price").value=p?(Number(p.unit_price_cents)/100).toFixed(2):"";$("#product-cost").value=p?(Number(p.cost_price_cents||0)/100).toFixed(2):"0";
 $("#product-prep").value=p?.prep_minutes??"";$("#product-image").value=p?.image_url||"";$("#product-image-file").value="";$("#product-image-original").checked=true;updateImageEditorMode();pendingImageFile=null;pendingImage=null;if(pendingImageObjectUrl){URL.revokeObjectURL(pendingImageObjectUrl);pendingImageObjectUrl=null;}$("#product-image-fit").value="contain";$("#product-image-zoom").value="1";$("#product-image-x").value="50";$("#product-image-y").value="50";$("#product-description").value=p?.description||"";
 $("#product-available").checked=p?.available!==false;previewProductImage();updateMargin();
 $("#product-form").scrollIntoView({behavior:"smooth",block:"start"});
}
function drawEditedProductImage(canvas){
 const img=pendingImage;if(!img||!canvas)return;const ctx=canvas.getContext("2d"),fit=$("#product-image-fit").value,zoom=Number($("#product-image-zoom").value||1),x=Number($("#product-image-x").value||50)/100,y=Number($("#product-image-y").value||50)/100;
 ctx.clearRect(0,0,canvas.width,canvas.height);const base=fit==="cover"?Math.max(canvas.width/img.naturalWidth,canvas.height/img.naturalHeight):Math.min(canvas.width/img.naturalWidth,canvas.height/img.naturalHeight),scale=base*zoom,w=img.naturalWidth*scale,h=img.naturalHeight*scale;ctx.drawImage(img,(canvas.width-w)*x,(canvas.height-h)*y,w,h);
}
function previewProductImage(){
 const holder=$("#product-image-preview"),url=$("#product-image").value.trim();
 if(pendingImage){holder.innerHTML='<canvas id="product-image-canvas" width="360" height="360" aria-label="Prévia editável da capa"></canvas>';drawEditedProductImage($("#product-image-canvas"));return;}
 holder.innerHTML=url?'<img src="'+esc(url)+'" alt="Prévia do produto" onerror="this.remove();this.parentNode.innerHTML=\'<span>Não foi possível carregar a imagem</span>\'">':'<span>Prévia da imagem</span>';
}
function updateMargin(){const price=cents($("#product-price").value),cost=cents($("#product-cost").value),margin=price-cost,pct=price>0?Math.round(margin/price*100):0;$("#product-margin").textContent=price>0?"Margem bruta estimada: "+money(margin)+" ("+pct+"% do preço de venda).":"Informe o preço de venda e o custo para calcular a margem estimada.";}
function renderCustomers(){
 const map=new Map();
 (data.orders||[]).forEach(o=>{const key=(o.phone||o.customer_name||"").replace(/\D/g,"")||o.customer_name;const current=map.get(key)||{name:o.customer_name,phone:o.phone||"",address:o.address||"",neighborhood:o.neighborhood||"",orders:0,total:0,last:o.created_at};current.orders++;if(o.payment_status==="paid")current.total+=Number(o.total_cents||0);if(new Date(o.created_at)>new Date(current.last||0))current.last=o.created_at;if(!current.address&&o.address)current.address=o.address;if(!current.neighborhood&&o.neighborhood)current.neighborhood=o.neighborhood;map.set(key,current);});
 const term=($("#customer-search").value||"").toLowerCase().trim(),customers=[...map.values()].filter(c=>(c.name+" "+c.phone+" "+c.neighborhood).toLowerCase().includes(term)).sort((a,b)=>new Date(b.last)-new Date(a.last));
 $("#customers-list").innerHTML=customers.length?customers.map(c=>'<article class="customer-row"><div class="customer-avatar">'+esc((c.name||"?").trim().slice(0,1).toUpperCase())+'</div><div class="customer-main"><strong>'+esc(c.name)+'</strong><small>'+esc(c.phone||"Telefone não informado")+' · '+esc(c.neighborhood||"Bairro não informado")+'<br>'+esc(c.address||"Endereço não informado")+'<br>Último pedido: '+dateTime(c.last)+'</small></div><div class="inventory-level"><b>'+c.orders+'</b><small>pedidos · '+money(c.total)+' pagos</small></div></article>').join(""):empty("Nenhum cliente encontrado.");
}
function renderInventory(){
 const items=data.inventory||[],active=items.filter(i=>i.active),low=active.filter(i=>Number(i.quantity_on_hand)<=Number(i.minimum_quantity));
 $("#inventory-stats").innerHTML=[stat("Itens cadastrados",active.length),stat("Abaixo do mínimo",low.length,"Precisam de reposição"),stat("Movimentações",data.movements.length,"Histórico recente")].join("");
 $("#inventory-list").innerHTML=items.length?items.map(i=>'<article class="inventory-row '+(i.active&&Number(i.quantity_on_hand)<=Number(i.minimum_quantity)?"low-stock":"")+'"><div class="customer-main"><strong>'+esc(i.name)+'</strong><small>Custo base: '+money(i.unit_cost_cents)+' por '+esc(unitLabels[i.unit]||i.unit)+' · mínimo '+number(i.minimum_quantity)+' '+esc(unitLabels[i.unit]||i.unit)+'</small></div><div class="inventory-level"><b>'+number(i.quantity_on_hand)+' '+esc(unitLabels[i.unit]||i.unit)+'</b><small>'+(i.active?(Number(i.quantity_on_hand)<=Number(i.minimum_quantity)?"Estoque baixo":"Saldo atual"):"Inativo")+'</small></div><div class="row-actions"><button data-toggle-inventory="'+esc(i.id)+'" data-active="'+String(i.active)+'">'+(i.active?"Desativar":"Reativar")+'</button></div></article>').join(""):empty("Cadastre ingredientes e materiais para começar o controle.");
 $("#movement-item").innerHTML='<option value="">Selecione o item</option>'+active.map(i=>'<option value="'+esc(i.id)+'">'+esc(i.name)+' ('+number(i.quantity_on_hand)+' '+esc(unitLabels[i.unit]||i.unit)+')</option>').join("");
 $("#movements-list").innerHTML=data.movements.length?data.movements.map(m=>'<article class="movement-row"><div class="movement-main"><strong>'+esc(m.admin_inventory_items?.name||"Item removido")+' · '+esc(m.reason)+'</strong><small>'+dateTime(m.created_at)+(m.notes?" · "+esc(m.notes):"")+'</small></div><span class="movement-type '+(m.movement_type==="in"?"in":m.movement_type==="out"?"out":"")+'">'+(m.movement_type==="in"?"Entrada":m.movement_type==="out"?"Saída":"Ajuste")+' · '+number(m.quantity)+' '+esc(unitLabels[m.admin_inventory_items?.unit]||m.admin_inventory_items?.unit||"")+'</span></article>').join(""):empty("As movimentações realizadas aparecerão aqui.");
}
function renderFinance(){
 const kind=$("#finance-kind").value||"income",prev=$("#finance-category").value;
 const categories=(data.categories||[]).filter(c=>c.active&&c.kind===kind);
 $("#finance-category").innerHTML=categories.map(c=>'<option value="'+esc(c.id)+'">'+esc(c.name)+'</option>').join("");
 if(categories.some(c=>c.id===prev))$("#finance-category").value=prev;
 const month=sums(monthEntries()),pending=data.finance.filter(e=>e.status==="pending"),pendingIn=pending.filter(e=>e.kind==="income").reduce((a,e)=>a+Number(e.amount_cents),0),pendingOut=pending.filter(e=>e.kind==="expense").reduce((a,e)=>a+Number(e.amount_cents),0);
 $("#finance-stats").innerHTML=[stat("Entradas pagas no mês",money(month.income)),stat("Despesas pagas no mês",money(month.expense)),stat("Saldo realizado",money(month.income-month.expense)),stat("A receber / pagar",money(pendingIn+pendingOut),"Lançamentos pendentes")].join("");
 const filter=$("#finance-filter").value;let entries=data.finance||[];
 if(filter==="income"||filter==="expense")entries=entries.filter(e=>e.kind===filter);else if(filter==="pending"||filter==="paid")entries=entries.filter(e=>e.status===filter);
 $("#finance-list").innerHTML=entries.length?entries.map(e=>'<article class="finance-row"><div class="finance-main"><strong>'+esc(e.description)+'</strong><div class="finance-meta"><span class="status-pill '+esc(e.status)+'">'+(e.status==="paid"?"Pago / recebido":e.status==="pending"?"Pendente":"Anulado")+'</span><small>'+esc(e.admin_finance_categories?.name||"Sem categoria")+' · '+(e.kind==="income"?"Entrada":"Saída")+' · '+(e.source_order_id?"Pedido online":"Manual")+'</small></div><small>Vencimento: '+dateLabel(e.due_date)+(e.paid_at?" · Pago em "+dateTime(e.paid_at):"")+(e.payment_method?" · "+esc(methodLabels[e.payment_method]||e.payment_method):"")+'</small></div><div class="finance-amount '+esc(e.kind)+'">'+(e.kind==="income"?"+":"−")+money(e.amount_cents)+'</div>'+(e.status!=="void"&&!e.source_order_id?'<div class="row-actions">'+(e.status==="pending"?'<button data-pay-finance="'+esc(e.id)+'">Marcar pago</button>':'')+'<button data-void-finance="'+esc(e.id)+'">Anular</button></div>':"")+'</article>').join(""):empty("Nenhum lançamento neste filtro.");
}
function renderReports(){
 const orders=(data.orders||[]).filter(o=>o.payment_status==="paid"),now=new Date(),current=orders.filter(o=>{const d=new Date(o.created_at);return d.getMonth()===now.getMonth()&&d.getFullYear()===now.getFullYear();});
 const totals=sums(monthEntries()),avg=current.length?Math.round(current.reduce((a,o)=>a+Number(o.total_cents||0),0)/current.length):0;
 $("#report-stats").innerHTML=[stat("Pedidos pagos no mês",current.length),stat("Ticket médio",money(avg)),stat("Resultado financeiro",money(totals.income-totals.expense)),stat("Margem após despesas",totals.income?Math.round((totals.income-totals.expense)/totals.income*100)+"%":"—")].join("");
 const top={};const payments={};
 current.forEach(o=>{payments[o.payment_method]=(payments[o.payment_method]||0)+Number(o.total_cents||0);(o.public_order_items||[]).forEach(i=>{top[i.product_name]=(top[i.product_name]||0)+Number(i.quantity||0);});});
 const topRows=Object.entries(top).sort((a,b)=>b[1]-a[1]).slice(0,8),maxTop=topRows.length?topRows[0][1]:1;
 $("#top-products").innerHTML=topRows.length?topRows.map(([name,q])=>'<div><div class="report-row"><strong>'+esc(name)+'</strong><span>'+q+' un.</span></div><div class="report-bar"><i style="width:'+(q/maxTop*100)+'%"></i></div></div>').join(""):empty("Ainda não há vendas pagas neste mês.");
 const paymentRows=Object.entries(payments).sort((a,b)=>b[1]-a[1]);
 $("#payment-report").innerHTML=paymentRows.length?paymentRows.map(([m,v])=>'<div class="report-row"><strong>'+esc(methodLabels[m]||m||"Não informado")+'</strong><span>'+money(v)+'</span></div>').join(""):empty("Sem dados de pagamento.");
 const allStatuses=Object.entries(statusLabels).map(([s,l])=>[l,(data.orders||[]).filter(o=>o.status===s).length]);
 const maxStatus=Math.max(1,...allStatuses.map(x=>x[1]));
 $("#status-report").innerHTML=allStatuses.map(([l,q])=>'<div><div class="report-row"><strong>'+l+'</strong><span>'+q+'</span></div><div class="report-bar"><i style="width:'+(q/maxStatus*100)+'%"></i></div></div>').join("");
}
function renderSettings(){
 const s=data.settings||{};$("#store-name").value=s.store_name||"NS Gourmet";$("#store-whatsapp").value=s.whatsapp||"";$("#store-timezone").value=s.time_zone||"America/Maceio";
 $("#accepting-orders").checked=!!s.accepting_orders;$("#hours-enabled").checked=!!s.business_hours_enabled;const h=s.business_hours||{};
 $("#hours-grid").innerHTML=days.map(([k,label])=>{const d=h[k]||{};return '<div class="hour-row"><b>'+label+'</b><label>Abre<input type="time" data-hour-open="'+k+'" value="'+esc(d.open||"")+'" '+(d.closed?"disabled":"")+'></label><label>Fecha<input type="time" data-hour-close="'+k+'" value="'+esc(d.close||"")+'" '+(d.closed?"disabled":"")+'></label><label class="check"><input type="checkbox" data-hour-closed="'+k+'" '+(d.closed?"checked":"")+'> Fechado</label></div>';}).join("");
 $("#rates-list").innerHTML=data.rates.length?data.rates.map(r=>'<div class="rate-row"><strong>'+esc(r.neighborhood)+'</strong><span class="price">'+money(r.fee_cents)+'</span><button data-delete-rate="'+esc(r.neighborhood)+'">Remover</button></div>').join(""):empty("Nenhuma taxa cadastrada.");
}
function switchView(name){document.querySelectorAll(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.view===name));document.querySelectorAll(".view").forEach(v=>v.classList.toggle("active",v.id==="view-"+name));const titles={overview:"Visão geral",orders:"Pedidos",deliveries:"Entregas",products:"Produtos",customers:"Clientes",inventory:"Estoque",finance:"Financeiro",reports:"Relatórios",settings:"Configurações"};$("#page-title").textContent=titles[name]||"Gestão";$("#sidebar").classList.remove("open");}
document.addEventListener("click",e=>{const nav=e.target.closest("[data-view]");if(nav)switchView(nav.dataset.view);const go=e.target.closest("[data-goto]");if(go)switchView(go.dataset.goto);});
$("#login-form").addEventListener("submit",login);$("#logout").addEventListener("click",()=>logout());$("#refresh").addEventListener("click",load);$("#order-filter").addEventListener("change",renderOrders);$("#menu-toggle").addEventListener("click",()=>$("#sidebar").classList.toggle("open"));
async function changeOrder(e){const id=e.target.dataset.orderStatus;if(id){try{await api("/api/admin/orders/"+encodeURIComponent(id),{method:"PATCH",body:JSON.stringify({status:e.target.value})});notice("Etapa do pedido atualizada.");await load();}catch(err){notice(err.message,true);}return;}const paymentId=e.target.dataset.paymentStatus;if(paymentId){try{await api("/api/admin/orders/"+encodeURIComponent(paymentId)+"/payment",{method:"PATCH",body:JSON.stringify({payment_status:e.target.value})});notice("Pagamento atualizado e financeiro sincronizado.");await load();}catch(err){notice(err.message,true);}}}
$("#orders-list").addEventListener("change",changeOrder);$("#deliveries-list").addEventListener("change",changeOrder);
$("#new-product").addEventListener("click",()=>openProduct());$("#cancel-product").addEventListener("click",()=>$("#product-form").hidden=true);
$("#products-list").addEventListener("click",async e=>{const edit=e.target.dataset.editProduct,del=e.target.dataset.deleteProduct;if(edit){openProduct(data.products.find(p=>p.id===edit));return;}if(del&&confirm("Excluir este produto do cardápio?")){try{await api("/api/admin/products/"+encodeURIComponent(del),{method:"DELETE"});notice("Produto excluído.");await load();}catch(err){notice(err.message,true);}}});

$("#product-sort-mode").addEventListener("change",renderProducts);
$("#category-sort-mode").addEventListener("change",renderCategoryOrder);
$("#products-list").addEventListener("click",e=>{
 const up=e.target.dataset.productUp,down=e.target.dataset.productDown,id=up||down;if(!id)return;
 const ordered=getMenuProducts(),i=ordered.findIndex(p=>p.id===id),j=i+(up?-1:1);if(i<0||j<0||j>=ordered.length)return;
 [ordered[i],ordered[j]]=[ordered[j],ordered[i]];ordered.forEach((p,index)=>p.sort_order=index+1);
 $("#product-sort-mode").value="manual";renderProducts();
});
$("#menu-category-order").addEventListener("click",e=>{
 const up=e.target.dataset.categoryUp,down=e.target.dataset.categoryDown,name=up||down;if(!name)return;
 const ordered=getMenuCategories(),i=ordered.indexOf(name),j=i+(up?-1:1);if(i<0||j<0||j>=ordered.length)return;
 [ordered[i],ordered[j]]=[ordered[j],ordered[i]];$("#category-sort-mode").value="manual";
 data.menuCategories=ordered.map((n,index)=>({name:n,sort_order:index+1}));renderCategoryOrder();
});
$("#save-menu-order").addEventListener("click",async()=>{
 const button=$("#save-menu-order");button.disabled=true;
 try{await api("/api/admin/menu-order",{method:"POST",body:JSON.stringify({productIds:getMenuProducts().map(p=>p.id),categoryNames:getMenuCategories()})});notice("Ordem do cardápio salva e aplicada à vitrine pública.");await load();}
 catch(err){notice(err.message,true);}finally{button.disabled=false;}
});
$("#product-form").addEventListener("submit",async e=>{e.preventDefault();const id=$("#product-id").value,price=cents($("#product-price").value),cost=cents($("#product-cost").value),prep=$("#product-prep").value;
 try{
 let imageUrl=$("#product-image").value.trim()||null;
 if(pendingImageFile&&pendingImage){
  const formData=new FormData();
  if($("#product-image-original").checked){
   // Envia o arquivo original, preservando dimensões, formato e qualidade.
   formData.append("file",pendingImageFile,pendingImageFile.name);
  }else{
   // Os controles de enquadramento geram uma capa quadrada otimizada.
   const canvas=document.createElement("canvas");canvas.width=1200;canvas.height=1200;drawEditedProductImage(canvas);
   const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/webp",0.9));if(!blob)throw new Error("Não foi possível preparar a imagem.");
   formData.append("file",blob,"product-cover.webp");
  }
  const response=await fetch("/api/admin/product-image",{method:"POST",headers:{authorization:"Bearer "+token},body:formData});
  const uploaded=await response.json().catch(()=>({}));if(!response.ok)throw new Error(uploaded.error||"Falha ao enviar a imagem.");imageUrl=uploaded.url;
 }
 const payload={id:id||$("#product-name").value.toLowerCase().normalize("NFD").replace(/[\\u0300-\\u036f]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,""),name:$("#product-name").value.trim(),category:$("#product-category").value.trim(),description:$("#product-description").value.trim(),sku:$("#product-sku").value.trim()||null,unit_price_cents:price,cost_price_cents:cost,prep_minutes:prep===""?null:Number(prep),image_url:imageUrl,available:$("#product-available").checked};
 await api("/api/admin/products"+(id?"/"+encodeURIComponent(id):""),{method:id?"PATCH":"POST",body:JSON.stringify(payload)});$("#product-form").hidden=true;notice("Produto salvo com sucesso.");pendingImageFile=null;pendingImage=null;if(pendingImageObjectUrl){URL.revokeObjectURL(pendingImageObjectUrl);pendingImageObjectUrl=null;}$("#product-image-file").value="";await load();
 }catch(err){notice(err.message,true);}
});
$("#product-image").addEventListener("input",()=>{pendingImageFile=null;pendingImage=null;if(pendingImageObjectUrl){URL.revokeObjectURL(pendingImageObjectUrl);pendingImageObjectUrl=null;}$("#product-image-file").value="";previewProductImage();});
$("#product-image-file").addEventListener("change",e=>{const file=e.target.files?.[0];if(!file)return;if(!["image/jpeg","image/png","image/webp"].includes(file.type)){notice("Use uma imagem JPG, PNG ou WebP.",true);e.target.value="";return;}if(file.size>8*1024*1024){notice("A imagem original deve ter no máximo 8 MB.",true);e.target.value="";return;}if(pendingImageObjectUrl)URL.revokeObjectURL(pendingImageObjectUrl);pendingImageFile=file;pendingImageObjectUrl=URL.createObjectURL(file);pendingImage=new Image();pendingImage.onload=()=>previewProductImage();pendingImage.onerror=()=>notice("Não foi possível abrir essa imagem.",true);pendingImage.src=pendingImageObjectUrl;$("#product-image").value="";});
function updateImageEditorMode(){const original=$("#product-image-original").checked;document.querySelectorAll(".image-editor-controls select,.image-editor-controls input").forEach(control=>control.disabled=original);}
$("#product-image-original").addEventListener("change",updateImageEditorMode);
["#product-image-fit","#product-image-zoom","#product-image-x","#product-image-y"].forEach(selector=>$(selector).addEventListener("input",previewProductImage));
updateImageEditorMode();
$("#product-price").addEventListener("input",updateMargin);$("#product-cost").addEventListener("input",updateMargin);
$("#customer-search").addEventListener("input",renderCustomers);
$("#inventory-item-form").addEventListener("submit",async e=>{e.preventDefault();const payload={name:$("#inventory-name").value.trim(),unit:$("#inventory-unit").value,minimum_quantity:Number($("#inventory-min").value||0),unit_cost_cents:cents($("#inventory-cost").value),notes:$("#inventory-notes").value.trim()||null};try{await api("/api/admin/inventory/items",{method:"POST",body:JSON.stringify(payload)});$("#inventory-item-form").reset();$("#inventory-min").value="0";$("#inventory-cost").value="0";notice("Item cadastrado. Registre uma entrada para lançar o saldo inicial.");await load();}catch(err){notice(err.message,true);}});
$("#inventory-movement-form").addEventListener("submit",async e=>{e.preventDefault();const payload={item_id:$("#movement-item").value,movement_type:$("#movement-type").value,quantity:Number($("#movement-quantity").value),reason:$("#movement-reason").value.trim(),notes:$("#movement-notes").value.trim()||null};try{await api("/api/admin/inventory/movements",{method:"POST",body:JSON.stringify(payload)});$("#inventory-movement-form").reset();notice("Movimentação registrada e saldo atualizado.");await load();}catch(err){notice(err.message,true);}});
$("#inventory-list").addEventListener("click",async e=>{const id=e.target.dataset.toggleInventory;if(!id)return;const item=data.inventory.find(i=>i.id===id);if(!item)return;try{await api("/api/admin/inventory/items/"+encodeURIComponent(id),{method:"PATCH",body:JSON.stringify({active:!item.active})});notice(item.active?"Item desativado.":"Item reativado.");await load();}catch(err){notice(err.message,true);}});
$("#finance-kind").addEventListener("change",renderFinance);$("#finance-filter").addEventListener("change",renderFinance);
$("#finance-date").value=localDate();
$("#finance-entry-form").addEventListener("submit",async e=>{e.preventDefault();const status=$("#finance-status").value;const payload={kind:$("#finance-kind").value,category_id:$("#finance-category").value,description:$("#finance-description").value.trim(),amount_cents:cents($("#finance-amount").value),due_date:$("#finance-date").value,status:status,payment_method:$("#finance-method").value||null,notes:$("#finance-notes").value.trim()||null};try{await api("/api/admin/finance/entries",{method:"POST",body:JSON.stringify(payload)});$("#finance-entry-form").reset();$("#finance-date").value=localDate();$("#finance-status").value="paid";notice("Lançamento financeiro salvo.");await load();}catch(err){notice(err.message,true);}});
$("#finance-list").addEventListener("click",async e=>{
 const pay=e.target.dataset.payFinance;
 if(pay){try{await api("/api/admin/finance/entries/"+encodeURIComponent(pay),{method:"PATCH",body:JSON.stringify({status:"paid"})});notice("Lançamento marcado como pago/recebido.");await load();}catch(err){notice(err.message,true);}return;}
 const id=e.target.dataset.voidFinance;
 if(!id||!confirm("Anular este lançamento? O registro será preservado no histórico."))return;
 try{await api("/api/admin/finance/entries/"+encodeURIComponent(id),{method:"PATCH",body:JSON.stringify({status:"void"})});notice("Lançamento anulado.");await load();}catch(err){notice(err.message,true);}
});
$("#settings-form").addEventListener("submit",async e=>{e.preventDefault();const business_hours={};for(const [k] of days){business_hours[k]={open:document.querySelector('[data-hour-open="'+k+'"]').value,close:document.querySelector('[data-hour-close="'+k+'"]').value,closed:document.querySelector('[data-hour-closed="'+k+'"]').checked};}const payload={store_name:$("#store-name").value.trim(),whatsapp:$("#store-whatsapp").value.replace(/\D/g,""),time_zone:$("#store-timezone").value.trim()||"America/Maceio",accepting_orders:$("#accepting-orders").checked,business_hours_enabled:$("#hours-enabled").checked,business_hours};try{await api("/api/admin/settings",{method:"PUT",body:JSON.stringify(payload)});notice("Configurações salvas.");await load();}catch(err){notice(err.message,true);}});
$("#hours-grid").addEventListener("change",e=>{const k=e.target.dataset.hourClosed;if(!k)return;document.querySelector('[data-hour-open="'+k+'"]').disabled=e.target.checked;document.querySelector('[data-hour-close="'+k+'"]').disabled=e.target.checked;});
$("#rate-form").addEventListener("submit",async e=>{e.preventDefault();try{await api("/api/admin/rates",{method:"POST",body:JSON.stringify({neighborhood:$("#rate-neighborhood").value.trim(),fee_cents:cents($("#rate-fee").value),active:true})});$("#rate-form").reset();notice("Taxa adicionada.");await load();}catch(err){notice(err.message,true);}});
$("#rates-list").addEventListener("click",async e=>{const n=e.target.dataset.deleteRate;if(n&&confirm("Remover a taxa deste bairro?")){try{await api("/api/admin/rates/"+encodeURIComponent(n),{method:"DELETE"});notice("Taxa removida.");await load();}catch(err){notice(err.message,true);}}});
async function init(){if(!token){showLogin();return;}try{const r=await api("/api/admin/me");user=r.user;showApp();switchView("overview");await load();startAutoRefresh();}catch{logout(false);}}
init();
})();