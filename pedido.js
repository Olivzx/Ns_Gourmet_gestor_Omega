(() => {
const $ = id => document.getElementById(id);
const brl = cents => new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(cents/100);
const state = {products:[],rates:[],cart:{},category:"Todos"};
const esc = s => String(s||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
async function init(){
 try{
  const response=await fetch("/api/public-order/menu"); if(!response.ok)throw Error("Falha ao carregar cardápio.");
  const data=await response.json();state.products=data.products||[];state.rates=data.deliveryRates||[];
  $("demo-ribbon").hidden=!data.demo;
  categories();products();neighborhoods();hours(data.businessHours);
 }catch(e){$("menu-status").textContent=e.message;}
}
function categories(){const names=["Todos",...new Set(state.products.map(p=>p.category))];$("category-tabs").innerHTML=names.map(n=>'<button class="category-tab '+(state.category===n?'active':'')+'" data-category="'+esc(n)+'">'+esc(n)+'</button>').join("");}
function products(){
 const q=$("menu-search").value.toLowerCase();
 const list=state.products.filter(p=>(state.category==="Todos"||p.category===state.category)&&p.name.toLowerCase().includes(q));
 $("menu-count").textContent=state.products.length+" produtos";
 $("menu-grid").innerHTML=list.map(p=>'<article class="menu-product"><div class="menu-photo">'+(p.imageDataUrl?'<img src="'+p.imageDataUrl+'" style="width:100%;height:100%;object-fit:cover">':'✳')+'</div><div class="menu-product-copy"><h3>'+esc(p.name)+'</h3><p>'+esc(p.category)+'</p><strong class="menu-price">'+brl(p.unitPriceCents)+'</strong></div><div class="menu-product-controls"><span>'+(state.cart[p.id]||0)+' no carrinho</span><button class="quantity-add" data-add="'+esc(p.id)+'">Adicionar +</button></div></article>').join("");
 $("menu-empty").hidden=list.length>0;$("menu-status").textContent="Selecione os produtos para adicionar à sua cestinha.";
}
function neighborhoods(){$("customer-neighborhood").innerHTML='<option value="">Selecione seu bairro</option>'+state.rates.map(r=>'<option value="'+esc(r.neighborhood)+'">'+esc(r.neighborhood)+' · '+brl(r.feeCents)+'</option>').join("");}
function hours(h){if(!h)return;$("business-hours-status").textContent=h.isOpen===false?"No momento estamos fechados":"Estamos recebendo pedidos";$("business-hours-badge").textContent=h.isOpen===false?"Fechado":"Aberto";$("business-hours-badge").classList.toggle("is-open",h.isOpen!==false);$("business-hours-detail").textContent="Segunda a sábado, das 12h30 às 19h.";}
function fee(){if($("fulfillment-type").value!=="delivery")return 0;const r=state.rates.find(x=>x.neighborhood===$("customer-neighborhood").value);return r?r.feeCents:0;}
function cart(){
 const items=Object.entries(state.cart).filter(x=>x[1]>0);
 $("cart-items").innerHTML=items.length?items.map(([id,n])=>{const p=state.products.find(x=>x.id===id);return '<div class="cart-row"><span>'+esc(p.name)+' × '+n+'</span><span>'+brl(p.unitPriceCents*n)+' <button data-minus="'+id+'">−</button></span></div>';}).join(""):'<p class="cart-empty">Sua cestinha ainda está vazia.</p>';
 const sub=items.reduce((s,[id,n])=>s+state.products.find(p=>p.id===id).unitPriceCents*n,0),total=sub+fee();
 $("cart-subtotal").textContent=brl(sub);$("cart-freight").textContent=brl(fee());$("cart-total").textContent=brl(total);
 const count=items.reduce((s,x)=>s+x[1],0);$("mobile-cart-count").textContent=count;$("mobile-cart-count").hidden=!count;
 $("submit-order").disabled=!count;products();
}
function openCart(){if(innerWidth>760)return;const panel=$("checkout-panel");$("mobile-checkout-slot").append(panel);$("mobile-checkout-overlay").hidden=false;document.body.classList.add("checkout-open");}
function closeCart(){const panel=$("checkout-panel");$("mobile-checkout-overlay").hidden=true;document.body.classList.remove("checkout-open");$("order-layout").append(panel);}
document.addEventListener("click",e=>{
 const add=e.target.closest("[data-add]");if(add){state.cart[add.dataset.add]=(state.cart[add.dataset.add]||0)+1;cart();}
 const minus=e.target.closest("[data-minus]");if(minus){state.cart[minus.dataset.minus]=Math.max(0,(state.cart[minus.dataset.minus]||0)-1);cart();}
 const cat=e.target.closest("[data-category]");if(cat){state.category=cat.dataset.category;categories();products();}
});
$("menu-search").addEventListener("input",products);
$("fulfillment-type").addEventListener("change",()=>{const delivery=$("fulfillment-type").value==="delivery";$("delivery-fields").hidden=!delivery;$("customer-address").required=delivery;$("customer-neighborhood").required=delivery;cart();});
$("customer-neighborhood").addEventListener("change",cart);
$("mobile-cart-trigger").addEventListener("click",openCart);
$("mobile-checkout-close").addEventListener("click",closeCart);
$("mobile-checkout-backdrop").addEventListener("click",closeCart);
$("public-order-form").addEventListener("submit",async e=>{
 e.preventDefault();if(!e.currentTarget.reportValidity())return;
 const payload={requestId:crypto.randomUUID(),customerName:$("customer-name").value,phone:$("customer-phone").value,address:$("customer-address").value,neighborhood:$("customer-neighborhood").value,fulfillmentType:$("fulfillment-type").value,paymentMethod:$("payment-method").value,notes:$("order-notes").value,items:Object.entries(state.cart).filter(x=>x[1]>0).map(([productId,quantity])=>({productId,quantity}))};
 const btn=$("submit-order");btn.disabled=true;btn.textContent="Enviando…";
 try{const r=await fetch("/api/public-order/orders",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});const data=await r.json();if(!r.ok)throw Error(data.error||"Não foi possível enviar.");$("public-order-form").hidden=true;$("order-confirmation").hidden=false;$("confirmation-message").textContent="Pedido "+data.orderId+" registrado. Total: "+brl(data.totalCents)+".";$("demo-order-note").hidden=!data.demo;}
 catch(err){alert(err.message);}finally{btn.textContent="Confirmar pedido →";cart();}
});
$("new-order").addEventListener("click",()=>{state.cart={};$("public-order-form").reset();$("public-order-form").hidden=false;$("order-confirmation").hidden=true;closeCart();cart();});
$("current-year").textContent=new Date().getFullYear();
init();
})();