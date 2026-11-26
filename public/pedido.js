(() => {
const $ = id => document.getElementById(id);
const brl = cents => new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(cents/100);
const state = {products:[],rates:[],cart:{},category:"Todos",fallbackCents:200,fallbackKm:3,ordersOpen:false,heroSlides:[],slideIndex:0,slideTimer:null,slideInterval:3000};
const esc = s => String(s||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
async function init(){
 try{
  const response=await fetch("/api/public-order/menu"); if(!response.ok)throw Error("Falha ao carregar cardápio.");
  const data=await response.json();state.products=data.products||[];state.rates=data.deliveryRates||[];state.fallbackCents=Number(data.deliveryFallbackCents??200);state.fallbackKm=Number(data.deliveryFallbackKm??3);if($("fallback-distance-help"))$("fallback-distance-help").textContent=`Usaremos ${brl(state.fallbackCents)} a cada ${state.fallbackKm} km para bairros não cadastrados.`;
  $("demo-ribbon").hidden=!data.demo;
  state.heroSlides = Array.isArray(data.heroSlides) && data.heroSlides.length && data.heroSlidesEnabled !== false ? data.heroSlides.filter(slide => slide && slide.url) : (data.heroImageDataUrl ? [{url:data.heroImageDataUrl,alt:"Destaque da loja"}] : []);
  state.slideInterval = Math.max(2,Math.min(30,Number(data.heroSlideIntervalSeconds)||3))*1000;
  renderHeroSlides();
  categories();products();neighborhoods();hours(data.businessHours);
 }catch(e){$("menu-status").textContent=e.message;}
}
function renderHeroSlides(){
 const hero=$("store-hero"),track=$("hero-slides");
 if(state.slideTimer){clearInterval(state.slideTimer);state.slideTimer=null;}
 if(!state.heroSlides.length){hero.classList.remove("has-image");track.innerHTML="";return;}
 hero.classList.add("has-image");state.slideIndex=0;
 track.innerHTML=state.heroSlides.map((slide,index)=>'<img class="hero-slide '+(index===0?'is-active':'')+'" src="'+esc(slide.url)+'" alt="'+esc(slide.alt||"Destaque da loja")+'" loading="'+(index===0?'eager':'lazy')+'">').join("")+
  (state.heroSlides.length>1?'<div class="hero-slide-dots" aria-label="Selecionar destaque">'+state.heroSlides.map((slide,index)=>'<button type="button" class="hero-slide-dot '+(index===0?'is-active':'')+'" data-hero-slide="'+index+'" aria-label="Mostrar slide '+(index+1)+'"></button>').join("")+'</div>':"");
 if(state.heroSlides.length>1)state.slideTimer=setInterval(()=>showHeroSlide((state.slideIndex+1)%state.heroSlides.length),state.slideInterval);
}
function showHeroSlide(index){
 const slides=[...document.querySelectorAll(".hero-slide")],dots=[...document.querySelectorAll(".hero-slide-dot")];
 if(!slides.length)return;state.slideIndex=(index+slides.length)%slides.length;
 slides.forEach((slide,i)=>slide.classList.toggle("is-active",i===state.slideIndex));
 dots.forEach((dot,i)=>dot.classList.toggle("is-active",i===state.slideIndex));
}
function categories(){const names=["Todos",...new Set(state.products.map(p=>p.category))];$("category-tabs").innerHTML=names.map(n=>'<button class="category-tab '+(state.category===n?'active':'')+'" data-category="'+esc(n)+'">'+esc(n)+'</button>').join("");}
function products(){
 const q=$("menu-search").value.toLowerCase().trim();
 const list=state.products.filter(p=>(state.category==="Todos"||p.category===state.category)&&(p.name.toLowerCase().includes(q)||p.category.toLowerCase().includes(q)));
 $("menu-count").textContent=list.length+" "+(list.length===1?"produto":"produtos");
 const categoryNames=[...new Set(list.map(p=>p.category))];
 $("menu-grid").innerHTML=categoryNames.map(category=>{
  const items=list.filter(p=>p.category===category);
  const cards=items.map(p=>{const tracked=Number.isInteger(p.stockQuantity);const remaining=tracked?Math.max(0,p.stockQuantity-(state.cart[p.id]||0)):null;const soldOut=p.available===false||(tracked&&p.stockQuantity<=0);const stockLabel=soldOut?"Esgotado":tracked?remaining+" disponíveis":"Disponível";return '<article class="menu-product '+(soldOut?'is-sold-out':'')+'"><div class="menu-photo">'+(p.imageDataUrl?'<img src="'+esc(p.imageDataUrl)+'" alt="'+esc(p.name)+'" style="width:100%;height:100%;object-fit:cover">':'✳')+'</div><div class="menu-product-copy"><h3>'+esc(p.name)+'</h3><p>'+esc(p.category)+'</p><strong class="menu-price">'+brl(p.unitPriceCents)+'</strong><small class="menu-stock '+(soldOut?'is-sold-out':'')+'">'+stockLabel+'</small></div><div class="menu-product-controls"><span>'+(state.cart[p.id]||0)+' no carrinho</span><button class="quantity-add" data-add="'+esc(p.id)+'" '+(soldOut||(tracked&&remaining<=0)?'disabled':'')+'>'+(soldOut?'Esgotado':'Adicionar +')+'</button></div></article>';}).join("");
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
 const slide=e.target.closest("[data-hero-slide]");if(slide){showHeroSlide(Number(slide.dataset.heroSlide));return;}
 const add=e.target.closest("[data-add]");if(add){const product=state.products.find(p=>p.id===add.dataset.add);if(!product||product.available===false)return;const current=state.cart[product.id]||0;if(Number.isInteger(product.stockQuantity)&&current>=product.stockQuantity){alert("Estoque disponível: "+product.stockQuantity+" unidade(s).");return;}state.cart[product.id]=current+1;cart();}
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
 try{const r=await fetch("/api/public-order/orders",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});const data=await r.json();if(!r.ok)throw Error(data.error||"Não foi possível enviar.");$("public-order-form").hidden=true;$("confirmation-message").textContent="Seu pedido nº "+data.orderId+" foi recebido pela NS Gourmet. Total: "+brl(data.totalCents)+".";$("demo-order-note").hidden=!data.demo;const whatsapp=$("confirmation-whatsapp");if(whatsapp){if(data.whatsappUrl){whatsapp.href=data.whatsappUrl;whatsapp.hidden=false;}else{whatsapp.hidden=true;whatsapp.removeAttribute("href");}}$("order-success-modal").hidden=false;document.body.classList.add("order-modal-open");$("order-success-close").focus();}
 catch(err){alert(err.message);}finally{btn.textContent="Confirmar pedido →";cart();}
});
function closeOrderModal(){ $("order-success-modal").hidden=true;document.body.classList.remove("order-modal-open"); }
$("order-success-close").addEventListener("click",closeOrderModal);
$("order-success-backdrop").addEventListener("click",closeOrderModal);
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!$("order-success-modal").hidden)closeOrderModal();});
$("new-order").addEventListener("click",()=>{closeOrderModal();state.cart={};$("public-order-form").reset();$("public-order-form").hidden=false;closeCart();cart();});
$("current-year").textContent=new Date().getFullYear();
init();
})();