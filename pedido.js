(() => {
const $ = id => document.getElementById(id);
const brl = cents => new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(cents/100);
const state = {products:[],rates:[],cart:{},category:"Todos",fallbackCents:200,fallbackKm:3,ordersOpen:false};
const esc = s => String(s||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
async function init(){
 const ribbon=$("demo-ribbon");if(ribbon)ribbon.hidden=true;
 const controller=new AbortController();
 const timeout=setTimeout(()=>controller.abort(),12000);
 $("menu-status").textContent="Conectando ao cardápio...";
 $("business-hours-status").textContent="Consultando horário de atendimento...";
 try{
  const response=await fetch("/api/public-order/menu",{signal:controller.signal,cache:"no-store"});
  let data=null;try{data=await response.json();}catch{}
  if(!response.ok)throw Error(data?.error||"Não foi possível carregar o cardápio.");
  if(!data||!Array.isArray(data.products))throw Error("O servidor retornou um cardápio inválido.");
  state.products=data.products;state.rates=Array.isArray(data.deliveryRates)?data.deliveryRates:[];state.fallbackCents=Number(data.deliveryFallbackCents??200);state.fallbackKm=Number(data.deliveryFallbackKm??3);if($("fallback-distance-help"))$("fallback-distance-help").textContent=`Usaremos ${brl(state.fallbackCents)} a cada ${state.fallbackKm} km para bairros não cadastrados.`;
  if(ribbon)ribbon.hidden=!data.demo;
  const heroImage=$("store-hero-image");
  if(data.heroImageDataUrl){heroImage.src=data.heroImageDataUrl;heroImage.hidden=false;$("store-hero").classList.add("has-image");}
  categories();products();neighborhoods();hours(data.businessHours);
 }catch(e){
  state.ordersOpen=false;
  const message=e.name==="AbortError"?"O cardápio demorou para responder. Atualize a página para tentar novamente.":(e.message||"Não foi possível carregar o cardápio.");
  $("menu-status").textContent=message;$("menu-count").textContent="Cardápio indisponível";
  $("business-hours-status").textContent="Não foi possível consultar o horário";$("business-hours-badge").textContent="Indisponível";$("business-hours-badge").classList.remove("is-open");$("business-hours-detail").textContent="Tente atualizar a página em alguns instantes.";cart();
 }finally{clearTimeout(timeout);}
}
function categories(){const names=["Todos",...new Set(state.products.map(p=>p.category))];$("category-tabs").innerHTML=names.map(n=>'<button class="category-tab '+(state.category===n?'active':'')+'" data-category="'+esc(n)+'">'+esc(n)+'</button>').join("");}
function products(){
 const q=$("menu-search").value.toLowerCase().trim();
 const list=state.products.filter(p=>(state.category==="Todos"||p.category===state.category)&&(p.name.toLowerCase().includes(q)||p.category.toLowerCase().includes(q)));
 $("menu-count").textContent=list.length+" "+(list.length===1?"produto":"produtos");
 const categoryNames=[...new Set(list.map(p=>p.category))];
 $("menu-grid").innerHTML=categoryNames.map(category=>{
  const items=list.filter(p=>p.category===category);
  const cards=items.map(p=>'\u003carticle class="menu-product"\u003e\u003cdiv class="menu-photo"\u003e'+(p.imageDataUrl?'\u003cimg src="'+p.imageDataUrl+'" alt="'+esc(p.name)+'" style="width:100%;height:100%;object-fit:cover"\u003e':'✳')+'\u003c/div\u003e\u003cdiv class="menu-product-copy"\u003e\u003ch3\u003e'+esc(p.name)+'\u003c/h3\u003e\u003cp\u003e'+esc(p.category)+'\u003c/p\u003e\u003cstrong class="menu-price"\u003e'+brl(p.unitPriceCents)+'\u003c/strong\u003e\u003c/div\u003e\u003cdiv class="menu-product-controls"\u003e\u003cspan\u003e'+(state.cart[p.id]||0)+' no carrinho\u003c/span\u003e\u003cbutton class="quantity-add" data-add="'+esc(p.id)+'"\u003eAdicionar +\u003c/button\u003e\u003c/div\u003e\u003c/article\u003e').join("");
  return '\u003csection class="menu-category"\u003e\u003cdiv class="menu-category-heading"\u003e\u003cspan\u003e'+esc(category)+'\u003c/span\u003e\u003cb\u003e'+items.length+' '+(items.length===1?'opção':'opções')+'\u003c/b\u003e\u003c/div\u003e\u003cdiv class="menu-category-grid"\u003e'+cards+'\u003c/div\u003e\u003c/section\u003e';
 }).join("");
 $("menu-empty").hidden=list.length>0;$("menu-status").textContent="Selecione os produtos para adicionar à sua cestinha.";
}
function neighborhoods(){ $("customer-neighborhood").innerHTML='<option value="">Selecione seu bairro</option>'+state.rates.map(r=>'<option value="'+esc(r.neighborhood)+'">'+esc(r.neighborhood)+' · '+brl(r.feeCents)+'</option>').join("")+'<option value="__unregistered">Outro bairro / não cadastrado</option>'; }
function hours(h){
 if(!h)return;
 state.ordersOpen=h.isOpen===true;
 const days=[["mon","Seg"],["tue","Ter"],["wed","Qua"],["thu","Qui"],["fri","Sex"],["sat","Sáb"],["sun","Dom"]];
 const formatTime=value=>String(value||"").slice(0,5).replace(":","h");
 const schedule=h.schedule||{};
 const detail=h.enabled
  ? days.map(([key,label])=>{const day=schedule[key];if(!day)return label+": não definido";return label+": "+(day.closed?"fechado":formatTime(day.open)+"–"+formatTime(day.close));}).join(" · ")
  : "Horário automático desativado.";
 const open=state.ordersOpen;
 $("business-hours-status").textContent=open?"Estamos recebendo pedidos":(h.enabled?"No momento estamos fechados":"Recebimento de pedidos pausado pela loja");
 $("business-hours-badge").textContent=open?"Aberto":"Fechado";
 $("business-hours-badge").classList.toggle("is-open",open);
 $("business-hours-detail").textContent=detail;
 cart();
}
function updateFallbackDistance(){ const unregistered=$("customer-neighborhood").value==="__unregistered"; $("fallback-distance-field").hidden=!unregistered; $("delivery-distance").required=unregistered; $("customer-neighborhood-name").required=unregistered; if(!unregistered){$("delivery-distance").value="";$("customer-neighborhood-name").value="";} }
function fee(){if($("fulfillment-type").value!=="delivery")return 0;const r=state.rates.find(x=>x.neighborhood===$("customer-neighborhood").value);if(r)return r.feeCents;if($("customer-neighborhood").value==="__unregistered"){const distance=Math.max(0,Number($("delivery-distance").value||0));return Math.ceil(distance/(state.fallbackKm||3))*(state.fallbackCents||200);}return 0;}
function cart(){
 const items=Object.entries(state.cart).filter(x=>x[1]>0);
 $("cart-items").innerHTML=items.length?items.map(([id,n])=>{const p=state.products.find(x=>x.id===id);return '<div class="cart-row"><span>'+esc(p.name)+' × '+n+'</span><span>'+brl(p.unitPriceCents*n)+' <button data-minus="'+id+'">−</button></span></div>';}).join(""):'<p class="cart-empty">Sua cestinha ainda está vazia.</p>';
 const sub=items.reduce((s,[id,n])=>s+state.products.find(p=>p.id===id).unitPriceCents*n,0),total=sub+fee();
 $("cart-subtotal").textContent=brl(sub);$("cart-freight").textContent=brl(fee());$("cart-total").textContent=brl(total);
 const count=items.reduce((s,x)=>s+x[1],0);$("mobile-cart-count").textContent=count;$("mobile-cart-count").hidden=!count;
 $("submit-order").disabled=!count||!state.ordersOpen;
 $("submit-order").textContent=state.ordersOpen?"Confirmar pedido →":"Pedidos fechados no momento";
 products();
}
function openCart(){const panel=$("checkout-panel");$("mobile-checkout-slot").append(panel);$("mobile-checkout-overlay").hidden=false;document.body.classList.add("checkout-open");$("mobile-cart-trigger").setAttribute("aria-expanded","true");$("mobile-checkout-close").focus();}
function closeCart(){const panel=$("checkout-panel");$("mobile-checkout-overlay").hidden=true;document.body.classList.remove("checkout-open");$("mobile-cart-trigger").setAttribute("aria-expanded","false");$("order-layout").append(panel);}
document.addEventListener("click",e=>{
 const add=e.target.closest("[data-add]");if(add){state.cart[add.dataset.add]=(state.cart[add.dataset.add]||0)+1;cart();}
 const minus=e.target.closest("[data-minus]");if(minus){state.cart[minus.dataset.minus]=Math.max(0,(state.cart[minus.dataset.minus]||0)-1);cart();}
 const cat=e.target.closest("[data-category]");if(cat){state.category=cat.dataset.category;categories();products();}
});
$("menu-search").addEventListener("input",products);
$("fulfillment-type").addEventListener("change",()=>{const delivery=$("fulfillment-type").value==="delivery";$("delivery-fields").hidden=!delivery;$("customer-address").required=delivery;$("customer-neighborhood").required=delivery;cart();});
$("customer-neighborhood").addEventListener("change",()=>{updateFallbackDistance();cart();});
$("delivery-distance").addEventListener("input",cart);
$("mobile-cart-trigger").addEventListener("click",openCart);
$("mobile-checkout-close").addEventListener("click",closeCart);
$("mobile-checkout-backdrop").addEventListener("click",closeCart);
$("public-order-form").addEventListener("submit",async e=>{
 e.preventDefault();
 if(!state.ordersOpen){alert("A loja não está recebendo pedidos neste momento. Confira os horários de atendimento.");return;}
 if(!e.currentTarget.reportValidity())return;
 const neighborhood=$("customer-neighborhood").value==="__unregistered"?$("customer-neighborhood-name").value:$("customer-neighborhood").value;
 const payload={requestId:crypto.randomUUID(),customerName:$("customer-name").value,phone:$("customer-phone").value,address:$("customer-address").value,neighborhood,distanceKm:Number($("delivery-distance").value||0),fulfillmentType:$("fulfillment-type").value,paymentMethod:$("payment-method").value,notes:$("order-notes").value,items:Object.entries(state.cart).filter(x=>x[1]>0).map(([productId,quantity])=>({productId,quantity}))};
 const btn=$("submit-order");btn.disabled=true;btn.textContent="Enviando…";
 try{const r=await fetch("/api/public-order/orders",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});const data=await r.json();if(!r.ok)throw Error(data.error||"Não foi possível enviar.");$("public-order-form").hidden=true;$("order-confirmation").hidden=false;$("confirmation-message").textContent="Pedido "+data.orderId+" registrado. Total: "+brl(data.totalCents)+".";$("demo-order-note").hidden=!data.demo;}
 catch(err){alert(err.message);}finally{btn.textContent="Confirmar pedido →";cart();}
});
$("new-order").addEventListener("click",()=>{state.cart={};$("public-order-form").reset();$("public-order-form").hidden=false;$("order-confirmation").hidden=true;closeCart();cart();});
$("current-year").textContent=new Date().getFullYear();
init();
})();