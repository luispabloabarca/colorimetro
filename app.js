(() => {
'use strict';
const $ = id => document.getElementById(id);
function h(tag, attrs = {}, text){
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (text != null) el.textContent = text;
  return el;
}
const store = {
  get(k, d){ try{ const v = localStorage.getItem('colorimetro.'+k); return v == null ? d : JSON.parse(v); }catch{ return d; } },
  set(k, v){ try{ localStorage.setItem('colorimetro.'+k, JSON.stringify(v)); }catch{} }
};

/* ---------- Validación de lo que viene de localStorage ---------- */
const num = (v, d, min = -1e9, max = 1e9) => { v = typeof v === 'number' ? v : Number(v); return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d; };
const nul = v => v == null ? null : num(v, null);
const str = (v, d, max) => typeof v === 'string' && v.trim() ? v.slice(0, max) : d;
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);

const CTLS = [
  {key:'exposureTime', mode:'exposureMode', label:'Tiempo de exposición', fmt:v=>`${(v/10).toFixed(1)} ms`},
  {key:'iso', label:'ISO', fmt:v=>Math.round(v)},
  {key:'colorTemperature', mode:'whiteBalanceMode', label:'Balance de blancos', fmt:v=>`${Math.round(v)} K`},
  {key:'focusDistance', mode:'focusMode', label:'Distancia de foco', fmt:v=>`${(+v).toFixed(2)} m`},
  {key:'exposureCompensation', label:'Compensación de exposición', fmt:v=>`${(+v).toFixed(1)} EV`},
  {key:'zoom', label:'Zoom', fmt:v=>`${(+v).toFixed(1)}×`},
  {key:'brightness', label:'Brillo', fmt:v=>(+v).toFixed(0)},
  {key:'contrast', label:'Contraste', fmt:v=>(+v).toFixed(0)},
  {key:'saturation', label:'Saturación', fmt:v=>(+v).toFixed(0)},
  {key:'sharpness', label:'Nitidez', fmt:v=>(+v).toFixed(0)},
];
const MODES = ['exposureMode','whiteBalanceMode','focusMode'];
const MODE_VALUES = ['manual','continuous','single-shot','none'];

function cleanClasses(v){
  if (!Array.isArray(v)) return null;
  return v.slice(0, 20).filter(isObj).map((c, i) => ({
    name: str(c.name, 'Clase '+(i+1), 60),
    w: num(c.w, 0, -1e6, 1e6),
    lab: [num(c.lab?.[0], 50, 0, 100), num(c.lab?.[1], 0, -128, 128), num(c.lab?.[2], 0, -128, 128)],
  }));
}
function cleanPreset(v){
  if (!isObj(v)) return null;
  const p = {};
  MODES.forEach(m => { if (MODE_VALUES.includes(v[m])) p[m] = v[m]; });
  CTLS.forEach(ct => { const n = nul(v[ct.key]); if (n != null) p[ct.key] = n; });
  return Object.keys(p).length ? p : null;
}
function cleanLog(v){
  if (!Array.isArray(v)) return [];
  return v.slice(-5000).filter(isObj).map(r => {
    const pct = {};
    if (isObj(r.pct)) for (const [k, x] of Object.entries(r.pct).slice(0, 20)){ const n = nul(x); if (n != null) pct[k.slice(0, 60)] = n; }
    return {t:str(r.t, '', 40), name:str(r.name, '—', 80), score:nul(r.score), L:nul(r.L), a:nul(r.a), b:nul(r.b),
      C:nul(r.C), h:nul(r.h), sd:nul(r.sd), pct, preset:cleanPreset(r.preset) || {}};
  });
}
const cleanWhite = v => Array.isArray(v) && v.length === 3 && v.every(x => Number.isFinite(x) && x > 0.05 && x < 20) ? v : null;

/* ---------- Color: sRGB -> CIELAB (D65) ---------- */
const LIN = new Float32Array(256);
for (let i=0;i<256;i++){ const c=i/255; LIN[i] = c<=0.04045 ? c/12.92 : Math.pow((c+0.055)/1.055,2.4); }
const Xn=0.95047, Yn=1, Zn=1.08883, E=216/24389, K=24389/27;
const f = t => t>E ? Math.cbrt(t) : (K*t+16)/116;
function linToLab(r,g,b,out){
  const X=(0.4124564*r+0.3575761*g+0.1804375*b)/Xn;
  const Y=(0.2126729*r+0.7151522*g+0.0721750*b)/Yn;
  const Z=(0.0193339*r+0.1191920*g+0.9503041*b)/Zn;
  const fx=f(X), fy=f(Y), fz=f(Z);
  out[0]=116*fy-16; out[1]=500*(fx-fy); out[2]=200*(fy-fz);
}
function labToHex(L,a,b){
  const fy=(L+16)/116, fx=fy+a/500, fz=fy-b/200;
  const inv = t => { const t3=t*t*t; return t3>E ? t3 : (116*t-16)/K; };
  const X=inv(fx)*Xn, Y=(L>K*E ? fy*fy*fy : L/K)*Yn, Z=inv(fz)*Zn;
  const r= 3.2404542*X-1.5371385*Y-0.4985314*Z;
  const g=-0.9692660*X+1.8760108*Y+0.0415560*Z;
  const bb=0.0556434*X-0.2040259*Y+1.0572252*Z;
  const enc = c => { c=Math.min(1,Math.max(0,c||0)); return Math.round(255*(c<=0.0031308?12.92*c:1.055*Math.pow(c,1/2.4)-0.055)); };
  return '#'+[r,g,bb].map(c=>enc(c).toString(16).padStart(2,'0')).join('');
}

function hexToLab(hex){
  const m = /^#?([0-9a-f]{6})$/i.exec(hex); if (!m) return [50,0,0];
  const v = parseInt(m[1], 16), out = [0,0,0];
  linToLab(LIN[v>>16 & 255], LIN[v>>8 & 255], LIN[v & 255], out);
  return out.map(x => Math.round(x*10)/10);
}

/* ---------- Estado ---------- */
const DEFAULT_CLASSES = [
  {name:'Claro (ejemplo)',  w:0,   lab:[72,6,32]},
  {name:'Medio (ejemplo)',  w:50,  lab:[52,14,34]},
  {name:'Oscuro (ejemplo)', w:100, lab:[32,12,18]},
];
let classes = cleanClasses(store.get('classes', null)) || DEFAULT_CLASSES.map(c => ({...c, lab:c.lab.slice()}));
let white = cleanWhite(store.get('white', null));   // ganancias [gr,gg,gb] en lineal
let log = cleanLog(store.get('log', []));
let maxDE = num(store.get('maxDE', 30), 30, 1, 200);
let stream=null, track=null, caps={}, torchOn=false, running=false, starting=false, busy=false, timer=0, resumeOnShow=false;
let lastSum = null;
const video = $('video');
const work = document.createElement('canvas');
const wctx = work.getContext('2d', {willReadFrequently:true});
const ONE = [1,1,1];

// Centros de clase en un arreglo plano para el bucle por píxel
let CL = new Float32Array(0);
function packClasses(){ CL = new Float32Array(classes.length*3); classes.forEach((c,i) => CL.set(c.lab, i*3)); }

/* ---------- Análisis del recuadro ---------- */
// El visor es 4:3 con object-fit:cover, así que el recuadro se calcula sobre la parte visible del video.
function roiRect(vw, vh){
  const pct = +$('roiSize').value/100, scale = Math.max(4/vw, 3/vh), s = 3*pct/scale;
  return {x:(vw-s)/2, y:(vh-s)/2, s};
}
function placeRoi(){
  const v = $('viewer').getBoundingClientRect(); if (!v.width) return;
  const s = Math.min(v.width, v.height) * (+$('roiSize').value/100), el = $('roi');
  el.style.width = el.style.height = s+'px'; el.style.left = (v.width-s)/2+'px'; el.style.top = (v.height-s)/2+'px';
  el.style.borderRadius = roiRound ? '50%' : '4px';
}
// Forma redonda: solo cuentan los píxeles dentro del círculo inscrito en el recuadro
let roiRound = store.get('roiRound', false) === true;
let mask = null, maskSize = 0;
function getMask(s){
  if (s===maskSize) return mask;
  mask = new Uint8Array(s*s); const r = s/2;
  for (let y=0; y<s; y++){ const dy=(y+0.5-r)/r; for (let x=0; x<s; x++){ const dx=(x+0.5-r)/r; mask[y*s+x] = dx*dx+dy*dy<=1 ? 1 : 0; } }
  maskSize = s; return mask;
}
const PTS_MAX = 1500, ptsAB = new Float32Array(PTS_MAX*2), ptsRGB = new Uint8Array(PTS_MAX*3);
let ptsN = 0;
const labTmp = [0,0,0];
function analyzeFrame(){
  const vw = video.videoWidth, vh = video.videoHeight; if (!vw || !vh) return null;
  const r = roiRect(vw, vh), s = Math.max(4, Math.round(Math.min(r.s, 160)));
  if (work.width !== s){ work.width = s; work.height = s; }
  wctx.drawImage(video, r.x, r.y, r.s, r.s, 0, 0, s, s);
  const d = wctx.getImageData(0, 0, s, s).data;
  const g = white || ONE, nC = classes.length, maxDE2 = maxDE*maxDE, lab = labTmp;
  const m = roiRound ? getMask(s) : null;
  const counts = new Array(nC).fill(0), step = Math.max(1, Math.ceil(s*s/PTS_MAX));
  let total=0, n=0, clipped=0, unclass=0, sL=0, sA=0, sB=0, sLL=0;
  ptsN = 0;
  for (let i=0, p=0; i<d.length; i+=4, p++){
    if (m && !m[p]) continue;
    total++;
    const R=d[i], G=d[i+1], B=d[i+2];
    if (R>=250||G>=250||B>=250||(R<4&&G<4&&B<4)){ clipped++; continue; }
    linToLab(Math.min(1,LIN[R]*g[0]), Math.min(1,LIN[G]*g[1]), Math.min(1,LIN[B]*g[2]), lab);
    n++; sL+=lab[0]; sA+=lab[1]; sB+=lab[2]; sLL+=lab[0]*lab[0];
    if (p%step===0 && ptsN<PTS_MAX){
      ptsAB[ptsN*2]=lab[1]; ptsAB[ptsN*2+1]=lab[2];
      ptsRGB[ptsN*3]=R; ptsRGB[ptsN*3+1]=G; ptsRGB[ptsN*3+2]=B; ptsN++;
    }
    let best=-1, bd=Infinity;
    for (let c=0, o=0; c<nC; c++, o+=3){
      const dl=lab[0]-CL[o], da=lab[1]-CL[o+1], db=lab[2]-CL[o+2], dd=dl*dl+da*da+db*db;
      if (dd<bd){ bd=dd; best=c; }
    }
    if (best>=0 && bd<=maxDE2) counts[best]++; else unclass++;
  }
  return {n, clipped, unclass, counts, sL, sA, sB, sLL, total};
}
function summarize(acc){
  if (!acc || !acc.n) return null;
  const L=acc.sL/acc.n, a=acc.sA/acc.n, b=acc.sB/acc.n;
  const sd = Math.sqrt(Math.max(0, acc.sLL/acc.n-L*L));
  const C = Math.hypot(a,b); let hh = Math.atan2(b,a)*180/Math.PI; if (hh<0) hh+=360;
  const classified = acc.counts.reduce((x,y)=>x+y, 0);
  const pct = acc.counts.map(c => classified ? c/classified*100 : 0);
  const score = classified>0 ? acc.counts.reduce((s,c,i)=>s+c*classes[i].w, 0)/classified : null;
  return {L, a, b, C, h:hh, sd, pct, score, n:acc.n, clipped:acc.clipped, unclass:acc.unclass, total:acc.total};
}
function mergeAcc(A, B){
  if (!A) return {...B, counts:B.counts.slice()};
  ['n','clipped','unclass','sL','sA','sB','sLL','total'].forEach(k => A[k]+=B[k]);
  B.counts.forEach((c,i) => A.counts[i]+=c);
  return A;
}

/* ---------- Render ---------- */
const fmt = (v, d=1) => v==null || isNaN(v) ? '—' : (+v).toFixed(d);
let distRefs = [];
function buildDist(){
  const bar = $('distbar'), leg = $('legend');
  bar.replaceChildren(); leg.replaceChildren();
  distRefs = classes.map(c => {
    const col = labToHex(...c.lab);
    const seg = h('span', {title:c.name}); seg.style.background = col; seg.style.width = '0%';
    const sw = h('i'); sw.style.background = col;
    const tx = document.createTextNode('');
    const item = h('span'); item.append(sw, tx);
    bar.appendChild(seg); leg.appendChild(item);
    return {seg, tx, c};
  });
}
function render(sum){
  $('score').textContent = sum && sum.score!=null ? Math.round(sum.score) : '—';
  $('vL').textContent=fmt(sum?.L); $('vA').textContent=fmt(sum?.a); $('vB').textContent=fmt(sum?.b);
  $('vC').textContent=fmt(sum?.C); $('vH').textContent=fmt(sum?.h,0); $('vS').textContent=fmt(sum?.sd);
  $('swatch').style.background = sum ? labToHex(sum.L, sum.a, sum.b) : 'transparent';
  distRefs.forEach((r,i) => {
    const p = sum ? sum.pct[i] : 0;
    r.seg.style.width = p+'%';
    r.tx.data = `${r.c.name} · ${fmt(p,0)}% (valor ${r.c.w})`;
  });
  const pi = $('pixInfo');
  if (sum){
    const unPct = sum.unclass/sum.n*100, clipPct = sum.clipped/sum.total*100;
    pi.textContent = `${sum.n} píxeles válidos · ${fmt(unPct,0)}% fuera de clase · ${fmt(clipPct,0)}% saturados u oscuros (excluidos)`;
    pi.className = 'small ' + (clipPct>10 || unPct>25 ? 'status warn' : 'muted');
  } else pi.textContent = '';
  if (isShown('plot')) drawPlot();
}
let theme = {};
function readTheme(){
  const cs = getComputedStyle(document.body);
  theme = {line:cs.getPropertyValue('--line').trim(), muted:cs.getPropertyValue('--muted').trim(), fg:cs.getPropertyValue('--fg').trim()};
}
function drawPlot(){
  const cv=$('plot'), ctx=cv.getContext('2d'), W=cv.width, R=60;
  const X=a=>W/2+a/R*(W/2), Y=b=>W/2-b/R*(W/2);
  ctx.clearRect(0,0,W,W);
  ctx.strokeStyle=theme.line; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(0,W/2); ctx.lineTo(W,W/2); ctx.moveTo(W/2,0); ctx.lineTo(W/2,W); ctx.stroke();
  [20,40].forEach(r=>{ ctx.beginPath(); ctx.arc(W/2,W/2,r/R*W/2,0,7); ctx.stroke(); });
  ctx.fillStyle=theme.muted; ctx.font='18px ui-monospace, monospace';
  ctx.fillText('+a*',W-44,W/2-6); ctx.fillText('+b*',W/2+6,20);
  for (let i=0; i<ptsN; i++){
    ctx.fillStyle=`rgb(${ptsRGB[i*3]},${ptsRGB[i*3+1]},${ptsRGB[i*3+2]})`;
    ctx.fillRect(X(ptsAB[i*2])-2, Y(ptsAB[i*2+1])-2, 4, 4);
  }
  classes.forEach(c=>{
    ctx.beginPath(); ctx.arc(X(c.lab[1]),Y(c.lab[2]),9,0,7);
    ctx.fillStyle=labToHex(...c.lab); ctx.fill();
    ctx.lineWidth=2.5; ctx.strokeStyle=theme.fg; ctx.stroke();
  });
}

/* ---------- Bucle en vivo ---------- */
function loop(){
  if (!running) return;
  if (!busy){ lastSum = summarize(analyzeFrame()); render(lastSum); }
  timer = setTimeout(loop, 200);
}
// requestVideoFrameCallback no se dispara si el visor está oculto: se combina con un tiempo máximo
const nextFrame = () => new Promise(r => {
  const t = setTimeout(r, 120);
  if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(() => { clearTimeout(t); r(); });
});
async function averaged(frames){
  busy = true; let acc = null;
  try{ for (let i=0; i<frames; i++){ await nextFrame(); const a = analyzeFrame(); if (a) acc = mergeAcc(acc, a); } }
  finally{ busy = false; }
  return acc;
}

/* ---------- Cámara ---------- */
function setStatus(t, cls=''){ const s=$('status'); s.textContent=t; s.className='status grow '+cls; }
async function apply(c){
  if (!track) return false;
  try{ await track.applyConstraints({advanced:[c]}); return true; }
  catch(e){ setStatus('El equipo rechazó el ajuste: '+(e.message||e.name), 'bad'); return false; }
}
const settings = () => track?.getSettings?.() || {};

function buildControls(){
  const list = $('ctlList'); list.replaceChildren();
  const st = settings(); let any = false;
  CTLS.forEach(ct => {
    const cp = caps[ct.key]; if (!cp || cp.max==null || cp.min===cp.max) return; any = true;
    const id = 'ctl_'+ct.key;
    const box = h('div', {class:'ctl'});
    const lb = h('label', {for:id}, ct.label);
    const out = h('output', {id:id+'_o'});
    const inp = h('input', {type:'range', id, min:cp.min, max:cp.max, step:cp.step || (cp.max-cp.min)/100});
    box.append(lb, out, inp); list.appendChild(box);
    inp.value = st[ct.key] ?? cp.min; out.textContent = ct.fmt(+inp.value);
    inp.addEventListener('input', () => { out.textContent = ct.fmt(+inp.value); });
    inp.addEventListener('change', async () => {
      const c = {[ct.key]: +inp.value};
      if (ct.mode && caps[ct.mode]?.includes('manual')) c[ct.mode] = 'manual';
      if (ct.key==='iso' && caps.exposureMode?.includes('manual')) c.exposureMode = 'manual';
      if (await apply(c)) setStatus(`${ct.label} fijado en ${ct.fmt(+inp.value)}`, 'ok');
      refreshChips();
    });
  });
  if (!any) list.appendChild(h('p', {class:'small status warn'}, 'Este navegador o cámara no expone controles manuales. Usa Chrome en Android; Safari en iPhone no permite fijar exposición ni balance de blancos desde una página web.'));
}
function refreshChips(){
  const st = settings(), box = $('chips'); box.replaceChildren();
  [['exposureMode','EXP'],['whiteBalanceMode','WB'],['focusMode','FOCO']].forEach(([m,l]) => {
    if (!caps[m]){ box.appendChild(h('span', {class:'chip'}, l+' n/d')); return; }
    const v = st[m];
    box.appendChild(h('span', {class:'chip '+(v==='manual'?'fixed':'auto')}, `${l} ${v==='manual'?'fijo':v==='none'?'—':'auto'}`));
  });
  CTLS.forEach(ct => {
    const i = $('ctl_'+ct.key);
    if (i && st[ct.key]!=null){ i.value = st[ct.key]; $('ctl_'+ct.key+'_o').textContent = ct.fmt(+st[ct.key]); }
  });
}
async function lockCurrent(){
  const st = settings(), c = {};
  if (caps.exposureMode?.includes('manual')){ c.exposureMode='manual'; if (st.exposureTime!=null&&caps.exposureTime) c.exposureTime=st.exposureTime; if (st.iso!=null&&caps.iso) c.iso=st.iso; }
  if (caps.whiteBalanceMode?.includes('manual')){ c.whiteBalanceMode='manual'; if (st.colorTemperature!=null&&caps.colorTemperature) c.colorTemperature=st.colorTemperature; }
  if (caps.focusMode?.includes('manual')){ c.focusMode='manual'; if (st.focusDistance!=null&&caps.focusDistance) c.focusDistance=st.focusDistance; }
  if (!Object.keys(c).length){ setStatus('Esta cámara no admite modo manual desde el navegador.', 'bad'); return; }
  if (await apply(c)){
    const miss = MODES.filter(m => !caps[m]?.includes('manual')).map(m => ({exposureMode:'exposición', whiteBalanceMode:'balance de blancos', focusMode:'foco'}[m]));
    setStatus('Ajustes fijados.'+(miss.length ? ' No se pudo fijar: '+miss.join(', ')+'.' : ''), miss.length ? 'warn' : 'ok');
  }
  refreshChips();
}
function currentPreset(){
  const st = settings(), p = {};
  MODES.forEach(m => { if (st[m]) p[m] = st[m]; });
  CTLS.forEach(ct => { if (caps[ct.key] && st[ct.key]!=null) p[ct.key] = st[ct.key]; });
  return p;
}
async function applyPreset(p){
  const c = {};
  Object.entries(p).forEach(([k,v]) => {
    if (MODES.includes(k)){ if (caps[k]?.includes(v)) c[k] = v; }
    else if (caps[k]) c[k] = Math.min(caps[k].max, Math.max(caps[k].min, v));
  });
  const ok = await apply(c);
  refreshChips();
  return ok;
}
function showPreset(){
  const p = cleanPreset(store.get('preset', null));
  $('presetInfo').textContent = p ? 'Preset guardado: '+Object.entries(p).map(([k,v]) => `${k}=${typeof v==='number' ? +v.toFixed(3) : v}`).join(' · ') : 'Sin preset guardado.';
}
const CAM_BTNS = ['btnLock','btnMeasure','btnWhite','btnSavePreset','btnApplyPreset','btnAuto'];
function setCamButtons(on){
  CAM_BTNS.forEach(id => $(id).disabled = !on);
  $('btnTorch').disabled = !(on && caps.torch);
  document.querySelectorAll('.capbtn').forEach(b => b.disabled = !on);
}
async function start(){
  if (running || starting) return;
  if (!navigator.mediaDevices?.getUserMedia){ setStatus('Este navegador no permite usar la cámara. La página debe abrirse por https:// en Chrome.', 'bad'); return; }
  starting = true; $('btnStart').disabled = true;
  try{
    try{
      stream = await navigator.mediaDevices.getUserMedia({audio:false, video:{facingMode:{ideal:'environment'}, width:{ideal:1280}, height:{ideal:960}}});
    }catch(e){ setStatus('No se pudo abrir la cámara: '+(e.message||e.name), 'bad'); return; }
    track = stream.getVideoTracks()[0];
    video.srcObject = stream; await video.play();
    // Algunos equipos sólo informan capacidades después de un instante
    await new Promise(r => setTimeout(r, 500));
    caps = track.getCapabilities?.() || {};
    $('msg').hidden = true; running = true;
    $('camInfo').textContent = `${track.label || 'Cámara'} · ${video.videoWidth}×${video.videoHeight}`;
    $('btnStart').textContent = 'Detener cámara';
    setCamButtons(true); buildControls(); placeRoi();
    const p = cleanPreset(store.get('preset', null));
    if (p){ if (await applyPreset(p)) setStatus('Preset guardado aplicado automáticamente.', 'ok'); }
    else setStatus('Cámara en modo automático. Encuadra la muestra y pulsa “Fijar ajustes actuales”.', 'warn');
    refreshChips(); loop();
  } finally { starting = false; $('btnStart').disabled = false; }
}
function stop(){
  running = false; clearTimeout(timer);
  stream?.getTracks().forEach(t => t.stop()); stream = track = null; caps = {}; torchOn = false;
  video.srcObject = null;
  $('msg').hidden = false; $('btnStart').textContent = 'Iniciar cámara'; $('btnTorch').textContent = 'Linterna';
  $('camInfo').textContent = 'Cámara detenida'; $('chips').replaceChildren();
  setCamButtons(false);
}

/* ---------- Clases ---------- */
function classesChanged(){
  store.set('classes', classes); packClasses(); lastSum = null;
  buildDist(); renderClasses(); render(null);
}
// Una clase de ejemplo deja de serlo en cuanto el usuario le da un color propio
const unmark = (c, i) => { c.name = c.name.replace(/\s*\(ejemplo\)/i, '') || 'Clase '+(i+1); };
function renderClasses(){
  const box = $('clsList'); box.replaceChildren();
  classes.forEach((c, i) => {
    const el = h('div', {class:'cls'});
    const sw = h('input', {type:'color', class:'sw', id:'cc'+i, 'aria-label':'Elegir color de '+c.name}); sw.value = labToHex(...c.lab);
    const n = h('input', {type:'text', id:'cn'+i, maxlength:'60', 'aria-label':'Nombre de la clase'}); n.value = c.name;
    const w = h('input', {type:'number', id:'cw'+i, step:'any', 'aria-label':'Valor de puntaje'}); w.value = c.w;
    const acts = h('div', {class:'row', style:'gap:4px;flex-wrap:nowrap'});
    const cap = h('button', {type:'button', class:'capbtn'}, 'Capturar'); cap.disabled = !running;
    const del = h('button', {type:'button', 'aria-label':'Eliminar clase '+c.name}, '✕');
    acts.append(cap, del);
    // L*, a*, b* editables a mano (p. ej. valores de un colorímetro de laboratorio)
    const info = h('div', {class:'labv labin'});
    [['L*',0,0,100],['a*',1,-128,128],['b*',2,-128,128]].forEach(([lbl,k,min,max]) => {
      const lb = h('label', {class:'small muted'}, lbl+' ');
      const x = h('input', {type:'number', id:`cl${k}_${i}`, step:'0.1', min, max, class:'mono'}); x.value = fmt(c.lab[k]);
      x.addEventListener('change', () => { c.lab[k] = num(x.value, c.lab[k], min, max); unmark(c, i); classesChanged(); });
      lb.appendChild(x); info.appendChild(lb);
    });
    el.append(sw, n, w, acts, info); box.appendChild(el);
    sw.addEventListener('change', () => { c.lab = hexToLab(sw.value); unmark(c, i); classesChanged(); });
    n.addEventListener('change', () => { c.name = str(n.value, 'Clase '+(i+1), 60); classesChanged(); });
    w.addEventListener('change', () => { c.w = num(w.value, 0, -1e6, 1e6); classesChanged(); });
    cap.addEventListener('click', async () => {
      const s = summarize(await averaged(10));
      if (!s){ setStatus('No hay píxeles válidos en el recuadro.', 'bad'); return; }
      c.lab = [s.L, s.a, s.b]; unmark(c, i);
      classesChanged(); setStatus(`Clase “${c.name}” capturada.`, 'ok');
    });
    del.addEventListener('click', () => { classes.splice(i, 1); classesChanged(); });
  });
  $('clsNote').textContent = classes.some(c => /ejemplo/i.test(c.name)) ? 'Las clases marcadas “ejemplo” son valores de muestra: reemplázalas capturando tus propios patrones o escribiendo sus valores.' : '';
}
$('btnAddCls').addEventListener('click', () => {
  if (classes.length >= 20){ setStatus('Máximo 20 clases.', 'warn'); return; }
  const base = lastSum ? [lastSum.L, lastSum.a, lastSum.b] : [50,0,0];
  classes.push({name:'Clase '+(classes.length+1), w:classes.length ? Math.max(...classes.map(c=>c.w))+10 : 0, lab:base});
  classesChanged();
});
$('maxDE').value = maxDE;
$('maxDE').addEventListener('change', () => { maxDE = num($('maxDE').value, 30, 1, 200); $('maxDE').value = maxDE; store.set('maxDE', maxDE); });

/* ---------- Blanco ---------- */
function showWhite(){ $('whiteInfo').textContent = white ? `ganancias R ${white[0].toFixed(3)} · G ${white[1].toFixed(3)} · B ${white[2].toFixed(3)}` : 'sin calibrar'; }
$('btnWhite').addEventListener('click', async () => {
  busy = true;
  try{
    let r=0, g=0, b=0, n=0;
    for (let k=0; k<10; k++){
      await nextFrame();
      const R = roiRect(video.videoWidth, video.videoHeight), s = Math.max(4, Math.round(Math.min(120, R.s)));
      work.width = work.height = s; wctx.drawImage(video, R.x, R.y, R.s, R.s, 0, 0, s, s);
      const d = wctx.getImageData(0, 0, s, s).data;
      for (let i=0; i<d.length; i+=4){ if (d[i]>=250||d[i+1]>=250||d[i+2]>=250) continue; r+=LIN[d[i]]; g+=LIN[d[i+1]]; b+=LIN[d[i+2]]; n++; }
    }
    if (n<100 || !r || !g || !b){ setStatus('El blanco está saturado o muy oscuro. Ajusta la exposición e intenta de nuevo.', 'bad'); return; }
    r/=n; g/=n; b/=n;
    // Llevar la referencia a un gris neutro con la misma luminancia Y
    const Y = 0.2126729*r+0.7151522*g+0.0721750*b;
    const w = cleanWhite([Y/r, Y/g, Y/b]);
    if (!w){ setStatus('La referencia está demasiado teñida para calibrar. Usa una tarjeta blanca o gris neutro.', 'bad'); return; }
    white = w; store.set('white', white); showWhite(); setStatus('Referencia de blanco calibrada.', 'ok');
  } finally { busy = false; }
});
$('btnWhiteReset').addEventListener('click', () => { white = null; store.set('white', null); showWhite(); });

/* ---------- Registro ---------- */
const logNames = () => [...new Set(log.flatMap(r => Object.keys(r.pct)))];
function renderLog(){
  const t = $('logTbl'), names = logNames();
  const head = h('tr');
  ['Hora','Muestra','Puntaje','L*','a*','b*','C*','h°', ...names.map(n => '% '+n)].forEach(x => head.appendChild(h('th', {}, x)));
  t.replaceChildren(head);
  if (!log.length){
    const tr = h('tr'); tr.appendChild(h('td', {colspan:'8', class:'muted', style:'text-align:left'}, 'Sin mediciones todavía. Pulsa “Medir” con una muestra en el recuadro.'));
    t.appendChild(tr); return;
  }
  // Solo las últimas 200 filas en pantalla; el CSV exporta todo
  for (const r of log.slice(-200).reverse()){
    const tr = h('tr');
    tr.appendChild(h('td', {}, r.t.slice(11,19)));
    tr.appendChild(h('td', {}, r.name));
    const sc = h('td'); sc.appendChild(h('b', {}, fmt(r.score,0))); tr.appendChild(sc);
    [fmt(r.L), fmt(r.a), fmt(r.b), fmt(r.C), fmt(r.h,0), ...names.map(n => r.pct[n]!=null ? fmt(r.pct[n],0) : '')].forEach(x => tr.appendChild(h('td', {}, x)));
    t.appendChild(tr);
  }
}
$('btnMeasure').addEventListener('click', async () => {
  $('btnMeasure').disabled = true;
  try{
    const s = summarize(await averaged(10));
    if (!s){ setStatus('No hay píxeles válidos en el recuadro.', 'bad'); return; }
    const pct = {}; classes.forEach((c,i) => pct[c.name] = s.pct[i]);
    log.push({t:new Date().toISOString(), name:str($('sampleName').value, '—', 80), score:s.score, L:s.L, a:s.a, b:s.b, C:s.C, h:s.h, sd:s.sd, pct, preset:currentPreset()});
    if (log.length > 5000) log = log.slice(-5000);
    store.set('log', log); renderLog(); lastSum = s; render(s);
    const st = settings();
    if (st.exposureMode!=='manual' || st.whiteBalanceMode!=='manual') setStatus(`Medido: puntaje ${fmt(s.score,0)}. Atención: la cámara no estaba con exposición y balance fijos.`, 'warn');
    else setStatus(`Medido: puntaje ${fmt(s.score,0)}`, 'ok');
  } finally { $('btnMeasure').disabled = !running; }
});
$('btnClearLog').addEventListener('click', function(){
  if (this.dataset.armed){ log = []; store.set('log', log); renderLog(); this.textContent = 'Borrar registro'; delete this.dataset.armed; }
  else { this.dataset.armed = '1'; this.textContent = 'Confirmar borrado'; setTimeout(() => { this.textContent = 'Borrar registro'; delete this.dataset.armed; }, 4000); }
});
$('btnCsv').addEventListener('click', () => {
  if (!log.length){ setStatus('No hay mediciones para exportar.', 'warn'); return; }
  const names = logNames();
  const q = v => { v = v==null ? '' : String(v); return /[;"\n\r]/.test(v) ? '"'+v.replace(/"/g,'""')+'"' : v; };
  // Texto que Excel interpretaría como fórmula se antepone con apóstrofo
  const qt = v => q(/^[=+\-@\t\r]/.test(String(v)) ? "'"+v : v);
  const n2 = v => v==null ? '' : (+v).toFixed(2).replace('.', ',');
  const head = ['fecha_hora','muestra','puntaje','L','a','b','C','h','sdL', ...names.map(n => 'pct_'+n), 'ajustes_camara'].map(qt);
  const rows = log.map(r => [qt(r.t), qt(r.name), n2(r.score), n2(r.L), n2(r.a), n2(r.b), n2(r.C), n2(r.h), n2(r.sd), ...names.map(n => n2(r.pct[n])), q(JSON.stringify(r.preset || {}))].join(';'));
  const blob = new Blob(['﻿'+head.join(';')+'\n'+rows.join('\n')], {type:'text/csv;charset=utf-8'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'colorimetro_'+new Date().toISOString().slice(0,10)+'.csv';
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});

/* ---------- Bloques y vistas ---------- */
const BLOCKS = ['viewer','live','plot','classes','white','camera','log'];
const BUILTIN = {
  'Medición': {order:['viewer','live','plot','classes','log','white','camera'], hidden:['classes','log','white','camera']},
  'Ajustes':  {order:['viewer','camera','white','classes','live','plot','log'], hidden:['live','plot','log']},
  'Registro': {order:['viewer','live','log','plot','classes','white','camera'], hidden:['plot','classes','white','camera']},
  'Todo':     {order:BLOCKS.slice(), hidden:[]},
};
const cleanIds = v => Array.isArray(v) ? [...new Set(v.filter(b => BLOCKS.includes(b)))] : [];
function cleanOrder(v){ const o = cleanIds(v); BLOCKS.forEach(b => { if (!o.includes(b)) o.push(b); }); return o; }
function cleanLayout(v){
  if (!isObj(v)) return null;
  return {order:cleanOrder(v.order), hidden:cleanIds(v.hidden), collapsed:cleanIds(v.collapsed), view:str(v.view, '', 30)};
}
function cleanViews(v){
  if (!Array.isArray(v)) return [];
  return v.slice(0, 12).filter(isObj).map(x => ({name:str(x.name, '', 30), order:cleanOrder(x.order), hidden:cleanIds(x.hidden)}))
    .filter(x => x.name && !BUILTIN[x.name]);
}
let layout = cleanLayout(store.get('layout', null)) || {order:BLOCKS.slice(), hidden:[], collapsed:[], view:'Todo'};
let customViews = cleanViews(store.get('views', []));
let organizing = false;
const blockEl = id => document.querySelector(`.block[data-block="${id}"]`);
const isShown = id => !layout.hidden.includes(id) && !layout.collapsed.includes(id);

function setupBlocks(){
  document.querySelectorAll('.block').forEach(sec => {
    const id = sec.dataset.block, title = sec.dataset.title;
    const bh = h('div', {class:'bh'});
    const col = h('button', {type:'button', class:'bcol', 'aria-expanded':'true'});
    col.append(h('span', {class:'bt'}, title), h('span', {class:'chev', 'aria-hidden':'true'}, '▾'));
    const up = h('button', {type:'button', class:'org', 'aria-label':'Subir '+title}, '↑');
    const down = h('button', {type:'button', class:'org', 'aria-label':'Bajar '+title}, '↓');
    const eye = h('button', {type:'button', class:'org eye'}, 'Ocultar');
    bh.append(col, up, down, eye);
    sec.prepend(bh);
    col.addEventListener('click', () => { toggleIn(layout.collapsed, id); applyLayout(); });
    up.addEventListener('click', () => move(id, -1));
    down.addEventListener('click', () => move(id, 1));
    eye.addEventListener('click', () => { toggleIn(layout.hidden, id); layout.view = ''; applyLayout(); });
    sec._ctl = {col, up, down, eye};
  });
}
function toggleIn(arr, id){ const i = arr.indexOf(id); if (i<0) arr.push(id); else arr.splice(i, 1); }
function move(id, dir){
  const o = layout.order, i = o.indexOf(id), j = i+dir;
  if (j<0 || j>=o.length) return;
  [o[i], o[j]] = [o[j], o[i]]; layout.view = ''; applyLayout();
  blockEl(id)._ctl[dir<0 ? 'up' : 'down'].focus();
}
function applyLayout(){
  const main = $('blocks');
  layout.order.forEach(id => main.appendChild(blockEl(id)));
  layout.order.forEach((id, i) => {
    const el = blockEl(id), c = el._ctl, off = layout.hidden.includes(id), colp = layout.collapsed.includes(id);
    el.hidden = off && !organizing;
    el.classList.toggle('off', off);
    el.classList.toggle('collapsed', colp);
    el.querySelector('.bb').hidden = colp;
    c.col.setAttribute('aria-expanded', String(!colp));
    c.eye.textContent = off ? 'Mostrar' : 'Ocultar';
    c.up.disabled = i===0; c.down.disabled = i===layout.order.length-1;
  });
  main.classList.toggle('organizing', organizing);
  // Mover el <video> en el DOM puede pausarlo en algunos navegadores
  if (running && video.paused) video.play().catch(() => {});
  store.set('layout', layout);
  renderViews(); placeRoi();
  if (isShown('plot')) drawPlot();
}
function applyView(name){
  const v = BUILTIN[name] || customViews.find(x => x.name===name); if (!v) return;
  layout = {order:cleanOrder(v.order), hidden:cleanIds(v.hidden), collapsed:[], view:name};
  applyLayout();
}
function renderViews(){
  const box = $('views'); box.replaceChildren();
  const add = (name, custom) => {
    const wrap = h('span', {class:'vchip'+(custom ? ' custom' : '')});
    const b = h('button', {type:'button', 'aria-pressed':String(layout.view===name)}, name);
    b.addEventListener('click', () => applyView(name));
    wrap.appendChild(b);
    if (custom && organizing){
      const d = h('button', {type:'button', class:'vdel', 'aria-label':'Eliminar vista '+name}, '✕');
      d.addEventListener('click', () => {
        customViews = customViews.filter(x => x.name!==name); store.set('views', customViews);
        if (layout.view===name) layout.view = '';
        renderViews();
      });
      wrap.appendChild(d);
    }
    box.appendChild(wrap);
  };
  Object.keys(BUILTIN).forEach(n => add(n, false));
  customViews.forEach(v => add(v.name, true));
  if (!layout.view) box.appendChild(h('span', {class:'small muted', style:'align-self:center'}, 'Vista personalizada sin guardar'));
}
function setOrganizing(on){
  organizing = on;
  $('btnOrg').setAttribute('aria-pressed', String(on));
  $('orgBar').hidden = !on;
  applyLayout();
}
$('btnOrg').addEventListener('click', () => setOrganizing(!organizing));
$('btnOrgDone').addEventListener('click', () => setOrganizing(false));
$('btnSaveView').addEventListener('click', () => {
  const name = str($('viewName').value.trim(), '', 30);
  if (!name){ setStatus('Escribe un nombre para la vista.', 'warn'); $('viewName').focus(); return; }
  if (BUILTIN[name]){ setStatus(`“${name}” es una vista predefinida; usa otro nombre.`, 'warn'); return; }
  const v = {name, order:layout.order.slice(), hidden:layout.hidden.slice()};
  const i = customViews.findIndex(x => x.name===name);
  if (i>=0) customViews[i] = v;
  else { if (customViews.length>=12){ setStatus('Máximo 12 vistas guardadas. Elimina una primero.', 'warn'); return; } customViews.push(v); }
  store.set('views', customViews); layout.view = name; $('viewName').value = '';
  applyLayout(); setStatus(`Vista “${name}” guardada.`, 'ok');
});

/* ---------- Botones de cámara y eventos generales ---------- */
$('btnStart').addEventListener('click', () => running ? stop() : start());
$('btnLock').addEventListener('click', lockCurrent);
$('btnTorch').addEventListener('click', async () => {
  const want = !torchOn;
  if (await apply({torch:want})){ torchOn = want; $('btnTorch').textContent = torchOn ? 'Apagar linterna' : 'Linterna'; }
});
$('btnSavePreset').addEventListener('click', () => { store.set('preset', currentPreset()); showPreset(); setStatus('Preset guardado. Se aplicará cada vez que inicies la cámara.', 'ok'); });
$('btnApplyPreset').addEventListener('click', async () => {
  const p = cleanPreset(store.get('preset', null));
  if (!p){ setStatus('No hay preset guardado.', 'warn'); return; }
  if (await applyPreset(p)) setStatus('Preset aplicado.', 'ok');
});
$('btnAuto').addEventListener('click', async () => {
  const c = {}; MODES.forEach(m => { if (caps[m]?.includes('continuous')) c[m] = 'continuous'; });
  if (await apply(c)) setStatus('Cámara en automático.', 'warn');
  refreshChips();
});
$('roiSize').value = num(store.get('roi', 40), 40, 10, 90);
$('roiSize').addEventListener('input', () => { placeRoi(); store.set('roi', +$('roiSize').value); });
$('roiShape').value = roiRound ? 'round' : 'square';
$('roiShape').addEventListener('change', () => { roiRound = $('roiShape').value==='round'; store.set('roiRound', roiRound); placeRoi(); });
new ResizeObserver(placeRoi).observe($('viewer'));
// Al salir de la app se libera la cámara; al volver se reabre sola
document.addEventListener('visibilitychange', () => {
  if (document.hidden){ if (running){ resumeOnShow = true; stop(); } }
  else if (resumeOnShow){ resumeOnShow = false; start(); }
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { readTheme(); drawPlot(); });

readTheme(); packClasses(); buildDist(); setupBlocks(); applyLayout();
renderClasses(); renderLog(); showWhite(); showPreset(); render(null);
})();
