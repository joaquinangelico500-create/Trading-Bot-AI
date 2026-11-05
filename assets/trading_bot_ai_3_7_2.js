
(()=>{'use strict';
const $=id=>document.getElementById(id),symbols=['BTCUSDT','ETHUSDT','SOLUSDT'],names={BTCUSDT:'BTC/USDT',ETHUSDT:'ETH/USDT',SOLUSDT:'SOL/USDT'},fmt=n=>'$'+Number(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const STORAGE_KEY='tradingBotAI_3_7_1_state';const LEGACY_STORAGE_KEY='tradingBotAI_3_1_state';let persistenceAvailable=true;let closedTrades=[],peakEquity=10000,maxDrawdown=0,lossStreak=0,maxLossStreak=3;let cfg={capital:10000,allocation:10,daily:2,stoploss:3,takeprofit:6,maxpositions:2,fee:0.1},cash=10000,initial=10000,sessionStart=10000,selected='BTCUSDT',running=false,blocked=false,fetchBusy=false,quotes={},positions={},orders=[],logs=[],processed={},lastOk=0,interval=null,lastEntryCandle={},diagnostic='Esperando análisis…';
function persist(){try{localStorage.setItem(STORAGE_KEY,JSON.stringify({version:1,at:new Date().toISOString(),cfg,initial,cash,sessionStart,positions,orders,closedTrades,peakEquity,maxDrawdown,lossStreak,blocked,lastEntryCandle}));persistenceAvailable=true}catch(err){persistenceAvailable=false}const el=$('saveinfo');if(el)el.textContent=persistenceAvailable?'Historial guardado en este navegador · bot no se inicia solo':'No se pudo guardar. Exportá los CSV antes de cerrar'}
function restore(){try{const raw=localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);if(!raw)return false;const d=JSON.parse(raw);if(d.version!==1||!Number.isFinite(d.initial)||d.initial<100||!Number.isFinite(d.cash)||d.cash<0||!Array.isArray(d.orders)||!Array.isArray(d.closedTrades)||typeof d.positions!=='object'||!d.positions)return false;cfg=d.cfg;initial=d.initial;cash=d.cash;sessionStart=Number.isFinite(d.sessionStart)?d.sessionStart:initial;positions=d.positions;orders=d.orders;closedTrades=d.closedTrades;peakEquity=Number.isFinite(d.peakEquity)?d.peakEquity:initial;maxDrawdown=Number.isFinite(d.maxDrawdown)?d.maxDrawdown:0;lossStreak=d.lossStreak||0;blocked=!!d.blocked;lastEntryCandle=d.lastEntryCandle||{};for(const k of Object.keys(cfg)){if($(k))$(k).value=cfg[k]};return true}catch(err){return false}}
function log(msg){logs.unshift(new Date().toLocaleTimeString('es-AR')+' · '+msg);logs=logs.slice(0,70);$('log').textContent=logs.slice(0,25).join('\n')}
function validConfig(){let c={};for(const k of Object.keys(cfg))c[k]=Number($(k).value);let ranges={capital:[100,1000000],allocation:[1,25],daily:[.1,10],stoploss:[.1,15],takeprofit:[.1,30],maxpositions:[1,3],fee:[0,2]};for(const [k,v]of Object.entries(c))if(!Number.isFinite(v)||v<ranges[k][0]||v>ranges[k][1]){alert('Revisá el campo: '+k);return null}if(!Number.isInteger(c.maxpositions)){alert('Las posiciones deben ser un número entero');return null}return c}
function quoteFresh(sym){return quotes[sym]&&Date.now()-quotes[sym].received<90000}function price(sym){return quotes[sym]?.price||null}function equity(){return cash+Object.entries(positions).reduce((total,[sym,p])=>total+(price(sym)||p.lastPrice)*p.qty,0)}
function sma(a,n){if(a.length<n)return null;return a.slice(-n).reduce((x,y)=>x+y,0)/n}
function emaSeries(a,n){if(a.length<n)return [];let alpha=2/(n+1),v=a.slice(0,n).reduce((x,y)=>x+y,0)/n,output=Array(n-1).fill(null).concat([v]);for(let i=n;i<a.length;i++){v=a[i]*alpha+v*(1-alpha);output.push(v)}return output}
function indicators(closes){let rsi=null;if(closes.length>=15){let gains=0,losses=0;for(let i=closes.length-14;i<closes.length;i++){let d=closes[i]-closes[i-1];gains+=Math.max(0,d);losses+=Math.max(0,-d)}rsi=losses===0?(gains===0?50:100):100-100/(1+gains/losses)}let e12=emaSeries(closes,12),e26=emaSeries(closes,26),macdValues=[];for(let i=0;i<closes.length;i++)if(e12[i]!=null&&e26[i]!=null)macdValues.push(e12[i]-e26[i]);let macd=macdValues.length?macdValues.at(-1):null,macdSignal=emaSeries(macdValues,9).at(-1)??null;return{rsi,macd,macdSignal,sma5:sma(closes,5),sma13:sma(closes,13),prev5:sma(closes.slice(0,-1),5),prev13:sma(closes.slice(0,-1),13)}}
function transact(sym,side,reason){const q=price(sym);if(!quoteFresh(sym)||!q)return false;let amount=0;if(side==='COMPRA'){if(positions[sym]||Object.keys(positions).length>=cfg.maxpositions||blocked)return false;const invest=Math.min(cash/(1+cfg.fee/100),equity()*cfg.allocation/100);if(invest<10)return false;const fee=invest*cfg.fee/100;cash-=invest+fee;positions[sym]={entry:q,qty:invest/q,cost:invest+fee,lastPrice:q,openedAt:new Date().toISOString(),buyFee:fee};amount=invest+fee}else{const p=positions[sym];if(!p)return false;const gross=p.qty*q,fee=gross*cfg.fee/100;amount=gross-fee;cash+=amount;const profit=amount-p.cost;closedTrades.push({sym,profit,reason,at:new Date().toISOString(),openedAt:p.openedAt||'',entry:p.entry,exit:q,quantity:p.qty,buyFee:p.buyFee??(p.cost-p.qty*p.entry),sellFee:fee,gross:gross});lossStreak=profit<0?lossStreak+1:0;delete positions[sym];if(lossStreak>=maxLossStreak){running=false;blocked=true;log('Pausa de seguridad: '+maxLossStreak+' operaciones cerradas consecutivas con pérdida. Usá Reiniciar simulación para desbloquear.')} }orders.unshift({time:new Date().toLocaleTimeString('es-AR'),sym,side,amount,reason});orders=orders.slice(0,150);log(side+' '+names[sym]+' · '+reason);persist();return true}
function emergency(why){running=false;blocked=true;for(const s of Object.keys(positions))transact(s,'VENTA',why);log('BLOQUEO · '+why+(Object.keys(positions).length?' · posiciones pendientes por falta de cotización':''));persist();render()}
function riskCheck(){for(const [sym,p]of Object.entries(positions)){if(!quoteFresh(sym))continue;p.lastPrice=price(sym);if(price(sym)<=p.entry*(1-cfg.stoploss/100))transact(sym,'VENTA','Stop loss');else if(price(sym)>=p.entry*(1+cfg.takeprofit/100))transact(sym,'VENTA','Take profit')}if(equity()<=sessionStart*(1-cfg.daily/100)&&Object.keys(positions).every(quoteFresh))emergency('Límite de pérdida de sesión')}
function drawChart(){const c=$('chart'),r=c.getBoundingClientRect(),dpr=window.devicePixelRatio||1,w=Math.max(300,r.width),h=240;c.width=Math.round(w*dpr);c.height=Math.round(h*dpr);let ctx=c.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);let series=quotes[selected]?.closes||[];ctx.strokeStyle='#334862';ctx.lineWidth=1;for(let i=1;i<5;i++){ctx.beginPath();ctx.moveTo(0,i*h/5);ctx.lineTo(w,i*h/5);ctx.stroke()}if(series.length<2){ctx.fillStyle='#a1b6d0';ctx.fillText('Esperando cotizaciones públicas…',20,80);return}let lo=Math.min(...series),hi=Math.max(...series),range=Math.max(hi-lo,1e-12);ctx.strokeStyle='#56e2b0';ctx.lineWidth=2;ctx.beginPath();series.forEach((v,i)=>{let x=i*w/(series.length-1),y=12+(h-25)*(1-(v-lo)/range);i?ctx.lineTo(x,y):ctx.moveTo(x,y)});ctx.stroke()}
function reasonFor(sym){let q=quotes[sym];if(!quoteFresh(sym))return 'Sin cotización reciente';if(positions[sym])return 'Posición abierta · vigilando salida';if(blocked)return 'Motor bloqueado';if(Object.keys(positions).length>=cfg.maxpositions)return 'Cupo máximo de posiciones';let v=q.ind;if(v?.sma5==null||v?.sma13==null||v?.rsi==null||v?.macd==null)return 'Indicadores insuficientes';const strict=$('strategy').value==='strict',cross=v.prev5<=v.prev13&&v.sma5>v.sma13;if(strict){if(!cross)return 'Sin nuevo cruce alcista';if(v.rsi<35||v.rsi>70)return 'RSI fuera de 35–70';if(v.macdSignal==null||v.macd<=v.macdSignal)return 'MACD no confirma';return 'Filtros aptos · espera vela/ciclo'}if(v.sma5<=v.sma13)return 'SMA 5 no supera SMA 13';if(v.rsi<40||v.rsi>65)return 'RSI fuera de 40–65';if(v.macd<=0)return 'MACD no positivo';if(lastEntryCandle[sym]&&q.candle-lastEntryCandle[sym]<300000)return 'Espera 5 min desde entrada';return 'Filtros aptos · espera vela/ciclo'}
function renderDiagnostics(){$('diagrows').innerHTML=symbols.map(sym=>{const v=quotes[sym]?.ind;const status=v?.sma5==null?'—':v.sma5>v.sma13?'Alcista':'Bajista';return '<tr><td>'+names[sym]+'</td><td>'+(v?.rsi==null?'—':v.rsi.toFixed(1))+'</td><td>'+(v?.macd==null?'—':v.macd.toFixed(2))+'</td><td>'+status+'</td><td>'+reasonFor(sym)+'</td></tr>'}).join('')}
function render(){let e=equity(),p=e-initial;peakEquity=Math.max(peakEquity,e);maxDrawdown=Math.max(maxDrawdown,(peakEquity-e)/peakEquity*100);$('closedcount').textContent=closedTrades.length;let positives=closedTrades.filter(t=>t.profit>0).reduce((a,t)=>a+t.profit,0),negatives=-closedTrades.filter(t=>t.profit<0).reduce((a,t)=>a+t.profit,0);$('closedmetrics').textContent='Ganancia media por cierre: '+(closedTrades.length?fmt(closedTrades.reduce((a,t)=>a+t.profit,0)/closedTrades.length):'—')+' · Factor beneficio: '+(negatives>0?(positives/negatives).toFixed(2):closedTrades.length&&positives>0?'∞':'—');$('winrate').textContent=closedTrades.length?(100*closedTrades.filter(t=>t.profit>0).length/closedTrades.length).toFixed(1)+'%':'—';let realized=closedTrades.reduce((a,t)=>a+t.profit,0);$('realized').textContent=(realized>=0?'+':'−')+fmt(Math.abs(realized));$('realized').className=realized>=0?'gain':'loss';$('drawdown').textContent=maxDrawdown.toFixed(2)+'%';$('streak').textContent='Pérdidas consecutivas: '+lossStreak+'/'+maxLossStreak+(blocked?' · MOTOR BLOQUEADO':'');$('equity').textContent=fmt(e);$('cash').textContent=fmt(cash);$('pnl').textContent=(p>=0?'+':'−')+fmt(Math.abs(p))+' ('+(p/initial*100).toFixed(2)+'%)';$('pnl').className='metric '+(p>=0?'gain':'loss');$('count').textContent=orders.length;$('diagnostic').textContent=diagnostic;$('engine').textContent=blocked?'■ BLOQUEADO':running?'● OPERANDO':'⏸ DETENIDO';$('connection').textContent=lastOk&&Date.now()-lastOk<90000?'● PRECIOS RECIBIDOS':'● SIN DATOS VIGENTES';$('connection').style.color=lastOk&&Date.now()-lastOk<90000?'#50e0ad':'#ffdf98';$('start').disabled=running||blocked;$('pause').disabled=!running;$('apply').disabled=running;$('capital').disabled=running;$('markets').innerHTML=symbols.map(s=>'<button data-s="'+s+'" class="'+(s===selected?'active':'')+'">'+names[s]+'</button>').join('');$('pair').textContent=names[selected];$('price').textContent=quoteFresh(selected)?fmt(price(selected)):'Sin precio vigente';let v=quotes[selected]?.ind;$('rsi').textContent=v?.rsi==null?'—':v.rsi.toFixed(1);$('macd').textContent=v?.macd==null?'—':v.macd.toFixed(3);$('signal').textContent=v?.sma5==null?'—':v.sma5>v.sma13?'Alcista':'Bajista';$('positions').innerHTML=Object.entries(positions).map(([s,p])=>{let val=p.qty*(price(s)||p.lastPrice),profit=val*(1-cfg.fee/100)-p.cost;return '<tr><td>'+names[s]+'</td><td>'+p.qty.toFixed(6)+'</td><td>'+fmt(p.entry)+'</td><td>'+fmt(val)+'</td><td class="'+(profit>=0?'gain':'loss')+'">'+fmt(profit)+'</td></tr>'}).join('')||'<tr><td colspan="5">Sin posiciones abiertas</td></tr>';renderDiagnostics();$('orders').innerHTML=orders.slice(0,70).map(o=>'<tr><td>'+o.time+'</td><td>'+names[o.sym]+'</td><td class="'+(o.side==='COMPRA'?'gain':'loss')+'">'+o.side+'</td><td>'+fmt(o.amount)+'</td><td>'+o.reason+'</td></tr>').join('')||'<tr><td colspan="5">Esperando señales</td></tr>';drawChart()}
async function fetchOne(sym){let controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),12000);try{let url='https://data-api.binance.vision/api/v3/klines?symbol='+sym+'&interval=1m&limit=100';let res=await fetch(url,{signal:controller.signal,cache:'no-store'});if(!res.ok)throw Error('HTTP '+res.status);let rows=await res.json();if(!Array.isArray(rows)||rows.length<40)throw Error('Datos insuficientes');let now=Date.now(),finished=rows.filter(r=>Number(r[6])<now),closed=finished.map(r=>Number(r[4]));if(closed.some(v=>!Number.isFinite(v)||v<=0)||closed.length<35)throw Error('Datos inválidos');let lastCandle=Number(finished.at(-1)[0]);if(now-Number(finished.at(-1)[6])>150000)throw Error('Velas desactualizadas');let lastPrice=Number(rows.at(-1)[4]);if(!Number.isFinite(lastPrice)||lastPrice<=0)throw Error('Precio inválido');quotes[sym]={price:lastPrice,closes:closed.slice(-80),received:now,ind:indicators(closed),candle:lastCandle};return true}catch(err){log('Sin datos '+names[sym]+': '+err.message);return false}finally{clearTimeout(timeout)}}
async function refresh(){if(fetchBusy)return;fetchBusy=true;let outcomes=await Promise.all(symbols.map(fetchOne));if(outcomes.some(Boolean))lastOk=Date.now();riskCheck();if(running&&!blocked){for(const sym of symbols){let q=quotes[sym];if(!outcomes[symbols.indexOf(sym)]||!q||processed[sym]===q.candle)continue;processed[sym]=q.candle;let v=q.ind;if(v.prev5==null||v.prev13==null)continue;const mode=$('strategy').value;const crossUp=v.prev5<=v.prev13&&v.sma5>v.sma13;const crossDown=v.prev5>=v.prev13&&v.sma5<v.sma13;const strictBuy=crossUp&&v.rsi>=35&&v.rsi<=70&&v.macd!=null&&v.macdSignal!=null&&v.macd>v.macdSignal;const trendBuy=v.sma5>v.sma13&&v.rsi>=40&&v.rsi<=65&&v.macd!=null&&v.macd>0;const spacing=!lastEntryCandle[sym]||q.candle-lastEntryCandle[sym]>=5*60000;const buySignal=mode==='strict'?strictBuy:trendBuy&&spacing;diagnostic=names[sym]+': '+(positions[sym]?'posición abierta':buySignal?'señal de compra':mode==='strict'?'sin cruce confirmado y filtros coincidentes':'esperando tendencia, RSI 40–65 y MACD positivo')+' · '+new Date().toLocaleTimeString('es-AR');if(positions[sym]&&(crossDown||(mode==='trend'&&v.sma5<v.sma13)))transact(sym,'VENTA','Salida por tendencia SMA');else if(!blocked&&!positions[sym]&&buySignal){if(transact(sym,'COMPRA',mode==='strict'?'Cruce + RSI + MACD':'Tendencia SMA + RSI + MACD'))lastEntryCandle[sym]=q.candle;}}riskCheck()}$('lastupdate').textContent='Última consulta: '+new Date().toLocaleTimeString('es-AR')+' · '+outcomes.filter(Boolean).length+'/'+symbols.length+' mercados con datos';fetchBusy=false;render()}
$('export').onclick=()=>{const columns=['Fecha local','Activo','Acción','Importe USD','Motivo'];const lines=[columns,...orders.slice().reverse().map(o=>[o.time,names[o.sym],o.side,o.amount.toFixed(2),o.reason])];const csv='\ufeff'+lines.map(r=>r.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(';')).join('\r\n');const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});let url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='trading_bot_ai_3_historial.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};
$('exporttrades').onclick=()=>{const header=['Fecha entrada UTC','Fecha salida UTC','Mercado','Cantidad','Precio entrada USD','Precio salida USD','Comision compra USD','Comision venta USD','Resultado neto USD','Motivo'];const lines=[header,...closedTrades.map(t=>[t.openedAt||'',t.at,names[t.sym],t.quantity??'',t.entry??'',t.exit??'',t.buyFee??'',t.sellFee??'',t.profit.toFixed(4),t.reason])];const csv='\ufeff'+lines.map(r=>r.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(';')).join('\r\n');const blob=new Blob([csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='trading_bot_ai_3_1_cierres.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};
$('testbuy').onclick=()=>{const sym=$('testsymbol').value;if(blocked){$('testresult').textContent='No se puede operar: bloqueo de seguridad. Reiniciá la simulación.';return}if(!quoteFresh(sym)){$('testresult').textContent='No hay cotización vigente para la prueba. Usá Actualizar precios.';return}if(positions[sym]){$('testresult').textContent='Ya existe una posición abierta en ese mercado.';return}const ok=transact(sym,'COMPRA','PRUEBA CONTROLADA · compra ficticia');$('testresult').textContent=ok?'Compra ficticia registrada en '+names[sym]+'. Podés probar su cierre.':'Compra rechazada por efectivo insuficiente o límite de posiciones.';riskCheck();render()};
$('testsell').onclick=()=>{const sym=$('testsymbol').value;if(!positions[sym]){$('testresult').textContent='No existe una posición abierta en '+names[sym]+'.';return}if(!quoteFresh(sym)){$('testresult').textContent='No hay precio reciente. No se puede cerrar una posición con datos desactualizados.';return}const ok=transact(sym,'VENTA','PRUEBA CONTROLADA · cierre ficticio');$('testresult').textContent=ok?'Cierre ficticio registrado en '+names[sym]+'.':'No se pudo cerrar la posición.';riskCheck();render()};
$('strategy').onchange=()=>{diagnostic='Estrategia cambiada. Esperando la próxima vela cerrada';render()};$('markets').addEventListener('click',ev=>{let b=ev.target.closest('[data-s]');if(b){selected=b.dataset.s;render()}});$('start').onclick=()=>{if(blocked)return;if(!symbols.some(quoteFresh)){alert('Todavía no hay precios vigentes. Esperá la conexión.');return}running=true;for(const s of symbols)processed[s]=quotes[s]?.candle;diagnostic='Bot iniciado. Esperando el cierre de una nueva vela de 1 minuto…';log('Bot iniciado · espera nueva vela cerrada y señal');persist();render()};$('pause').onclick=()=>{running=false;log('Bot pausado · stops siguen activos');persist();render()};$('stop').onclick=()=>emergency('Detención manual');$('refresh').onclick=refresh;$('apply').onclick=()=>{let c=validConfig();if(!c)return;if(c.capital!==initial){alert('Para cambiar capital usá Reiniciar simulación');$('capital').value=initial;return}cfg=c;sessionStart=equity();log('Límites aplicados; referencia de sesión actualizada');persist();render()};$('reset').onclick=()=>{if(!confirm('¿Reiniciar? Se borrarán todas las operaciones ficticias.'))return;let c=validConfig();if(!c)return;cfg=c;initial=c.capital;cash=initial;sessionStart=initial;positions={};orders=[];closedTrades=[];lossStreak=0;peakEquity=initial;maxDrawdown=0;processed={};lastEntryCandle={};diagnostic='Simulación reiniciada';running=false;blocked=false;log('Simulación reiniciada');persist();render()};window.addEventListener('resize',drawChart);const restored=restore();log(restored?'Sesión anterior recuperada · bot detenido por seguridad':'Versión 3.1 iniciada · conectando precios públicos');render();persist();refresh();setInterval(refresh,30000);setInterval(()=>{riskCheck();render();persist()},10000);
// Backtesting dentro del mismo alcance del motor principal.
let btTrades=[];
function backtestEngine(rows,settings){
 const cap=settings.capital, feeRate=settings.fee/100,slip=settings.slip/100;
 let cash=cap,position=null,peak=cap,maxDD=0,totalCosts=0,losses=0,halt=false,haltReason='',trades=[];
 const n=rows.length;
 function eq(mark){return cash+(position?position.qty*mark*(1-feeRate):0)}
 function updateDD(mark){const e=eq(mark);peak=Math.max(peak,e);maxDD=Math.max(maxDD,100*(peak-e)/peak);if(e<=cap*(1-settings.daily/100)){halt=true;if(!haltReason)haltReason='Límite de pérdida '+settings.daily+'%';}}
 function enter(open,index){if(halt||position)return;const entry=open*(1+slip),invest=Math.min(cash/(1+feeRate),eq(open)*settings.allocation/100);if(invest<10)return;const f=invest*feeRate;cash-=invest+f;totalCosts+=f+(invest/entry)*(entry-open);position={qty:invest/entry,entry,rawEntry:open,feeIn:f,cost:invest+f,index,opened:rows[index][0]};}
 function exit(raw,index,reason){if(!position)return;const p=position,price=raw*(1-slip),gross=p.qty*price,f=gross*feeRate,net=gross-f,profit=net-p.cost;cash+=net;totalCosts+=f+p.qty*raw*slip;const grossPnL=p.qty*(raw-p.rawEntry),fees=p.feeIn+f,slippageCost=p.qty*((p.entry-p.rawEntry)+(raw-price));
  trades.push({time:new Date(rows[index][0]).toISOString(),opened:new Date(p.opened).toISOString(),entry:p.entry,exit:price,profit,reason,grossPnL,fees,slippageCost});
  losses=profit<0?losses+1:0;if(losses>=3){halt=true;if(!haltReason)haltReason='3 pérdidas consecutivas';}position=null;}
 let lastEntry=-100;
 for(let i=45;i<n;i++){
   const row=rows[i],open=row[1],high=row[2],low=row[3],close=row[4];
   const hist=rows.slice(0,i).map(x=>x[4]),v=indicators(hist);
   // Only candles strictly before i are used to form a signal. Execute at i open.
   const trend=v.sma5>v.sma13&&v.rsi>=40&&v.rsi<=65&&v.macd>0;
   const crossUp=v.prev5<=v.prev13&&v.sma5>v.sma13;
   const strict=crossUp&&v.rsi>=35&&v.rsi<=70&&v.macd!=null&&v.macdSignal!=null&&v.macd>v.macdSignal;
   const crossDown=v.prev5>=v.prev13&&v.sma5<v.sma13;
   if(position&&(crossDown||(settings.mode==='trend'&&v.sma5<v.sma13)))exit(open,i,'Salida SMA');
   if(!position&&!halt&&((settings.mode==='trend'&&trend&&i-lastEntry>=5)||(settings.mode==='strict'&&strict))){enter(open,i);if(position)lastEntry=i;}
   if(position){const stop=position.entry*(1-settings.stoploss/100),take=position.entry*(1+settings.takeprofit/100);
     // If open gaps across either threshold, fill at actual worse open for stop, open for profit.
     if(open<=stop)exit(open,i,'Stop con gap');
     else if(open>=take)exit(open,i,'Take con gap');
     else if(low<=stop)exit(stop,i,'Stop loss');
     else if(high>=take)exit(take,i,'Take profit');
   }
   updateDD(close);
   if(halt&&position)exit(close,i,'Bloqueo por riesgo');
 }
 if(position)exit(rows[n-1][4],n-1,'Fin del backtest');
 updateDD(rows[n-1][4]);
 const wins=trades.filter(t=>t.profit>0),gain=wins.reduce((a,t)=>a+t.profit,0),lost=-trades.filter(t=>t.profit<0).reduce((a,t)=>a+t.profit,0);
 return {trades,cash,maxDD,totalCosts,halt,haltReason,pf:lost>0?gain/lost:gain>0?Infinity:null,winrate:trades.length?100*wins.length/trades.length:null,avg:trades.length?trades.reduce((a,t)=>a+t.profit,0)/trades.length:null,roi:100*(cash/cap-1)};
}
$('runtest').onclick=async()=>{
 const btn=$('runtest');if(btn.disabled)return;
 const slip=Number($('btslip').value);if(!Number.isFinite(slip)||slip<0||slip>1){alert('El deslizamiento debe estar entre 0 y 1%.');return}
 const c=validConfig();if(!c)return;
 btn.disabled=true;$('exportbt').disabled=true;$('btstatus').textContent='Descargando velas cerradas y calculando resultados…';
 try{
  const sym=$('btsymbol').value,url='https://data-api.binance.vision/api/v3/klines?symbol='+sym+'&interval=1m&limit=1000';
  const controller=new AbortController(),tid=setTimeout(()=>controller.abort(),20000);let res;
  try{res=await fetch(url,{signal:controller.signal,cache:'no-store'});}finally{clearTimeout(tid)}
  if(!res.ok)throw Error('Error del proveedor: '+res.status);
  const raw=await res.json(),now=Date.now();
  const candles=raw.filter(r=>Number(r[6])<now).map(r=>[Number(r[0]),Number(r[1]),Number(r[2]),Number(r[3]),Number(r[4])]);
  if(candles.length<100||candles.some(c=>c.some(x=>!Number.isFinite(x)||x<=0)))throw Error('No hay suficientes velas válidas');
  if(now-candles.at(-1)[0]>180000)throw Error('Velas demasiado antiguas');
  const bt=backtestEngine(candles,{...c,slip,mode:$('btstrategy').value});btTrades=bt.trades;
  const set=(id,v)=>$(id).textContent=v;
  set('btreturn',bt.roi.toFixed(2)+'%');set('btcount',bt.trades.length);set('btwins',bt.winrate==null?'—':bt.winrate.toFixed(1)+'%');set('btdd',bt.maxDD.toFixed(2)+'%');set('btpf',bt.pf==null?'—':Number.isFinite(bt.pf)?bt.pf.toFixed(2):'∞');set('btavg',bt.avg==null?'—':fmt(bt.avg));set('btfinal',fmt(bt.cash));set('btcost',fmt(bt.totalCosts));
  $('btstatus').textContent='Datos: '+new Date(candles[0][0]).toLocaleString('es-AR')+' hasta '+new Date(candles.at(-1)[0]).toLocaleString('es-AR')+' · '+candles.length+' velas · '+(bt.halt?'Bloqueo: '+bt.haltReason:'Sin bloqueo de riesgo')+'.';
  $('btrows').innerHTML=bt.trades.slice(-50).reverse().map(t=>'<tr><td>'+t.time.replace('T',' ').slice(0,16)+'</td><td>'+fmt(t.entry)+'</td><td>'+fmt(t.exit)+'</td><td class="'+(t.profit>=0?'gain':'loss')+'">'+fmt(t.profit)+'</td><td>'+t.reason+'</td></tr>').join('')||'<tr><td colspan="5">No hubo cierres con estas condiciones en el período.</td></tr>';
  $('exportbt').disabled=!btTrades.length; if(document.getElementById('btcostdiag372')){const gross=bt.trades.reduce((a,t)=>a+t.grossPnL,0),fees=bt.trades.reduce((a,t)=>a+t.fees,0),slipCosts=bt.trades.reduce((a,t)=>a+t.slippageCost,0);$('btcostdiag372').textContent='Resultado antes de costos (aprox.): '+fmt(gross)+' · Comisiones: '+fmt(fees)+' · Deslizamiento (aprox.): '+fmt(slipCosts)+' · Resultado neto: '+fmt(bt.cash-c.capital)+' · '+(bt.halt?'Motivo del bloqueo: '+bt.haltReason:'Sin bloqueo');}
 }catch(err){$('btstatus').textContent='No se pudo ejecutar el backtest: '+err.message+'. Revisá tu conexión o volvé a intentar.';}finally{btn.disabled=false}
};
$('exportbt').onclick=()=>{const data=[['Entrada UTC','Salida UTC','Precio entrada','Precio salida','Ganancia bruta aprox USD','Comisiones USD','Slippage aprox USD','Ganancia neta USD','Motivo'],...btTrades.map(t=>[t.opened,t.time,t.entry,t.exit,t.grossPnL.toFixed(4),t.fees.toFixed(4),t.slippageCost.toFixed(4),t.profit.toFixed(4),t.reason])];const csv='\ufeff'+data.map(row=>row.map(x=>'"'+String(x).replaceAll('"','""')+'"').join(';')).join('\r\n');const a=document.createElement('a'),url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));a.href=url;a.download='trading_bot_ai_3_2_backtest.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};


// Comparador 3.3: completamente independiente del motor de paper trading.
let comparisonResults=[];
async function fetchCompareCandles(sym,interval){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
 try{
  const endpoint='https://data-api.binance.vision/api/v3/klines?symbol='+encodeURIComponent(sym)+'&interval='+encodeURIComponent(interval)+'&limit=1000';
  const response=await fetch(endpoint,{signal:controller.signal,cache:'no-store'});
  if(!response.ok)throw new Error('HTTP '+response.status);
  const raw=await response.json(),now=Date.now();
  if(!Array.isArray(raw))throw new Error('Respuesta inválida');
  const rows=raw.filter(r=>Number(r[6])<now).map(r=>[Number(r[0]),Number(r[1]),Number(r[2]),Number(r[3]),Number(r[4])]);
  if(rows.length<160||rows.some(r=>r.some(v=>!Number.isFinite(v)||v<=0)))throw new Error('Velas insuficientes o inválidas');
  const minutes=Number(interval.replace('m',''));
  const ageMs=now-Number(raw.filter(r=>Number(r[6])<now).at(-1)?.[6]);
  // Evaluate the closing timestamp, not the opening timestamp of the last completed candle.
  // Accept up to one additional interval plus 3 minutes for publication delays;
  // older data are rejected with a useful explanation instead of being used silently.
  const maxDelay=(minutes+3)*60000;
  if(!Number.isFinite(ageMs)||ageMs>maxDelay)throw new Error('Velas desactualizadas: última vela cerró hace '+(ageMs/60000).toFixed(1)+' min (máximo '+(maxDelay/60000).toFixed(0)+' min). Reintentá o verificá el proveedor');
  return rows;
 }finally{clearTimeout(timer)}
}
function formatPct(value){return value==null?'—':value.toFixed(2)+'%'}
function renderCompare(){
 const list=comparisonResults.slice().sort((a,b)=> (b.training?.roi??-Infinity)-(a.training?.roi??-Infinity));
 $('comprows').innerHTML=list.map(r=>{
  const t=r.training,e=r.evaluation;
  return '<tr><td>'+names[r.sym]+'</td><td>'+r.interval+'</td><td>'+(r.mode==='trend'?'Equilibrada':'Estricta')+'</td><td class="'+(t&&t.roi>=0?'gain':'loss')+'">'+(t?formatPct(t.roi):'—')+'</td><td class="'+(e&&e.roi>=0?'gain':'loss')+'">'+(e?formatPct(e.roi):'—')+'</td><td>'+(e?e.trades.length:'—')+'</td><td>'+(e?formatPct(e.winrate):'—')+'</td><td>'+(e?formatPct(e.maxDD):'—')+'</td><td>'+(r.error||((e&&e.trades.length===0)?'Sin cierres de prueba':'Evaluado'))+'</td></tr>';
 }).join('')||'<tr><td colspan="9">No se recibieron datos válidos.</td></tr>';
 $('exportcompare').disabled=!comparisonResults.length;
}
$('runcompare').onclick=async()=>{
 const button=$('runcompare');if(button.disabled)return;
 const slip=Number($('compslip').value),fee=Number($('compfee').value);
 if(!Number.isFinite(slip)||slip<0||slip>1||!Number.isFinite(fee)||fee<0||fee>2){alert('Revisá las comisiones y el deslizamiento.');return}
 button.disabled=true;comparisonResults=[];renderCompare();
 const configs=[['BTCUSDT','1m'],['ETHUSDT','1m'],['SOLUSDT','1m'],['BTCUSDT','5m'],['ETHUSDT','5m'],['SOLUSDT','5m'],['BTCUSDT','15m'],['ETHUSDT','15m'],['SOLUSDT','15m']];
 const settings={capital:10000,allocation:10,daily:2,stoploss:3,takeprofit:6,fee,slip};
 try{
  for(let i=0;i<configs.length;i++){
   const [sym,interval]=configs[i];$('compstatus').textContent='Consultando '+names[sym]+' · '+interval+' ('+(i+1)+'/9)…';
   try{
    const rows=await fetchCompareCandles(sym,interval),cut=Math.floor(rows.length*.6);
    for(const mode of ['trend','strict']){
     const training=backtestEngine(rows.slice(0,cut),{...settings,mode});
     const evaluation=backtestEngine(rows.slice(cut-45),{...settings,mode});
     comparisonResults.push({sym,interval,mode,training,evaluation,trainN:cut,testN:rows.length-cut,errors:''});
    }
   }catch(err){for(const mode of ['trend','strict'])comparisonResults.push({sym,interval,mode,training:null,evaluation:null,error:err.message})}
   renderCompare();
  }
  const tested=comparisonResults.filter(r=>r.evaluation),traded=tested.filter(r=>r.evaluation.trades.length);
  $('compstatus').textContent='Finalizado: '+tested.length+'/18 configuraciones evaluadas; '+traded.length+' con cierres fuera de muestra. Tabla ordenada SOLO por rentabilidad del tramo de entrenamiento. No es una recomendación para operar.';
 }catch(err){$('compstatus').textContent='Error en la comparación: '+err.message}finally{button.disabled=false}
};
$('exportcompare').onclick=()=>{
 const header=['Mercado','Temporalidad','Estrategia','Entrenamiento ROI %','Evaluación ROI %','Cierres prueba','Aciertos prueba %','Drawdown prueba %','Error'];
 const rows=[header,...comparisonResults.map(r=>[names[r.sym],r.interval,r.mode==='trend'?'Equilibrada':'Estricta',r.training?.roi.toFixed(4)??'',r.evaluation?.roi.toFixed(4)??'',r.evaluation?.trades.length??'',r.evaluation?.winrate?.toFixed(2)??'',r.evaluation?.maxDD.toFixed(4)??'',r.error||''])];
 const csv='\ufeff'+rows.map(row=>row.map(x=>'"'+String(x).replaceAll('"','""')+'"').join(';')).join('\r\n');
 const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='trading_bot_ai_3_3_comparador.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
};


// Estudios largos: no alteran ni reutilizan el capital del paper trading.
let longResults=[];
async function fetchLongCandles(symbol,days){
  const intervalMs=3600000, now=Date.now(), endWindow=Math.floor(now/intervalMs)*intervalMs-1;
  const startWindow=endWindow-days*86400000+1;
  let end=endWindow, all=[];
  for(let page=0;page<Math.ceil(days*24/1000)+1 && end>=startWindow;page++){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),18000);
    try{
      const u='https://data-api.binance.vision/api/v3/klines?symbol='+symbol+'&interval=1h&limit=1000&endTime='+end;
      const resp=await fetch(u,{signal:controller.signal,cache:'no-store'});
      if(!resp.ok)throw new Error('Binance HTTP '+resp.status);
      const data=await resp.json();
      if(!Array.isArray(data)||!data.length)throw new Error('No se recibieron velas');
      const valid=data.map(r=>[+r[0],+r[1],+r[2],+r[3],+r[4]]).filter(r=>r.every(x=>Number.isFinite(x)&&x>0)&&r[0]>=startWindow&&r[0]<endWindow);
      all.push(...valid);
      const earliest=Number(data[0][0]);if(!Number.isFinite(earliest))throw new Error('Fecha inválida');
      if(earliest>=end)throw new Error('Paginación detenida');
      end=earliest-1;
    }finally{clearTimeout(timer)}
  }
  const unique=new Map(all.map(r=>[r[0],r]));const candles=[...unique.values()].sort((a,b)=>a[0]-b[0]);
  if(candles.length<days*24*.9)throw new Error('Historial incompleto: '+candles.length+' velas para '+days+' días');
  for(let i=1;i<candles.length;i++)if(candles[i][0]-candles[i-1][0]!==intervalMs)throw new Error('Huecos en el historial');
  return candles;
}
function longROIColor(v){return v>=0?'gain':'loss'}
function renderLong(){
  const valid=longResults.filter(x=>!x.error);
  valid.sort((a,b)=>b.train.roi-a.train.roi);
  $('longrows').innerHTML=longResults.map(x=>{
    if(x.error)return '<tr><td>'+names[x.sym]+'</td><td>'+x.label+'</td><td colspan="6">No disponible: '+x.error.replaceAll('<','&lt;')+'</td></tr>';
    return '<tr><td>'+names[x.sym]+'</td><td>'+x.label+'</td><td class="'+longROIColor(x.train.roi)+'">'+x.train.roi.toFixed(2)+'%</td><td class="'+longROIColor(x.test.roi)+'">'+x.test.roi.toFixed(2)+'%</td><td class="'+longROIColor(x.hold)+'">'+x.hold.toFixed(2)+'%</td><td>'+x.test.trades.length+'</td><td>'+x.test.maxDD.toFixed(2)+'%</td><td>'+(x.eligible?'Cumple filtros preliminares':'No apta')+'</td></tr>';
  }).join('');
}
$('runlong').onclick=async()=>{
  const button=$('runlong');if(button.disabled)return;
  const days=Number($('longdays').value),fee=Number($('longfee').value),slip=Number($('longslip').value);
  if(![30,60,90].includes(days)||!Number.isFinite(fee)||fee<0||fee>2||!Number.isFinite(slip)||slip<0||slip>1){alert('Revisá los parámetros');return}
  button.disabled=true;$('exportlong').disabled=true;longResults=[];
  const params={capital:10000,allocation:10,daily:2,stoploss:3,takeprofit:6,fee,slip};
  for(const sym of symbols){
    $('longstatus').textContent='Descargando '+names[sym]+' · '+days+' días. Esperá…';
    try{
      const candles=await fetchLongCandles(sym,days),cut=Math.floor(candles.length*.6);
      // Benchmark usa el tramo de evaluación, con los mismos costos de compra y venta.
      const first=candles[cut][1],last=candles.at(-1)[4];
      const buyPrice=first*(1+slip/100),sellPrice=last*(1-slip/100);
      const hold=100*((sellPrice*(1-fee/100))/(buyPrice*(1+fee/100))-1);
      for(const [mode,label] of [['trend','Equilibrada'],['strict','Estricta']]){
        const train=backtestEngine(candles.slice(0,cut),{...params,mode});
        const test=backtestEngine(candles.slice(cut-45),{...params,mode});
        const eligible=train.roi>0&&test.roi>0&&test.trades.length>=5&&test.pf!=null&&test.pf>1&&test.maxDD<=2;
        longResults.push({sym,mode,label,days,train,test,hold,eligible,error:''});
      }
    }catch(err){for(const [mode,label] of [['trend','Equilibrada'],['strict','Estricta']])longResults.push({sym,mode,label,days,error:err.message})}
    renderLong();
  }
  const successful=longResults.filter(r=>!r.error),eligible=successful.filter(r=>r.eligible);
  $('longstatus').textContent='Completado: '+successful.length+'/6 configuraciones evaluadas. '+(eligible.length?eligible.length+' cumplen filtros preliminares; no se activaron operaciones.':'Ninguna estrategia cumple todos los filtros preliminares.')+' Período: '+days+' días; velas de 1 hora.';
  $('exportlong').disabled=!longResults.length;button.disabled=false;
};
$('exportlong').onclick=()=>{
  if(!longResults.length)return;
  const rows=[['Mercado','Días','Estrategia','Entrenamiento %','Evaluación %','Comprar mantener %','Cierres evaluación','Aciertos evaluación %','Drawdown evaluación %','Factor beneficio evaluación','Cumple filtros','Error'],...longResults.map(x=>[names[x.sym],x.days,x.label,x.train?.roi.toFixed(4)??'',x.test?.roi.toFixed(4)??'',x.hold?.toFixed(4)??'',x.test?.trades.length??'',x.test?.winrate?.toFixed(2)??'',x.test?.maxDD.toFixed(4)??'',x.test?.pf?.toFixed(3)??'',x.eligible?'Sí':'No',x.error||''])];
  const csv='\ufeff'+rows.map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(';')).join('\r\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='trading_bot_ai_3_4_estudio.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};


// 3.5 · Verificación temporal con parámetros fijos; solo lectura, sin órdenes.
let wfResults=[],wfCosts=[];
function wfMoney(n){return (n<0?'−':'')+fmt(Math.abs(n))}
function wfColor(n){return n>=0?'gain':'loss'}
function wfCSV(rows,name){const csv='\ufeff'+rows.map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(';')).join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
$('runwf').onclick=async()=>{
 const btn=$('runwf');if(btn.disabled)return;
 const fee=Number($('wffee').value),slip=Number($('wfslip').value);
 if(!Number.isFinite(fee)||fee<0||fee>2||!Number.isFinite(slip)||slip<0||slip>1){$('wfstatus').textContent='Revisá comisión (0 a 2%) y deslizamiento (0 a 1%).';return}
 btn.disabled=true;$('exportwf').disabled=true;wfResults=[];wfCosts=[];
 $('wfstatus').textContent='Descargando 90 días de velas de ETH/USDT. Esperá…';
 try{
  const candles=await fetchLongCandles('ETHUSDT',90);
  const hoursPerDay=24,trainHours=30*hoursPerDay,testHours=15*hoursPerDay;
  // Usamos las 2160 velas finales para mantener cuatro ventanas cronológicas comparables.
  const data=candles.slice(-90*hoursPerDay);
  if(data.length!==90*hoursPerDay)throw new Error('No se obtuvieron 90 días completos');
  const model={capital:10000,allocation:10,daily:2,stoploss:3,takeprofit:6,mode:'strict'};
  const scenarios=[{name:'Base',factor:1},{name:'Doble costo',factor:2},{name:'Triple costo',factor:3}];
  for(const scen of scenarios){
   const effectiveFee=fee*scen.factor,effectiveSlip=slip*scen.factor;
   if(effectiveFee>2||effectiveSlip>1){wfCosts.push({name:scen.name,error:'Costo fuera del rango permitido'});continue}
   let rows=[],sum=0,totalTrades=0,positives=0;
   for(let fold=0;fold<4;fold++){
    const begin=fold*testHours,trainEnd=begin+trainHours,testEnd=trainEnd+testHours;
    const train=data.slice(begin,trainEnd);
    // Precalentamos 45 velas previas. backtestEngine comienza en índice 45 y opera solo en evaluación.
    const test=data.slice(trainEnd-45,testEnd);
    if(train.length!==trainHours||test.length!==testHours+45)throw new Error('Ventana incompleta');
    const settings={...model,fee:effectiveFee,slip:effectiveSlip};
    const t=backtestEngine(train,settings),e=backtestEngine(test,settings);
    const profit=e.cash-model.capital;
    sum+=profit;totalTrades+=e.trades.length;if(profit>0)positives++;
    rows.push({fold:fold+1,start:new Date(data[trainEnd][0]).toISOString(),end:new Date(data[testEnd-1][0]).toISOString(),training:t,evaluation:e,profit});
   }
   wfCosts.push({name:scen.name,fee:effectiveFee,slip:effectiveSlip,rows,sum,totalTrades,positives});
   if(scen.factor===1)wfResults=rows;
  }
  const base=wfCosts[0];if(!base.rows)throw new Error(base.error||'No se pudo calcular el escenario base');
  $('wfpositive').textContent=base.positives+'/4';
  $('wftrades').textContent=base.totalTrades;
  $('wfprofit').textContent=wfMoney(base.sum);$('wfprofit').className=wfColor(base.sum);
  const stressed=wfCosts.find(x=>x.name==='Doble costo');
  const sufficient=base.totalTrades>=20&&base.positives>=3&&base.sum>0&&!!stressed?.rows&&stressed.sum>0;
  $('wfverdict').textContent=sufficient?'Prometedora para seguir estudiando':'Evidencia insuficiente';
  $('wfrows').innerHTML=wfResults.map(x=>'<tr><td>'+x.fold+' · '+x.start.slice(0,10)+' a '+x.end.slice(0,10)+'</td><td class="'+wfColor(x.training.roi)+'">'+formatPct(x.training.roi)+'</td><td class="'+wfColor(x.evaluation.roi)+'">'+formatPct(x.evaluation.roi)+'</td><td>'+x.evaluation.trades.length+'</td><td>'+formatPct(x.evaluation.winrate)+'</td><td>'+formatPct(x.evaluation.maxDD)+'</td><td>'+(x.evaluation.pf==null?'—':Number.isFinite(x.evaluation.pf)?x.evaluation.pf.toFixed(2):'∞')+'</td></tr>').join('');
  $('wfcostrows').innerHTML=wfCosts.map(x=>x.error?'<tr><td>'+x.name+'</td><td colspan="5">'+x.error+'</td></tr>':'<tr><td>'+x.name+'</td><td>'+x.fee.toFixed(2)+'%</td><td>'+x.slip.toFixed(2)+'%</td><td>'+x.totalTrades+'</td><td class="'+wfColor(x.sum)+'">'+wfMoney(x.sum)+'</td><td>'+x.positives+'/4</td></tr>').join('');
  $('wfstatus').textContent='Completado: 4 ventanas de prueba sobre 90 días (ETH/USDT, 1 hora). Son resultados retrospectivos, NO un permiso para operar. Los costos y la escasez de cierres influyen en la evaluación.';
  $('exportwf').disabled=false;
 }catch(err){$('wfstatus').textContent='No se pudo completar la validación: '+err.message;}
 finally{btn.disabled=false}
};
$('exportwf').onclick=()=>{
 if(!wfCosts.length)return;
 const data=[['Escenario','Comision lado %','Slippage lado %','Ventana','Inicio prueba UTC','Fin prueba UTC','ROI entrenamiento %','ROI prueba %','Cierres prueba','Drawdown prueba %','Factor beneficio prueba','Ganancia USD']];
 for(const x of wfCosts)if(x.rows)for(const r of x.rows)data.push([x.name,x.fee,x.slip,r.fold,r.start,r.end,r.training.roi.toFixed(5),r.evaluation.roi.toFixed(5),r.evaluation.trades.length,r.evaluation.maxDD.toFixed(5),r.evaluation.pf??'',r.profit.toFixed(4)]);
 wfCSV(data,'trading_bot_ai_3_5_walk_forward.csv');
};


// 3.6: diagnóstico independiente; NO cambia posiciones ni estrategia del bot vivo.
let a36Details=[];
function a36Regime(candles,index){
 const arr=candles.slice(Math.max(0,index-72),index).map(r=>r[4]);
 if(arr.length<72)return 'Sin datos';
 const short=sma(arr,24),long=sma(arr,72),difference=(short/long-1)*100;
 return difference>0.4?'Alcista':difference< -0.4?'Bajista':'Lateral';
}
function a36ReplayTrade(t,fee,slip){
 // Recover unadjusted reference prices from the original 3.5 backtest (0 fees/slip here).
 // Constant notional: $1000 before purchase fee; sell same units at end.
 const amount=1000,entry=t.entry*(1+slip/100),exit=t.exit*(1-slip/100),qty=amount/entry;
 return qty*exit*(1-fee/100)-amount*(1+fee/100);
}
function a36Format(v){return (v<0?'−':'')+fmt(Math.abs(v))}
function a36HtmlCell(v){return '<td class="'+(v>=0?'gain':'loss')+'">'+a36Format(v)+'</td>'}
$('a36run').onclick=async()=>{
 const btn=$('a36run');if(btn.disabled)return;
 btn.disabled=true;$('a36export').disabled=true;$('a36status').textContent='Descargando velas históricas y analizando operaciones...';
 try{
  const sym=$('a36symbol').value,days=Number($('a36days').value);
  const candles=await fetchLongCandles(sym,days);
  // Simulate reference signals with zero friction. Results below replay EXACTLY these trades.
  const model=backtestEngine(candles,{capital:10000,allocation:10,daily:2,stoploss:3,takeprofit:6,fee:0,slip:0,mode:'strict'});
  const indexByTime=new Map(candles.map((r,i)=>[new Date(r[0]).toISOString(),i]));
  a36Details=model.trades.map(t=>{
   const idx=indexByTime.get(t.opened);return {...t,sym,regime:idx==null?'Sin datos':a36Regime(candles,idx),gross:a36ReplayTrade(t,0,0),net:a36ReplayTrade(t,0.1,0.05)};
  });
  let scenarios=[['Sin costos',0,0],['Base',0.1,0.05],['Doble',0.2,0.10],['Triple',0.3,0.15]];
  $('a36costrows').innerHTML=scenarios.map(([name,fee,slip])=>{
   let results=a36Details.map(t=>a36ReplayTrade(t,fee,slip)),sum=results.reduce((a,b)=>a+b,0);
   return '<tr><td>'+name+'</td><td>'+fee.toFixed(2)+'%</td><td>'+slip.toFixed(2)+'%</td>'+a36HtmlCell(sum)+'<td>'+results.filter(x=>x>0).length+'/'+results.length+'</td></tr>';
  }).join('');
  const gross=a36Details.reduce((a,t)=>a+t.gross,0),net=a36Details.reduce((a,t)=>a+t.net,0);
  $('a36count').textContent=a36Details.length;$('a36gross').textContent=a36Format(gross);$('a36net').textContent=a36Format(net);$('a36win').textContent=a36Details.length?(100*a36Details.filter(t=>t.net>0).length/a36Details.length).toFixed(1)+'%':'—';
  $('a36regimerows').innerHTML=['Alcista','Lateral','Bajista','Sin datos'].map(regime=>{
   const items=a36Details.filter(t=>t.regime===regime);const net=items.reduce((a,t)=>a+t.net,0);
   return '<tr><td>'+regime+'</td><td>'+items.length+'</td>'+a36HtmlCell(net)+'<td>'+(items.length?(100*items.filter(t=>t.net>0).length/items.length).toFixed(1)+'%':'—')+'</td></tr>';
  }).join('');
  $('a36trades').innerHTML=a36Details.slice(-50).reverse().map(t=>'<tr><td>'+t.time.slice(0,16).replace('T',' ')+'</td><td>'+names[t.sym]+'</td><td>'+t.regime+'</td><td>'+t.reason+'</td>'+a36HtmlCell(t.gross)+a36HtmlCell(t.net)+'</tr>').join('')||'<tr><td colspan="6">Sin operaciones. No se puede evaluar una ventaja.</td></tr>';
  $('a36status').textContent='Completado: '+days+' días, '+candles.length+' velas de 1 h y '+a36Details.length+' cierres. Se compara el MISMO conjunto de operaciones entre costos. La simulación original puede bloquear tras pérdidas consecutivas; no demuestra rentabilidad futura.';
  $('a36export').disabled=!a36Details.length;
 }catch(err){$('a36status').textContent='No se pudo completar el análisis: '+err.message}
 finally{btn.disabled=false}
};
$('a36export').onclick=()=>{
 const header=['Mercado','Fecha entrada UTC','Fecha salida UTC','Régimen','Motivo','Precio entrada referencia','Precio salida referencia','Ganancia bruta USD nominal 1000','Neto USD base','Neto USD doble','Neto USD triple'];
 wfCSV([header,...a36Details.map(t=>[names[t.sym],t.opened,t.time,t.regime,t.reason,t.entry,t.exit,t.gross.toFixed(4),t.net.toFixed(4),a36ReplayTrade(t,0.2,0.10).toFixed(4),a36ReplayTrade(t,0.3,0.15).toFixed(4)])],'trading_bot_ai_3_6_analisis.csv');
};

})();

/* 3.7 - Módulo aislado de CEDEARs. No toca el estado del motor ni ejecuta órdenes. */
(()=>{'use strict';
 const ids=['NVDA','AAPL','MSFT'], observations=Object.create(null);
 const el=id=>document.getElementById(id);
 const pesos=n=>new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS'}).format(n);
 function render(){
  for(const symbol of ids){
   const v=observations[symbol],p=el('c37p'+symbol),s=el('c37s'+symbol);
   if(!v){p.textContent='—';s.textContent='Sin cotización · sin fuente conectada';continue;}
   p.textContent=pesos(v.price);
   const age=Date.now()-v.timestamp;
   const stale=age>20*60*1000;
   s.textContent='Referencia MANUAL sin verificar · '+(stale?'DESACTUALIZADA':'Reciente (no validada)')+' · '+new Date(v.timestamp).toLocaleString('es-AR',{timeZone:'America/Argentina/Buenos_Aires'});
  }
 }
 el('c37apply').addEventListener('click',()=>{
  const symbol=el('c37symbol').value,price=Number(el('c37price').value),raw=el('c37time').value;
  if(!ids.includes(symbol)||!Number.isFinite(price)||price<=0||!raw){el('c37message').textContent='Ingresá precio positivo y fecha/hora de la cotización.';return;}
  const match=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(raw);
  if(!match){el('c37message').textContent='Fecha/hora inválida.';return;}
  const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]),hour=Number(match[4]),minute=Number(match[5]);
  // Exact round-trip validation (UTC components represent the ARS wall clock before applying -03:00).
  const check=new Date(Date.UTC(year,month-1,day,hour,minute));
  if(year<2000||year>9999||check.getUTCFullYear()!==year||check.getUTCMonth()!==month-1||check.getUTCDate()!==day||check.getUTCHours()!==hour||check.getUTCMinutes()!==minute){
    el('c37message').textContent='Fecha/hora inexistente o fuera de rango.';return;
  }
  const timestamp=Date.UTC(year,month-1,day,hour+3,minute);
  if(!Number.isFinite(timestamp)||timestamp>Date.now()+60000){el('c37message').textContent='Fecha inválida o futura.';return;}
  observations[symbol]={price,timestamp};
  el('c37message').textContent='Referencia manual de '+symbol+' registrada únicamente en esta sesión; NO es un precio verificado.';
  render();
 });
 el('c37clear').addEventListener('click',()=>{for(const symbol of ids)delete observations[symbol];el('c37message').textContent='Referencias eliminadas.';render();});
 setInterval(render,60000);render();
})();

/* 3.7.1 - Exportación independiente del estado ficticio, sin alterar la simulación. */
(()=>{
 'use strict';
 const btn=document.getElementById('backup371');
 btn.addEventListener('click',()=>{
  try{
   const sourceKey='tradingBotAI_3_7_1_state';
   const raw=localStorage.getItem(sourceKey);
   if(!raw)throw new Error('Todavía no hay una simulación guardada en 3.7.1.');
   const data=JSON.parse(raw);
   if(!data||data.version!==1||!Array.isArray(data.orders)||!Array.isArray(data.closedTrades)||!data.positions)throw new Error('El historial guardado no tiene el formato esperado.');
   const blob=new Blob([JSON.stringify({format:'TradingBotAI-backup-v1',source:sourceKey,exportedAt:new Date().toISOString(),data},null,2)],{type:'application/json'});
   const url=URL.createObjectURL(blob);
   const link=document.createElement('a');
   link.href=url;link.download='trading_bot_ai_3_7_1_respaldo_'+new Date().toISOString().slice(0,10)+'.json';
   document.body.appendChild(link);link.click();link.remove();
   setTimeout(()=>URL.revokeObjectURL(url),2000);
  }catch(err){alert('No se pudo exportar la copia: '+err.message)}
 });
})();
