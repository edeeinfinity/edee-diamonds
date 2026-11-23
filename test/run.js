// Local test: serve a synthetic feed with the real header, start the service, query it.
import http from 'node:http';
import { spawn } from 'node:child_process';
const H = 'certificateNumber,certificateComment,certificateImage,city,clarity,color,country,countryOfPolishing,crownAngle,crownHeight,cut,depth,diamondImage,diamondImage2,diamondImage3,diamondImage4,diamondImage5,diamondImage6,diamondVideo,eyeClean,fancyColor,fancyColorIntensity,fancyColorOvertone,fluorescenceIntensity,girdleCondition,girdlePer,girdleThick,girdleThin,growthType,heartAndArrow,lab,laserInscription,location,lwRatio,measurements,measurementsDepth,measurementsLength,measurementsWidth,pavilionAngle,pavilionDepth,polish,pricePerCarat,shape,state,stockId,symmetry,table,treatment,weight,finalPrice,status,pair,imageCheckedAt,imageHttpStatus,isImageBroken,matchingStockId'.split(',');
const shapes = ['Round','Oval','Pear','ELONGATED CUSHION','Emerald'], cols=['D','E','F','G','H','I','Fancy'], cl=['VVS1','VS1','IF','SI1'], st=['Available','In Stock','Hold','Memo',''], labs=['IGI','GIA','None','igi'];
const rows=[H.join(',')]; let seed=7; const R=()=>{seed=(seed*16807)%2147483647; return seed/2147483647;}; const pick=a=>a[Math.floor(R()*a.length)]; const meta=[];
for (let i=0;i<3000;i++){ const o=Object.fromEntries(H.map(h=>[h,'']));
  Object.assign(o,{certificateNumber:String(700000000+i),clarity:pick(cl),color:pick(cols),cut:pick(['ID','EX','','VG']),depth:'62.1',diamondImage:i%9?`https://video.example/imaged/S${i}/still.jpg`:'',diamondVideo:`https://video.example/video.html?d=S${i}`,fluorescenceIntensity:'None',growthType:pick(['CVD','HPHT','cvd']),lab:pick(labs),location:'India',lwRatio:'1.01',measurements:'6.5*6.48*4.0',polish:'EX',shape:pick(shapes),stockId:'S'+i,symmetry:'EX',table:'58',weight:(0.2+R()*4).toFixed(2),finalPrice:(50+Math.floor(R()*1200)).toFixed(2),status:pick(st),isImageBroken:i%13?'False':'True'});
  meta[i]=+o.finalPrice; rows.push(H.map(h=>/[,"]/.test(o[h])?`"${o[h].replace(/"/g,'""')}"`:o[h]).join(',')); }
rows.push('"quoted, comma",x'); // malformed short row
const feed = http.createServer((q,r)=>{r.writeHead(200,{'content-type':'text/csv'}); r.end(rows.join('\r\n'));}).listen(18080);
const env={...process.env, PORT:'18081', FEED_URL:'http://127.0.0.1:18080/f.csv', FX_FALLBACK:'1.5'};
const p = spawn('node',['src/server.js'],{env, stdio:['ignore','pipe','pipe']});
p.stdout.on('data',d=>process.stdout.write('[svc] '+d)); p.stderr.on('data',d=>process.stdout.write('[svc!] '+d));
await new Promise(r=>setTimeout(r,4000));
const get = async (u, o={}) => { const r = await fetch('http://127.0.0.1:18081'+u, o); return [r.status, r.headers.get('access-control-allow-origin'), await r.json()]; };
const fail=[]; const ok=(c,m)=>{ console.log((c?'PASS ':'FAIL ')+m); if(!c) fail.push(m); };
let [s,,h] = await get('/health'); ok(s===200 && h.stones>0, 'health '+JSON.stringify({stones:h.stones,rows:h.rows,fx:h.fx?.rate,err:h.lastError}));
let [,,f] = await get('/api/facets'); ok(f.shapes.some(x=>x.name==='Elongated Cushion'), 'facets shapes '+f.shapes.map(x=>x.name+':'+x.count).join(','));
let [,,d] = await get('/api/diamonds?shape=Oval,Round&cmin=1&cmax=2&sort=price_desc&per=5');
ok(d.items.every(x=>['Oval','Round'].includes(x.shape)&&x.carat>=1&&x.carat<=2), 'filter shape/carat total '+d.total);
ok(d.items.every((x,i,a)=>!i||a[i-1].price>=x.price), 'sort price desc');
ok(d.items.every(x=>!('_usd' in x) && !('finalPrice' in x)), 'no supplier price exposed');
ok(d.items.every(x=>['IGI','GIA'].includes(x.lab) && 'DEFGH'.includes(x.colour) && x.image), 'only IGI/GIA, D-H, with photo');
const one = d.items[0]; console.log('sample', JSON.stringify(one));
// price check: USD x 1.5 x 2 rounded up to 10
const usd = meta[Number(one.id.slice(1))]; ok(one.price===Math.ceil(usd*1.5*2/10)*10, `price ${one.price} from US$${usd}`);
let [s2] = await get('/api/diamonds/'+one.id); ok(s2===200,'detail');
let [s3] = await get('/api/diamonds/NOPE'); ok(s3===404,'missing 404');
let [s4,a4] = await get('/api/facets',{headers:{origin:'https://edeeinfinity.com'}}); ok(a4==='https://edeeinfinity.com','CORS allowed origin');
let [,a5] = await get('/api/facets',{headers:{origin:'https://evil.example'}}); ok(a5===null,'CORS other origin refused');
let [s6] = await get('/api/cart-line',{method:'POST',headers:{origin:'https://evil.example'},body:JSON.stringify({id:one.id})}); ok(s6===403,'cart from other origin 403');
let [s7,,b7] = await get('/api/cart-line',{method:'POST',headers:{origin:'https://edeeinfinity.com'},body:JSON.stringify({id:one.id})}); ok(s7===500 && /went wrong/.test(b7.error),'cart without Shopify creds fails safely');
p.kill(); feed.close(); console.log(fail.length? 'FAILED: '+fail.join(' | ') : 'ALL PASSED'); process.exit(fail.length?1:0);
