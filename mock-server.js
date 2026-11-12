"use strict";
const http=require("node:http"),fs=require("node:fs"),path=require("node:path");
const root=__dirname,menu=JSON.parse(fs.readFileSync(path.join(root,"data/menu.json"),"utf8")),ordersFile=path.join(root,"data/demo-orders.json"),port=Number(process.env.PORT||3000);
if(!fs.existsSync(ordersFile))fs.writeFileSync(ordersFile,"[]");
const send=(res,status,data,type="application/json; charset=utf-8")=>{res.writeHead(status,{"Content-Type":type,"Cache-Control":"no-store"});res.end(type.startsWith("application/json")?JSON.stringify(data):data)};
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,"http://localhost");
 if(req.method==="GET"&&url.pathname==="/api/health")return send(res,200,{ok:true,mode:"local-demo",production:false});
 if(req.method==="GET"&&url.pathname==="/api/public-order/menu")return send(res,200,{...menu,demo:true});
 if(req.method==="POST"&&url.pathname==="/api/public-order/orders"){
  let raw="";for await(const chunk of req)raw+=chunk;
  try{
   const input=JSON.parse(raw),orders=JSON.parse(fs.readFileSync(ordersFile,"utf8"));
   if(!input.requestId||!input.customerName||!input.paymentMethod||!Array.isArray(input.items)||!input.items.length)return send(res,400,{error:"Preencha os dados obrigatórios e adicione produtos."});
   const duplicate=orders.find(o=>o.requestId===input.requestId);if(duplicate)return send(res,200,{ok:true,duplicate:true,demo:true,orderId:duplicate.orderId,totalCents:duplicate.totalCents});
   const items=input.items.map(i=>{const p=menu.products.find(p=>p.id===i.productId&&p.available);if(!p)throw Error("Produto indisponível.");const quantity=Number(i.quantity);if(!Number.isInteger(quantity)||quantity<1||quantity>99)throw Error("Quantidade inválida.");return{name:p.name,quantity,unitPriceCents:p.unitPriceCents};});
   const subtotal=items.reduce((sum,i)=>sum+i.quantity*i.unitPriceCents,0),rate=menu.deliveryRates.find(r=>r.neighborhood===input.neighborhood),fee=input.fulfillmentType==="delivery"?(rate?rate.feeCents:0):0;
   const order={requestId:input.requestId,orderId:"demo-"+Date.now(),customerName:input.customerName,paymentMethod:input.paymentMethod,items,totalCents:subtotal+fee,createdAt:new Date().toISOString()};
   orders.unshift(order);fs.writeFileSync(ordersFile,JSON.stringify(orders,null,2));return send(res,201,{ok:true,demo:true,orderId:order.orderId,totalCents:order.totalCents});
  }catch(error){return send(res,400,{error:error.message||"Pedido inválido."});}
 }
 const files={"/pedido":"pedido.html","/":"pedido.html","/pedido.css":"pedido.css","/pedido.js":"pedido.js","/favicon.svg":"favicon.svg"};
 if(req.method==="GET"&&files[url.pathname]){const file=path.join(root,files[url.pathname]);const ext=path.extname(file);const type=ext===".css"?"text/css; charset=utf-8":ext===".js"?"text/javascript; charset=utf-8":ext===".svg"?"image/svg+xml":"text/html; charset=utf-8";return send(res,200,fs.readFileSync(file),type);}
 return send(res,404,{error:"Not found"});
});
server.listen(port,()=>console.log("NS Gourmet local: http://localhost:"+port+"/pedido"));