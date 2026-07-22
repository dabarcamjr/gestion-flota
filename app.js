/* Gestión Documental de Flota — Fase 1
   App 100% cliente. Datos en localStorage. Migrable a nube en el futuro. */
(function(){
'use strict';

const LS_KEY = 'flota_db_v1';
const $ = (s,r=document)=>r.querySelector(s);
const $$ = (s,r=document)=>Array.from(r.querySelectorAll(s));
const esc = s => String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* ---------- estado ---------- */
let DB = null;
let CLOUD = { enabled:false, sb:null, email:'' };
let VIEW = 'dashboard';
let SORT = { key:'estadoOrden', dir:1 };
let FILTER = { tipo:'todos', estado:'todos', q:'' };

/* ---------- fechas / vencimientos ---------- */
const MS_DAY = 86400000;
function today0(){ const d=new Date(); return new Date(d.getFullYear(),d.getMonth(),d.getDate()); }
function parseISO(s){ if(!s) return null; const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(s); if(!m) return null; return new Date(+m[1],+m[2]-1,+m[3]); }
function toISO(d){ if(!d) return null; const p=n=>String(n).padStart(2,'0'); return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate()); }
function addMonths(iso, months){
  const d=parseISO(iso); if(!d||months==null) return null;
  const day=d.getDate(); const nd=new Date(d.getFullYear(), d.getMonth()+months, 1);
  const last=new Date(nd.getFullYear(), nd.getMonth()+1, 0).getDate();
  nd.setDate(Math.min(day,last)); return toISO(nd);
}
function fmt(iso){ if(!iso) return '—'; const d=parseISO(iso); if(!d) return '—';
  return String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0')+'/'+d.getFullYear(); }

function docTypesFor(cat){ return (DB.docTypes[cat]||[]); }
function docVence(doc, dt){
  if(!doc) return null;
  if(doc.vence) return doc.vence;
  if(doc.realizado && dt && dt.vigenciaMeses) return addMonths(doc.realizado, dt.vigenciaMeses);
  return null;
}
function diasDe(iso){ if(!iso) return null; return Math.round((parseISO(iso)-today0())/MS_DAY); }
function estadoDe(dias, hasRealizado){
  if(dias==null) return hasRealizado ? 'vigente' : 'sin_dato'; // sin vencimiento pero realizado = vigente (docs sin caducidad)
  if(dias<0) return 'vencido'; if(dias<=30) return 'por_vencer'; return 'vigente';
}
const ESTADO_ORDEN = { vencido:0, por_vencer:1, sin_dato:2, vigente:3 };
const ESTADO_LABEL = { vigente:'Vigente', por_vencer:'Por vencer', vencido:'Vencido', sin_dato:'Sin dato' };

/* estado de un documento (fecha o presencia SÍ/NO) */
function docStatus(doc, dt){
  if(dt && dt.tipo==='presencia'){
    const has = !!(doc && doc.cumple);
    return { est: has?'vigente':'sin_dato', ven:null, dias:null, has };
  }
  const has = !!(doc && doc.realizado);
  const ven = docVence(doc, dt);
  const dias = diasDe(ven);
  return { est: has ? estadoDe(dias, true) : 'sin_dato', ven, dias, has };
}

/* resumen de una entidad: estado general + próximo vencimiento */
function evalEntidad(ent, cat){
  const dts = docTypesFor(cat).filter(dt=>dt.general!==false); // solo documentos de la Planilla Madre
  let peor=null, prox=null;
  dts.forEach(dt=>{
    const doc = ent.docs && ent.docs[dt.id];
    const {est, ven, dias} = docStatus(doc, dt);
    const ord = ESTADO_ORDEN[est];
    if(peor==null || ord < peor.ord) peor={est,ord};
    if(ven!=null){ if(prox==null || dias < prox.dias) prox={dt, ven, dias, est}; }
  });
  return { estado: peor?peor.est:'sin_dato', estadoOrden: peor?peor.ord:2, prox };
}

/* ---------- persistencia ---------- */
function save(){
  localStorage.setItem(LS_KEY, JSON.stringify(DB));
  if(CLOUD.enabled) cloudSaveDebounced();
}
function uid(){ return 'e'+Math.random().toString(36).slice(2,9); }
function ensureIds(){
  ['equipos','personas'].forEach(k=> DB[k].forEach(e=>{ if(!e.id) e.id=uid(); if(!e.docs) e.docs={}; }));
}
function emptyDB(){ return {docTypes:{tracto:[],rampla:[],persona:[]},equipos:[],personas:[]}; }
function normalizeDB(){
  DB.docTypes = DB.docTypes||{tracto:[],rampla:[],persona:[]};
  DB.equipos = DB.equipos||[]; DB.personas = DB.personas||[];
  if(!DB.clientes) DB.clientes = defaultClientes();   // migración Fase 2
  migrate();                                          // documentos obligatorios / esquema
  ensureIds();
}
function loadDB(){
  const raw = localStorage.getItem(LS_KEY);
  if(raw){ try{ DB=JSON.parse(raw); }catch(e){ DB=null; } }
  if(!DB){ DB = JSON.parse(JSON.stringify(window.SEED||emptyDB())); }
  normalizeDB(); save();
}

/* migraciones idempotentes de esquema */
function normNom(s){ return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().trim(); }
function ensureDocType(cat, id, nombre, vig, general){
  DB.docTypes[cat] = DB.docTypes[cat]||[];
  if(!DB.docTypes[cat].some(d=>d.id===id)) DB.docTypes[cat].push({id, nombre, vigenciaMeses:vig, general:general!==false});
}
function addReqByName(clienteNombre, cat, id){
  const c=(DB.clientes||[]).find(c=>normNom(c.nombre)===normNom(clienteNombre));
  if(!c) return;
  c.requisitos = c.requisitos||{}; c.requisitos[cat] = c.requisitos[cat]||[];
  if(!c.requisitos[cat].includes(id)) c.requisitos[cat].push(id);
}
function migrate(){
  const v = DB.schemaVersion||1;
  if(v<2){
    // documentos obligatorios que solo existían en las vistas de cliente (NO cuentan para el estado general)
    ensureDocType('tracto','padron','Padrón', null, false);
    ensureDocType('rampla','padron','Padrón', null, false);
    ensureDocType('tracto','rti','RTI', 12, false);
    ensureDocType('tracto','registro_nacional','Registro Nacional', 12, false);
    ensureDocType('tracto','certificado_mantencion_2','Certificado Mantención 2', 6, false);
    // marcarlos como requeridos según cada cliente
    addReqByName('SITRANS','tracto','padron');
    addReqByName('SITRANS','rampla','padron');
    addReqByName('MELON','tracto','rti');
    addReqByName('MELON','tracto','registro_nacional');
    addReqByName('AZA','tracto','certificado_mantencion_2');
    DB.schemaVersion = 2;
  }
  if(v<3){
    // el estado general se calcula solo con documentos de la Planilla Madre.
    // Los específicos de cliente quedan fuera del general (general:false).
    const soloCliente=['padron','rti','registro_nacional','certificado_mantencion_2'];
    ['tracto','rampla','persona'].forEach(cat=> (DB.docTypes[cat]||[]).forEach(d=>{
      if(d.general===undefined) d.general = !soloCliente.includes(d.id);
    }));
    DB.schemaVersion = 3;
  }
  if(v<4){
    // Padrón y Registro Nacional son documentos de "presencia" (SÍ/NO), no de fecha.
    const presencia=['padron','registro_nacional'];
    ['tracto','rampla','persona'].forEach(cat=> (DB.docTypes[cat]||[]).forEach(d=>{
      if(d.tipo===undefined) d.tipo = presencia.includes(d.id)?'presencia':'fecha';
    }));
    DB.schemaVersion = 4;
  }
  if(v<5){
    // traer a los equipos existentes las fechas/presencia de cliente desde el seed actual (sin sobrescribir lo cargado a mano)
    const clientDocs=['padron','rti','registro_nacional','certificado_mantencion_2'];
    const seedEq=(window.SEED&&window.SEED.equipos)||[];
    const byPat={}; seedEq.forEach(e=> byPat[normNom(e.patente)]=e);
    DB.equipos.forEach(e=>{
      const s=byPat[normNom(e.patente)]; if(!s||!s.docs) return;
      e.docs=e.docs||{};
      clientDocs.forEach(id=>{ if(s.docs[id]!==undefined && e.docs[id]===undefined) e.docs[id]=s.docs[id]; });
    });
    DB.schemaVersion = 5;
  }
  if(v<6){
    // módulo Estado de flota: conductor, estado operativo, notas, movimientos
    const seedEq=(window.SEED&&window.SEED.equipos)||[];
    const byPat={}; seedEq.forEach(e=> byPat[normNom(e.patente)]=e);
    DB.equipos.forEach(e=>{
      if(e.conductor===undefined){ const s=byPat[normNom(e.patente)]; e.conductor=(s&&s.conductor)||''; }
      if(e.estadoOp===undefined) e.estadoOp = e.conductor ? 'en_ruta' : 'en_patio';
      if(e.notas===undefined) e.notas='';
      if(!Array.isArray(e.movimientos)) e.movimientos=[];
    });
    DB.schemaVersion = 6;
  }
  if(v<7){
    // checklist real valorizado (por tipo) + posiciones de neumáticos + folios
    DB.checklistItems = defaultChecklistItems();
    DB.neumaticoPos = defaultNeumaticoPos();
    DB.folioSeq = DB.folioSeq || { tracto:1046, rampla:458 };
    DB.schemaVersion = 7;
  }
  if(v<8){
    // módulo Mantención por kilometraje
    if(!DB.mantConfig) DB.mantConfig = { intervaloDefault:50000, avisoKm:5000 };
    const seedEq=(window.SEED&&window.SEED.equipos)||[];
    const byPat={}; seedEq.forEach(e=> byPat[normNom(e.patente)]=e);
    DB.equipos.forEach(e=>{
      const s=byPat[normNom(e.patente)];
      if(e.mant===undefined) e.mant = (s&&s.mant) ? s.mant : {ultimoKm:null,ultimaFecha:null,intervalo:null,lugar:'',tipo:'',historial:[]};
      if(!e.km && s && s.km) e.km=s.km;
      if(!Array.isArray(e.mant.historial)) e.mant.historial=[];
    });
    DB.schemaVersion = 8;
  }
  if(v<9){
    // módulo Portería (control de ingreso/salida)
    if(!Array.isArray(DB.porteria)) DB.porteria = [];
    DB.schemaVersion = 9;
  }
  if(v<10){
    // módulo Combustible
    if(!Array.isArray(DB.combustible)) DB.combustible = [];
    DB.schemaVersion = 10;
  }
}
function defaultChecklistItems(){
  return {
    tracto:[
      ['Radio musical',80000],['Tacógrafo',500000],['Llave de rueda',8100],['Barrote',8100],['Gata',28800],
      ['Triángulo',10000],['Botiquín',14000],['Baliza azul / ámbar',15000],['Cuñas',8075],['Conos',7000],
      ['Extintor',29700],['Pértiga',30000],['Colchón',118860],['Eslingas',3357],['Chicharras',3357],
      ['Cubrecantos',671],['Candado',0],['Tarjeta TCT / Romana / NeoTac',0],['Dispositivos antirrobo',0]
    ].map((x,i)=>({id:'t'+(i+1),nombre:x[0],precio:x[1]})),
    rampla:[
      ['Cuerda',41360],['Carpa (8x10)',206015],['Poncho (4x16)',102400],['Eslingas (9mts)',3357],['Chicharras',3357],
      ['Canoas',2400],['Rueda de repuesto',168000],['Nylon',6296],['Precinto',10000],['Cubrecanto',671],
      ['Cadenas',35160],['Trinquetes',22800],['Cuerda de vida',80000],['Extintor',35100],['Candados',1500]
    ].map((x,i)=>({id:'r'+(i+1),nombre:x[0],precio:x[1]}))
  };
}
function defaultNeumaticoPos(){
  return { tracto:['1','2','3','4','5','6','7','8','9','10'],
           rampla:['11','12','13','14','15','16','17','18','19','20','21','22','23R','24R'] };
}
function itemsFor(tipo){ const c=DB.checklistItems; return (c && c[tipo]) ? c[tipo] : []; }
function money(n){ n=Number(n)||0; return '$'+n.toLocaleString('es-CL'); }
const OP_LABEL={ en_ruta:'En ruta', en_patio:'En patio', en_taller:'En taller' };
const NEU_EST=['','B','N','R','D','M','RE'];
const NEU_LABEL={B:'Bueno',N:'Nuevo',R:'Regular',D:'Deforme',M:'Malo',RE:'Reparar'};
function resetSeed(){ localStorage.removeItem(LS_KEY); DB=null; loadDB(); render(); toast('Datos restaurados desde la flota original','ok'); }

/* ---------- clientes / requisitos ---------- */
function resolveReq(cat, keywords){
  return docTypesFor(cat).filter(dt=>{
    const n=(dt.nombre+' '+dt.id).toLowerCase();
    return keywords.some(k=>n.includes(k));
  }).map(dt=>dt.id);
}
function defaultClientes(){
  const defs=[
    ['SQM',     ['tecnica','permiso','obligatorio','asetran','mantencion']],
    ['SITRANS', ['tecnica','permiso','obligatorio','padron']],
    ['MELÓN',   ['tecnica','emision','obligatorio','permiso','responsabilidad']],
    ['AZA',     ['tecnica','permiso','obligatorio','mantencion']],
  ];
  return defs.map(([nombre,ek])=>({
    id:uid(), nombre,
    requisitos:{ tracto:resolveReq('tracto',ek), rampla:resolveReq('rampla',ek) }
  }));
}
function findCliente(id){ return (DB.clientes||[]).find(c=>c.id===id); }
function reqIds(cli, cat){ return (cli && cli.requisitos && cli.requisitos[cat]) ? cli.requisitos[cat] : []; }

/* evalúa una entidad frente a los requisitos de un cliente */
function evalCliente(ent, cat, ids){
  const st = ids.map(id=>{
    const dt = findDt(cat,id) || {id,nombre:id,vigenciaMeses:null};
    const s = docStatus(ent.docs[id], dt);
    return { dt, est:s.est, ven:s.ven, dias:s.dias };
  });
  let overall = 'acreditado';
  if(st.some(s=>s.est==='vencido'||s.est==='sin_dato')) overall='no_acreditado';
  else if(st.some(s=>s.est==='por_vencer')) overall='por_vencer';
  if(!ids.length) overall='sin_req';
  return { st, overall };
}
const ACRED_LABEL = { acreditado:'Acreditado', por_vencer:'Por vencer', no_acreditado:'No acreditado', sin_req:'Sin requisitos' };

/* ---------- render ---------- */
function render(){
  $$('.tab').forEach(t=>t.classList.toggle('active', t.dataset.view===VIEW));
  if(VIEW==='config'){ $('#kpis').innerHTML=''; renderConfig(); return; }
  if(VIEW==='dashboard'){ renderDashboard(); return; }
  if(VIEW==='clientes'){ renderClientes(); return; }
  if(VIEW==='flota'){ renderFlota(); return; }
  if(VIEW==='mantencion'){ renderMantencion(); return; }
  if(VIEW==='reportes'){ renderReportes(); return; }
  if(VIEW==='porteria'){ renderPorteria(); return; }
  if(VIEW==='combustible'){ renderCombustible(); return; }
  renderKpis();
  renderTable();
}

/* ---------- Combustible ---------- */
let COMB = { q:'' };
function rendimientos(){
  // por patente, ordenar por km asc y calcular km/litro entre cargas consecutivas
  const byPat={};
  (DB.combustible||[]).forEach(c=>{ (byPat[normNom(c.patente)]=byPat[normNom(c.patente)]||[]).push(c); });
  const map={};
  Object.values(byPat).forEach(arr=>{
    arr.sort((a,b)=>(a.km||0)-(b.km||0));
    for(let i=1;i<arr.length;i++){ const d=(arr[i].km||0)-(arr[i-1].km||0); const l=arr[i].litros||0; if(d>0&&l>0) map[arr[i].id]=d/l; }
  });
  return map;
}
function renderCombustible(){
  const list=(DB.combustible||[]).slice().sort((a,b)=>(b.fecha||'').localeCompare(a.fecha||''));
  const rend=rendimientos();
  const hoyMes=toISO(today0()).slice(0,7);
  const litrosMes=list.filter(c=>(c.fecha||'').slice(0,7)===hoyMes).reduce((s,c)=>s+(c.litros||0),0);
  const rvals=Object.values(rend); const rprom=rvals.length?(rvals.reduce((a,b)=>a+b,0)/rvals.length):null;
  $('#kpis').innerHTML=`
    <div class="kpi"><div class="n">${list.length}</div><div class="l">cargas registradas</div></div>
    <div class="kpi"><div class="n">${Math.round(litrosMes).toLocaleString('es-CL')}</div><div class="l">litros este mes</div></div>
    <div class="kpi"><div class="n">${rprom?rprom.toFixed(2):'—'}</div><div class="l">km/litro promedio</div></div>`;

  const tractos=DB.equipos.filter(e=>e.tipo==='tracto').map(e=>e.patente).sort();
  const conds=conductoresList();
  const form=`<div class="cfgcard portform"><h3>Registrar carga de combustible</h3>
    <div class="formgrid">
      <div class="field"><label>Fecha</label><input type="date" class="input" id="cg_fecha" value="${toISO(today0())}"></div>
      <div class="field"><label>Tracto</label><input class="input" id="cg_pat" list="dl_tractos_c"></div>
      <div class="field"><label>Conductor</label><input class="input" id="cg_cond" list="dl_cond_c"></div>
      <div class="field"><label>Kilometraje</label><input type="number" min="0" class="input" id="cg_km"></div>
      <div class="field"><label>Litros</label><input type="number" min="0" step="0.1" class="input" id="cg_lit"></div>
      <div class="field"><label>N° Guía</label><input class="input" id="cg_guia"></div>
      <div class="field" style="grid-column:1/-1"><label>Observación</label><input class="input" id="cg_obs"></div>
    </div>
    <div style="margin-top:10px"><button class="btn primary" id="cg_save">Registrar carga</button></div>
    <datalist id="dl_tractos_c">${tractos.map(p=>`<option value="${esc(p)}">`).join('')}</datalist>
    <datalist id="dl_cond_c">${conds.map(c=>`<option value="${esc(c)}">`).join('')}</datalist></div>`;

  let filt=list.filter(c=>{ if(COMB.q){ const h=((c.patente||'')+' '+(c.conductor||'')).toLowerCase(); if(!h.includes(COMB.q.toLowerCase())) return false; } return true; });
  const filters=`<div class="toolbar"><h2>Cargas de combustible</h2>
    <input class="input search" id="cq" placeholder="Buscar tracto o conductor" value="${esc(COMB.q)}">
    <span class="count">${filt.length}</span></div>`;
  const body=filt.slice(0,200).map(c=>{
    const r=rend[c.id]; const rcls=r==null?'':(r<1.8?'m_vencida':(r>4?'m_proxima':'m_al_dia'));
    return `<tr>
      <td class="mono">${fmt(c.fecha)}</td><td><b>${esc(c.patente||'')}</b></td><td>${esc(c.conductor||'')}</td>
      <td class="mono">${c.km!=null?Number(c.km).toLocaleString('es-CL'):''}</td>
      <td class="mono">${c.litros!=null?Number(c.litros).toLocaleString('es-CL'):''}</td>
      <td>${r!=null?`<span class="badge ${rcls}">${r.toFixed(2)} km/l</span>`:'<span class="dias">—</span>'}</td>
      <td>${esc(c.guia||'')} <a href="#" class="cdel" data-id="${c.id}" title="Eliminar">✕</a></td></tr>`;
  }).join('');
  const table=filt.length?`<div class="tablewrap"><table><thead><tr><th>Fecha</th><th>Tracto</th><th>Conductor</th><th>Km</th><th>Litros</th><th>Rendimiento</th><th>Guía</th></tr></thead><tbody>${body}</tbody></table></div><p class="hint" style="margin-top:8px">🟢 rendimiento normal · 🔴 bajo (revisar posible fuga/robo) · 🟡 alto (revisar kilometraje).</p>`:`<div class="tablewrap"><div class="empty">Sin cargas aún. Registra la primera arriba.</div></div>`;
  $('#view').innerHTML=form+filters+table;

  $('#cg_save').onclick=registrarCarga;
  const cq=$('#cq'); if(cq) cq.oninput=()=>{COMB.q=cq.value;const p=cq.selectionStart;renderCombustible();const n=$('#cq');n.focus();n.setSelectionRange(p,p);};
  $$('.cdel').forEach(a=> a.onclick=ev=>{ ev.preventDefault(); if(confirm('¿Eliminar esta carga?')){ DB.combustible=DB.combustible.filter(x=>x.id!==a.dataset.id); save(); renderCombustible(); } });
}
function registrarCarga(){
  const km=parseFloat($('#cg_km').value), lit=parseFloat($('#cg_lit').value);
  const rec={ id:uid(), fecha:$('#cg_fecha').value||toISO(today0()), patente:$('#cg_pat').value.trim().toUpperCase(), conductor:$('#cg_cond').value.trim(),
    km:isNaN(km)?null:km, litros:isNaN(lit)?null:lit, guia:$('#cg_guia').value.trim(), obs:$('#cg_obs').value.trim() };
  if(!rec.patente){ toast('Ingresa el tracto','err'); return; }
  if(rec.litros==null||rec.litros<=0){ toast('Ingresa los litros','err'); return; }
  DB.combustible=DB.combustible||[]; DB.combustible.push(rec);
  // actualizar km del tracto si es mayor
  if(rec.km!=null){ const e=DB.equipos.find(x=>normNom(x.patente)===normNom(rec.patente)); if(e){ const cur=intKm(e.km)||0; if(rec.km>cur) e.km=String(rec.km); } }
  save(); renderCombustible(); toast('Carga registrada','ok');
}

/* ---------- Portería (control de ingreso/salida) ---------- */
let PORT = { q:'', tipo:'todos', guardia:'' };
function nowLocal(){ const d=new Date(); const p=n=>String(n).padStart(2,'0'); return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+'T'+p(d.getHours())+':'+p(d.getMinutes()); }
function fmtDT(s){ if(!s) return '—'; const m=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(s); if(!m) return s; return `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}`; }
function conductoresList(){ const set={}; DB.equipos.forEach(e=>{ if(e.conductor) set[e.conductor]=1; (e.movimientos||[]).forEach(m=>{ if(m.conductor) set[m.conductor]=1; }); }); return Object.keys(set).sort(); }
function dentroCount(){ const last={}; (DB.porteria||[]).slice().sort((a,b)=>(a.ts||'').localeCompare(b.ts||'')).forEach(p=>{ if(p.patente) last[normNom(p.patente)]=p.tipo; }); return Object.values(last).filter(t=>t==='entrada').length; }
function renderPorteria(){
  const log=(DB.porteria||[]).slice().sort((a,b)=>(b.ts||'').localeCompare(a.ts||''));
  const hoy=toISO(today0());
  const entradasHoy=log.filter(p=>p.tipo==='entrada'&&(p.ts||'').slice(0,10)===hoy).length;
  const salidasHoy=log.filter(p=>p.tipo==='salida'&&(p.ts||'').slice(0,10)===hoy).length;
  $('#kpis').innerHTML=`
    <div class="kpi green"><div class="n">${entradasHoy}</div><div class="l">Entradas hoy</div></div>
    <div class="kpi amber"><div class="n">${salidasHoy}</div><div class="l">Salidas hoy</div></div>
    <div class="kpi"><div class="n" style="color:var(--brand)">${dentroCount()}</div><div class="l">Equipos dentro</div></div>
    <div class="kpi"><div class="n">${log.length}</div><div class="l">Registros totales</div></div>`;

  const tractos=DB.equipos.filter(e=>e.tipo==='tracto').map(e=>e.patente).sort();
  const ramplas=DB.equipos.filter(e=>e.tipo==='rampla').map(e=>e.patente).sort();
  const conds=conductoresList();
  const form=`<div class="cfgcard portform">
    <h3>Registrar movimiento en portería</h3>
    <div class="formgrid">
      <div class="field"><label>Tipo</label><select class="input" id="pg_tipo"><option value="entrada">Entrada</option><option value="salida">Salida</option></select></div>
      <div class="field"><label>Fecha y hora</label><input type="datetime-local" class="input" id="pg_ts" value="${nowLocal()}"></div>
      <div class="field"><label>Conductor</label><input class="input" id="pg_cond" list="dl_cond" value=""></div>
      <div class="field"><label>Patente (tracto)</label><input class="input" id="pg_pat" list="dl_tractos"></div>
      <div class="field"><label>Rampla</label><input class="input" id="pg_rampla" list="dl_ramplas"></div>
      <div class="field"><label>Guardia</label><input class="input" id="pg_guardia" value="${esc(PORT.guardia)}"></div>
      <div class="field" style="grid-column:1/-1"><label>Observación</label><input class="input" id="pg_obs"></div>
    </div>
    <div style="margin-top:10px"><button class="btn primary" id="pg_save">Registrar</button></div>
    <datalist id="dl_tractos">${tractos.map(p=>`<option value="${esc(p)}">`).join('')}</datalist>
    <datalist id="dl_ramplas">${ramplas.map(p=>`<option value="${esc(p)}">`).join('')}</datalist>
    <datalist id="dl_cond">${conds.map(c=>`<option value="${esc(c)}">`).join('')}</datalist>
  </div>`;

  let list=log.filter(p=>{
    if(PORT.tipo!=='todos' && p.tipo!==PORT.tipo) return false;
    if(PORT.q){ const h=((p.conductor||'')+' '+(p.patente||'')+' '+(p.rampla||'')).toLowerCase(); if(!h.includes(PORT.q.toLowerCase())) return false; }
    return true;
  });
  const filters=`<div class="toolbar"><h2>Bitácora de portería</h2>
    <input class="input search" id="pq" placeholder="Buscar conductor o patente" value="${esc(PORT.q)}">
    <select class="input" id="ptipo"><option value="todos">Todos</option><option value="entrada">Entradas</option><option value="salida">Salidas</option></select>
    <span class="count">${list.length}</span></div>`;
  const body=list.slice(0,200).map(p=>`<tr>
    <td class="mono">${fmtDT(p.ts)}</td>
    <td><span class="badge ${p.tipo==='entrada'?'op_en_patio':'op_en_ruta'}">${p.tipo==='entrada'?'Entrada':'Salida'}</span></td>
    <td>${esc(p.conductor||'—')}</td><td><b>${esc(p.patente||'—')}</b></td><td>${esc(p.rampla||'')}</td>
    <td>${esc(p.guardia||'')}</td><td>${esc(p.obs||'')} <a href="#" class="pdel" data-id="${p.id}" title="Eliminar">✕</a></td></tr>`).join('');
  const table=list.length?`<div class="tablewrap"><table><thead><tr><th>Fecha/hora</th><th>Tipo</th><th>Conductor</th><th>Patente</th><th>Rampla</th><th>Guardia</th><th>Observación</th></tr></thead><tbody>${body}</tbody></table></div>`:`<div class="tablewrap"><div class="empty">Sin registros aún. Usa el formulario de arriba.</div></div>`;
  $('#view').innerHTML=form+filters+table;

  $('#pg_save').onclick=registrarPorteria;
  const pq=$('#pq'); if(pq) pq.oninput=()=>{PORT.q=pq.value;const c=pq.selectionStart;renderPorteria();const n=$('#pq');n.focus();n.setSelectionRange(c,c);};
  const pt=$('#ptipo'); if(pt){pt.value=PORT.tipo;pt.onchange=()=>{PORT.tipo=pt.value;renderPorteria();};}
  $$('.pdel').forEach(a=> a.onclick=ev=>{ ev.preventDefault(); if(confirm('¿Eliminar este registro?')){ DB.porteria=DB.porteria.filter(x=>x.id!==a.dataset.id); save(); renderPorteria(); } });
}
function registrarPorteria(){
  const tipo=$('#pg_tipo').value, ts=$('#pg_ts').value||nowLocal();
  const rec={ id:uid(), tipo, ts, conductor:$('#pg_cond').value.trim(), patente:$('#pg_pat').value.trim().toUpperCase(), rampla:$('#pg_rampla').value.trim().toUpperCase(), guardia:$('#pg_guardia').value.trim(), obs:$('#pg_obs').value.trim() };
  if(!rec.patente && !rec.conductor){ toast('Ingresa al menos patente o conductor','err'); return; }
  DB.porteria=DB.porteria||[]; DB.porteria.push(rec);
  PORT.guardia=rec.guardia;
  // sincronizar estado de flota del tracto
  if(rec.patente){ const e=DB.equipos.find(x=>normNom(x.patente)===normNom(rec.patente)); if(e){ e.estadoOp = tipo==='entrada'?'en_patio':'en_ruta'; if(tipo==='salida' && rec.conductor) e.conductor=rec.conductor; } }
  save(); renderPorteria(); render(); toast(tipo==='entrada'?'Entrada registrada':'Salida registrada','ok');
}

/* ---------- Reportes ---------- */
function daysAgoISO(n){ const d=today0(); d.setDate(d.getDate()-n); return toISO(d); }
let REP = { tipo:'movimientos', desde:daysAgoISO(30), hasta:null };
function repRows(){
  const desde=REP.desde||'0000-01-01', hasta=REP.hasta||toISO(today0());
  const inRange=f=> f && f>=desde && f<=hasta;
  if(REP.tipo==='mantenciones'){
    const rows=[];
    DB.equipos.forEach(e=>{ (e.mant&&e.mant.historial||[]).forEach(h=>{ if(inRange(h.fecha)) rows.push({fecha:h.fecha,patente:e.patente,km:h.km,lugar:h.lugar||'',tipo:h.tipo||'',obs:h.obs||''}); }); });
    rows.sort((a,b)=>(b.fecha||'').localeCompare(a.fecha||''));
    return {cols:['Fecha','Patente','Km','Lugar','Tipo','Observación'], rows:rows.map(r=>[fmt(r.fecha),r.patente,nkm(r.km),r.lugar,r.tipo,r.obs]), n:rows.length};
  }
  // movimientos (entregas/devoluciones)
  const rows=[];
  DB.equipos.forEach(e=>{ (e.movimientos||[]).forEach(m=>{ if(inRange(m.fecha)) rows.push({fecha:m.fecha,folio:m.folio||'',patente:e.patente,tipoEq:e.tipo,tipoMov:m.tipo,conductor:m.conductor||'',km:m.km||''}); }); });
  rows.sort((a,b)=>(b.fecha||'').localeCompare(a.fecha||''));
  return {cols:['Fecha','Folio','Patente','Equipo','Movimiento','Conductor','Km'],
    rows:rows.map(r=>[fmt(r.fecha),r.folio,r.patente,r.tipoEq==='tracto'?'Tracto':'Rampla',r.tipoMov==='entrega'?'Entrega':'Devolución',r.conductor,r.km]), n:rows.length};
}
function renderReportes(){
  const data=repRows();
  $('#kpis').innerHTML=`
    <div class="kpi"><div class="n">${data.n}</div><div class="l">registros</div></div>
    <div class="kpi"><div class="l" style="margin-top:0">Período</div><div class="n" style="font-size:15px">${fmt(REP.desde)} → ${fmt(REP.hasta||toISO(today0()))}</div></div>`;
  const filters=`<div class="toolbar">
    <h2>Reportes</h2>
    <select class="input" id="rtipo"><option value="movimientos">Entregas / Devoluciones</option><option value="mantenciones">Mantenciones</option></select>
    <label class="dias">Desde <input type="date" class="input" id="rdesde" value="${esc(REP.desde||'')}"></label>
    <label class="dias">Hasta <input type="date" class="input" id="rhasta" value="${esc(REP.hasta||toISO(today0()))}"></label>
    <span class="spacer" style="flex:1"></span>
    <button class="btn sm" id="rcsv">Exportar CSV</button>
    <button class="btn sm" id="rprint">🖨️ Imprimir</button></div>`;
  const head=`<tr>${data.cols.map(c=>`<th>${esc(c)}</th>`).join('')}</tr>`;
  const body=data.rows.slice(0,300).map(r=>`<tr>${r.map((c,i)=>`<td${i===0||i===6?' class="mono"':''}>${esc(c)}</td>`).join('')}</tr>`).join('');
  $('#view').innerHTML=filters+(data.n?`<div class="tablewrap"><table><thead>${head}</thead><tbody>${body}</tbody></table></div>${data.n>300?`<p class="hint" style="margin-top:8px">Mostrando 300 de ${data.n}. Acota el período o exporta el CSV completo.</p>`:''}`:`<div class="tablewrap"><div class="empty">Sin registros en este período.</div></div>`);
  const t=$('#rtipo'); t.value=REP.tipo; t.onchange=()=>{REP.tipo=t.value;renderReportes();};
  $('#rdesde').onchange=e=>{REP.desde=e.target.value;renderReportes();};
  $('#rhasta').onchange=e=>{REP.hasta=e.target.value;renderReportes();};
  $('#rcsv').onclick=()=>{ const csv='﻿'+[data.cols].concat(data.rows).map(r=>r.map(csvCell).join(';')).join('\n'); download('reporte-'+REP.tipo+'-'+toISO(today0())+'.csv', csv, 'text/csv'); toast('CSV descargado','ok'); };
  $('#rprint').onclick=()=>printReporte(data);
}
function printReporte(data){
  const w=window.open('','_blank'); if(!w){ toast('Permite ventanas emergentes','err'); return; }
  const title=REP.tipo==='mantenciones'?'Mantenciones':'Entregas y Devoluciones';
  const rows=data.rows.map(r=>`<tr>${r.map(c=>`<td>${esc(c)}</td>`).join('')}</tr>`).join('');
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Reporte</title>
   <style>body{font:12px Arial;margin:18px}.brand{font-weight:800;color:#1f4e79;font-size:18px}h1{font-size:15px;margin:2px 0}
   table{border-collapse:collapse;width:100%;margin-top:8px}th,td{border:1px solid #888;padding:3px 6px;font-size:11px}th{background:#1f4e79;color:#fff;text-align:left}</style></head>
   <body><div class="brand">TZAMORA</div><h1>Reporte de ${title}</h1>
   <div>Período: ${fmt(REP.desde)} al ${fmt(REP.hasta||toISO(today0()))} · ${data.n} registros</div>
   <table><thead><tr>${data.cols.map(c=>`<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></body></html>`);
  w.document.close(); w.focus(); setTimeout(()=>{try{w.print();}catch(x){}},400);
}

/* ---------- Mantención por kilometraje ---------- */
let MANT = { estado:'todos', q:'' };
let MANT_ID = null;
const MANT_LABEL = { vencida:'Vencida', proxima:'Próxima', al_dia:'Al día', sin_dato:'Sin dato' };
function intKm(v){ const n=parseInt(String(v==null?'':v).replace(/[^\d-]/g,''),10); return isNaN(n)?null:n; }
function evalMant(e){
  const m=e.mant||{}; const kmAct=intKm(e.km);
  const inter=m.intervalo||((DB.mantConfig&&DB.mantConfig.intervaloDefault)||50000);
  const prox=(m.ultimoKm!=null)?(m.ultimoKm+inter):null;
  const faltante=(prox!=null && kmAct!=null)?(prox-kmAct):null;
  const aviso=(DB.mantConfig&&DB.mantConfig.avisoKm)||5000;
  let est='sin_dato';
  if(faltante!=null) est = faltante<0?'vencida':(faltante<=aviso?'proxima':'al_dia');
  return { kmAct, inter, prox, faltante, est };
}
function nkm(n){ return n==null?'—':Number(n).toLocaleString('es-CL'); }
function renderMantencion(){
  const eq=DB.equipos.filter(e=>e.tipo==='tracto');
  const rows=eq.map(e=>({e, ...evalMant(e)}));
  const c={total:rows.length,vencida:0,proxima:0,al_dia:0,sin_dato:0};
  rows.forEach(r=>c[r.est]++);
  $('#kpis').innerHTML=`
    <div class="kpi"><div class="n">${c.total}</div><div class="l">tractos</div></div>
    <div class="kpi red"><div class="n">${c.vencida}</div><div class="l">Mantención vencida</div></div>
    <div class="kpi amber"><div class="n">${c.proxima}</div><div class="l">Próxima (≤${nkm((DB.mantConfig&&DB.mantConfig.avisoKm)||5000)} km)</div></div>
    <div class="kpi green"><div class="n">${c.al_dia}</div><div class="l">Al día</div></div>`;

  let list=rows.filter(r=>{
    if(MANT.estado!=='todos' && r.est!==MANT.estado) return false;
    if(MANT.q && !(r.e.patente.toLowerCase().includes(MANT.q.toLowerCase()))) return false;
    return true;
  });
  const ord={vencida:0,proxima:1,sin_dato:2,al_dia:3};
  list.sort((a,b)=> (ord[a.est]-ord[b.est]) || ((a.faltante==null?9e9:a.faltante)-(b.faltante==null?9e9:b.faltante)));

  const filters=`<div class="toolbar"><h2>Mantención (tractos)</h2>
    <input class="input search" id="mtq" placeholder="Buscar patente" value="${esc(MANT.q)}">
    <select class="input" id="mtestado"><option value="todos">Todos</option><option value="vencida">Vencidas</option><option value="proxima">Próximas</option><option value="al_dia">Al día</option><option value="sin_dato">Sin dato</option></select>
    <span class="count">${list.length} de ${eq.length}</span></div>`;
  const body=list.map(r=>{
    const m=r.e.mant||{};
    const falt = r.faltante==null?'—':(r.faltante<0?('-'+nkm(-r.faltante)):nkm(r.faltante));
    return `<tr data-id="${r.e.id}">
      <td><b>${esc(r.e.patente)}</b></td>
      <td class="mono">${nkm(r.kmAct)}</td>
      <td class="mono">${nkm(m.ultimoKm)}${m.ultimaFecha?(' <span class="dias">· '+fmt(m.ultimaFecha)+'</span>'):''}</td>
      <td class="mono">${nkm(r.prox)}</td>
      <td><span class="badge m_${r.est}">${MANT_LABEL[r.est]}</span> <span class="dias">${falt!=='—'?falt+' km':''}</span></td>
      <td>${esc(m.lugar||'')}</td></tr>`;
  }).join('');
  $('#view').innerHTML=filters+(list.length?`<div class="tablewrap"><table><thead><tr><th>Patente</th><th>Km actual</th><th>Última mantención</th><th>Próxima (km)</th><th>Faltan</th><th>Lugar</th></tr></thead><tbody>${body}</tbody></table></div>`:`<div class="tablewrap"><div class="empty">Sin resultados.</div></div>`);

  const q=$('#mtq'); if(q) q.oninput=()=>{MANT.q=q.value;const p=q.selectionStart;renderMantencion();const n=$('#mtq');n.focus();n.setSelectionRange(p,p);};
  const s=$('#mtestado'); if(s){s.value=MANT.estado;s.onchange=()=>{MANT.estado=s.value;renderMantencion();};}
  $$('#view tbody tr').forEach(tr=> tr.onclick=()=>openMantDetail(tr.dataset.id));
}
function openMantDetail(id){
  const e=DB.equipos.find(x=>x.id===id); if(!e) return;
  MANT_ID=id; $('#mtTitle').textContent=e.patente+' · Mantención';
  renderMantBody(); $('#mantOverlay').classList.add('open');
}
function renderMantBody(){
  const e=DB.equipos.find(x=>x.id===MANT_ID); if(!e) return;
  e.mant=e.mant||{historial:[]}; const m=e.mant; const ev=evalMant(e);
  const hist=(m.historial||[]).slice().sort((a,b)=>(b.fecha||'').localeCompare(a.fecha||''));
  $('#mtBody').innerHTML=`
    <div class="mantsumm">
      <div><span class="l">Km actual</span><b>${nkm(ev.kmAct)}</b></div>
      <div><span class="l">Próxima mantención</span><b>${nkm(ev.prox)} km</b></div>
      <div><span class="l">Faltan</span><b class="m_${ev.est}txt">${ev.faltante==null?'—':(ev.faltante<0?('-'+nkm(-ev.faltante)):nkm(ev.faltante))+' km'}</b></div>
      <div><span class="l">Estado</span>${'<span class="badge m_'+ev.est+'">'+MANT_LABEL[ev.est]+'</span>'}</div>
    </div>
    <div class="formgrid" style="margin-top:6px">
      <div class="field"><label>Km actual</label><input class="input" id="mt_km" value="${esc(e.km||'')}"></div>
      <div class="field"><label>Intervalo (km)</label><input class="input" id="mt_inter" value="${esc(m.intervalo||'')}" placeholder="${(DB.mantConfig&&DB.mantConfig.intervaloDefault)||50000}"></div>
      <div class="field"><label>Último km mantención</label><input class="input" id="mt_ultkm" value="${esc(m.ultimoKm||'')}"></div>
      <div class="field"><label>Fecha última</label><input type="date" class="input" id="mt_ultfec" value="${esc(m.ultimaFecha||'')}"></div>
    </div>

    <div class="section-title">Registrar mantención realizada</div>
    <div class="formgrid">
      <div class="field"><label>Fecha</label><input type="date" class="input" id="mn_fecha" value="${toISO(today0())}"></div>
      <div class="field"><label>Kilometraje</label><input class="input" id="mn_km" value="${esc(e.km||'')}"></div>
      <div class="field"><label>Lugar</label><input class="input" id="mn_lugar" value="${esc(m.lugar||'')}"></div>
      <div class="field"><label>Tipo</label><input class="input" id="mn_tipo" value="${esc(m.tipo||'')}"></div>
    </div>
    <div class="field" style="margin-top:6px"><label>Observación</label><input class="input" id="mn_obs"></div>
    <button class="btn primary" id="mn_save" style="margin-top:10px">Registrar mantención</button>

    <div class="section-title">Historial (${hist.length})</div>
    <div class="histlist">${hist.length?hist.map(h=>`<div class="histrow"><div><b>${fmt(h.fecha)}</b> · ${nkm(h.km)} km${h.lugar?(' · '+esc(h.lugar)):''}${h.tipo?(' · '+esc(h.tipo)):''}</div>${h.obs?('<div class="hint">'+esc(h.obs)+'</div>'):''}</div>`).join(''):'<div class="hint">Sin mantenciones registradas.</div>'}</div>`;

  $('#mt_km').onchange=()=>{e.km=$('#mt_km').value.trim(); save(); renderMantBody(); render();};
  $('#mt_inter').onchange=()=>{m.intervalo=intKm($('#mt_inter').value); save(); renderMantBody(); render();};
  $('#mt_ultkm').onchange=()=>{m.ultimoKm=intKm($('#mt_ultkm').value); save(); renderMantBody(); render();};
  $('#mt_ultfec').onchange=()=>{m.ultimaFecha=$('#mt_ultfec').value||null; save(); renderMantBody();};
  $('#mn_save').onclick=registrarMantencion;
}
function registrarMantencion(){
  const e=DB.equipos.find(x=>x.id===MANT_ID); if(!e) return; e.mant=e.mant||{historial:[]};
  const km=intKm($('#mn_km').value), fecha=$('#mn_fecha').value||toISO(today0());
  const h={id:uid(),fecha,km,lugar:$('#mn_lugar').value.trim(),tipo:$('#mn_tipo').value.trim(),obs:$('#mn_obs').value.trim()};
  e.mant.historial=e.mant.historial||[]; e.mant.historial.push(h);
  if(km!=null){ e.mant.ultimoKm=km; e.km=String(km); }
  e.mant.ultimaFecha=fecha; if(h.lugar) e.mant.lugar=h.lugar; if(h.tipo) e.mant.tipo=h.tipo;
  save(); renderMantBody(); render(); toast('Mantención registrada','ok');
}

/* ---------- Estado de la flota (operativo) ---------- */
let FLOTA = { tipo:'todos', op:'todos', q:'' };
let FLOTA_ID = null;
let flSign = null;   // firma digital en curso (dataURL)
function ultimoMov(e){ const m=(e.movimientos||[]); return m.length? m.slice().sort((a,b)=>(b.fecha||'').localeCompare(a.fecha||''))[0] : null; }
function renderFlota(){
  const eq=DB.equipos;
  const c={total:eq.length,en_ruta:0,en_patio:0,en_taller:0};
  eq.forEach(e=>{ const s=e.estadoOp||'en_patio'; c[s]=(c[s]||0)+1; });
  $('#kpis').innerHTML=`
    <div class="kpi"><div class="n">${c.total}</div><div class="l">equipos</div></div>
    <div class="kpi" style="--x:1"><div class="n" style="color:var(--brand)">${c.en_ruta}</div><div class="l">En ruta</div></div>
    <div class="kpi green"><div class="n">${c.en_patio}</div><div class="l">En patio</div></div>
    <div class="kpi amber"><div class="n">${c.en_taller}</div><div class="l">En taller</div></div>`;

  let rows=eq.filter(e=>{
    if(FLOTA.tipo!=='todos' && e.tipo!==FLOTA.tipo) return false;
    if(FLOTA.op!=='todos' && (e.estadoOp||'en_patio')!==FLOTA.op) return false;
    if(FLOTA.q){ const h=(e.patente+' '+(e.conductor||'')).toLowerCase(); if(!h.includes(FLOTA.q.toLowerCase())) return false; }
    return true;
  });
  rows.sort((a,b)=> (a.patente||'').localeCompare(b.patente||''));

  const filters=`<div class="toolbar">
    <h2>Estado de la flota</h2>
    <input class="input search" id="flq" placeholder="Buscar patente o conductor" value="${esc(FLOTA.q)}">
    <select class="input" id="fltipo"><option value="todos">Todos los tipos</option><option value="tracto">Tractos</option><option value="rampla">Ramplas</option></select>
    <select class="input" id="flop"><option value="todos">Todos los estados</option><option value="en_ruta">En ruta</option><option value="en_patio">En patio</option><option value="en_taller">En taller</option></select>
    <span class="count">${rows.length} de ${eq.length}</span></div>`;

  const body=rows.map(e=>{
    const m=ultimoMov(e); const op=e.estadoOp||'en_patio';
    return `<tr data-id="${e.id}">
      <td><b>${esc(e.patente)}</b></td>
      <td><span class="pilltipo">${e.tipo==='tracto'?'Tracto':'Rampla'}</span></td>
      <td>${esc(e.conductor||'—')}</td>
      <td><span class="badge op_${op}">${OP_LABEL[op]||op}</span></td>
      <td class="dias">${m?(m.tipo==='entrega'?'Entrega':'Devolución')+' · '+fmt(m.fecha):'—'}</td>
      <td>${e.notas?'<span title="'+esc(e.notas)+'">📝</span>':''}</td></tr>`;
  }).join('');
  const table=rows.length?`<div class="tablewrap"><table><thead><tr><th>Patente</th><th>Tipo</th><th>Conductor actual</th><th>Estado</th><th>Último movimiento</th><th>Notas</th></tr></thead><tbody>${body}</tbody></table></div>`
    :`<div class="tablewrap"><div class="empty">Sin resultados.</div></div>`;
  $('#view').innerHTML=filters+table;

  const fq=$('#flq'); if(fq) fq.oninput=()=>{FLOTA.q=fq.value;const p=fq.selectionStart;renderFlota();const n=$('#flq');n.focus();n.setSelectionRange(p,p);};
  const ft=$('#fltipo'); if(ft){ft.value=FLOTA.tipo;ft.onchange=()=>{FLOTA.tipo=ft.value;renderFlota();};}
  const fo=$('#flop'); if(fo){fo.value=FLOTA.op;fo.onchange=()=>{FLOTA.op=fo.value;renderFlota();};}
  $$('#view tbody tr').forEach(tr=> tr.onclick=()=>openFlotaDetail(tr.dataset.id));
}
function openFlotaDetail(id){
  const e=DB.equipos.find(x=>x.id===id); if(!e) return;
  FLOTA_ID=id; flSign=null;
  $('#flTitle').textContent=e.patente+' · '+(e.tipo==='tracto'?'Tracto':'Rampla');
  renderFlotaBody();
  $('#flotaOverlay').classList.add('open');
}
function nextFolio(tipo){ const p=tipo==='tracto'?'F-':'R-'; const n=((DB.folioSeq&&DB.folioSeq[tipo])||0)+1; return p+n; }
function renderFlotaBody(){
  const e=DB.equipos.find(x=>x.id===FLOTA_ID); if(!e) return;
  const items=itemsFor(e.tipo);
  const pos=(DB.neumaticoPos&&DB.neumaticoPos[e.tipo])||[];
  const hist=(e.movimientos||[]).slice().sort((a,b)=>(b.fecha||'').localeCompare(a.fecha||''));
  $('#flBody').innerHTML=`
    <div class="formgrid">
      <div class="field"><label>Estado</label><select class="input" id="fl_estado">
        <option value="en_patio"${e.estadoOp==='en_patio'?' selected':''}>En patio</option>
        <option value="en_ruta"${e.estadoOp==='en_ruta'?' selected':''}>En ruta</option>
        <option value="en_taller"${e.estadoOp==='en_taller'?' selected':''}>En taller</option></select></div>
      <div class="field"><label>Conductor actual</label><input class="input" id="fl_conductor" value="${esc(e.conductor||'')}"></div>
      <div class="field"><label>Kilometraje</label><input class="input" id="fl_km" value="${esc(e.km||'')}"></div>
    </div>
    <div class="field" style="margin-top:8px"><label>Notas del equipo</label><textarea class="input" id="fl_notas" rows="2" style="width:100%;resize:vertical">${esc(e.notas||'')}</textarea></div>

    <div class="section-title">Registrar entrega / devolución</div>
    <div class="formgrid">
      <div class="field"><label>Tipo</label><select class="input" id="mv_tipo">
        <option value="entrega">Entrega (sale con conductor)</option>
        <option value="devolucion">Devolución (vuelve al patio)</option></select></div>
      <div class="field"><label>N° Folio</label><input class="input" id="mv_folio" value="${esc(nextFolio(e.tipo))}"></div>
      <div class="field"><label>Fecha</label><input type="date" class="input" id="mv_fecha" value="${toISO(today0())}"></div>
      <div class="field"><label>Conductor</label><input class="input" id="mv_conductor" value="${esc(e.conductor||'')}"></div>
      <div class="field"><label>Guardia</label><input class="input" id="mv_guardia"></div>
      <div class="field"><label>Inspector / Jefe de patio</label><input class="input" id="mv_inspector"></div>
      <div class="field"><label>Kilometraje</label><input class="input" id="mv_km" value="${esc(e.km||'')}"></div>
    </div>
    <div class="section-title" style="margin-top:8px">Inventario entregado — qué lleva el equipo</div>
    <div class="tablewrap"><table class="mvtable"><thead><tr><th>Elemento</th><th>Precio</th><th>Cant.</th><th>Total</th><th>Devuelta</th><th>Observación</th></tr></thead>
      <tbody id="mv_items">${items.length?items.map(it=>`<tr>
        <td>${esc(it.nombre)}</td>
        <td class="mono">${money(it.precio)}</td>
        <td><input class="input mv-cant" data-id="${it.id}" data-precio="${it.precio}" type="number" min="0" style="width:64px"></td>
        <td class="mono mv-tot" data-id="${it.id}">$0</td>
        <td><input class="input mv-dev" data-id="${it.id}" type="number" min="0" style="width:64px"></td>
        <td><input class="input mv-obs" data-id="${it.id}" placeholder="obs"></td></tr>`).join('')
        :'<tr><td colspan="6" class="hint">Define items en Configuración.</td></tr>'}</tbody>
      <tfoot><tr><td colspan="3" style="text-align:right"><b>Total avaluado</b></td><td class="mono" id="mv_grand"><b>$0</b></td><td colspan="2"></td></tr></tfoot>
    </table></div>
    <div class="section-title" style="margin-top:8px">Neumáticos <span class="hint">(B bueno · N nuevo · R regular · D deforme · M malo · RE reparar)</span></div>
    <div class="tablewrap"><table class="mvtable" id="mv_neu"><thead><tr><th>Posición</th><th>Estado</th><th>Marca / Código</th></tr></thead><tbody>
      ${pos.map(p=>`<tr><td><b>${esc(p)}</b></td><td><select class="input neu-est" data-pos="${esc(p)}">${NEU_EST.map(o=>`<option value="${o}">${o||'—'}</option>`).join('')}</select></td><td><input class="input neu-cod" data-pos="${esc(p)}"></td></tr>`).join('')}
    </tbody></table></div>
    <div class="field" style="margin-top:8px"><label>Observaciones generales</label><textarea class="input" id="mv_obs" rows="2" style="width:100%;resize:vertical"></textarea></div>
    <div class="section-title">Firma del conductor <span class="hint">(firma con el dedo o el mouse)</span></div>
    <canvas id="sigpad" class="sigpad" width="600" height="150"></canvas>
    <div style="margin-top:6px"><button class="btn sm" id="sigclear" type="button">Limpiar firma</button></div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px">
      <button class="btn primary" id="mv_save">Registrar movimiento</button>
      <button class="btn" id="mv_print">🖨️ Imprimir para el conductor</button>
    </div>

    <div class="section-title">Historial de movimientos (${hist.length})</div>
    <div class="histlist">${hist.length?hist.map(m=>{
      const nOk=Object.keys(m.items||{}).length;
      const obs=Object.entries(m.items||{}).filter(([k,v])=>v.obs).map(([k,v])=>{const it=(items||[]).find(i=>i.id===k);return (it?it.nombre:k)+': '+v.obs;});
      return `<div class="histrow">
        <div><span class="movtag ${m.tipo}">${m.tipo==='entrega'?'Entrega':'Devolución'}</span> ${m.folio?('<b>'+esc(m.folio)+'</b> · '):''}${fmt(m.fecha)} · ${esc(m.conductor||'—')}${m.km?(' · '+esc(m.km)+' km'):''}</div>
        <div class="hint">${nOk} ítems${m.obs?(' · '+esc(m.obs)):''}${obs.length?(' · ⚠ '+esc(obs.join(' | '))):''} <a href="#" class="reprint" data-mid="${m.id}">🖨️ reimprimir</a></div></div>`;
    }).join(''):'<div class="hint">Sin movimientos registrados aún.</div>'}</div>`;

  $('#fl_estado').onchange=()=>{e.estadoOp=$('#fl_estado').value; save(); toast('Estado actualizado','ok'); render();};
  $('#fl_conductor').onchange=()=>{e.conductor=$('#fl_conductor').value.trim(); save(); render();};
  $('#fl_km').onchange=()=>{e.km=$('#fl_km').value.trim(); save();};
  $('#fl_notas').onchange=()=>{e.notas=$('#fl_notas').value; save(); render();};
  $$('#mv_items .mv-cant').forEach(inp=> inp.oninput=updateTotals);
  $('#mv_save').onclick=registrarMovimiento;
  $('#mv_print').onclick=()=>printChecklist(gatherMovement(e));
  $$('.reprint').forEach(a=> a.onclick=ev=>{ ev.preventDefault(); const m=(e.movimientos||[]).find(x=>x.id===a.dataset.mid); if(m) printChecklist(m); });
  const sc=$('#sigclear'); if(sc) sc.onclick=()=>{ flSign=null; initSigPad(); };
  updateTotals(); initSigPad();
}
function initSigPad(){
  const c=document.getElementById('sigpad'); if(!c) return;
  const ctx=c.getContext('2d');
  ctx.clearRect(0,0,c.width,c.height);
  ctx.lineWidth=2.2; ctx.lineJoin='round'; ctx.lineCap='round'; ctx.strokeStyle='#111';
  if(flSign){ const img=new Image(); img.onload=()=>ctx.drawImage(img,0,0,c.width,c.height); img.src=flSign; }
  let drawing=false, last=null;
  const pos=e=>{ const r=c.getBoundingClientRect(); return { x:(e.clientX-r.left)*(c.width/r.width), y:(e.clientY-r.top)*(c.height/r.height) }; };
  c.onpointerdown=e=>{ drawing=true; last=pos(e); try{c.setPointerCapture(e.pointerId);}catch(x){} };
  c.onpointermove=e=>{ if(!drawing)return; const p=pos(e); ctx.beginPath(); ctx.moveTo(last.x,last.y); ctx.lineTo(p.x,p.y); ctx.stroke(); last=p; };
  const end=()=>{ if(drawing){ drawing=false; flSign=c.toDataURL('image/png'); } };
  c.onpointerup=end; c.onpointerleave=end;
}
function updateTotals(){
  let grand=0;
  $$('#mv_items .mv-cant').forEach(inp=>{ const cant=parseFloat(inp.value)||0; const precio=parseFloat(inp.dataset.precio)||0; const tot=cant*precio; grand+=tot; const cell=$('#mv_items .mv-tot[data-id="'+inp.dataset.id+'"]'); if(cell) cell.textContent=money(tot); });
  const g=$('#mv_grand'); if(g) g.innerHTML='<b>'+money(grand)+'</b>';
}
function gatherMovement(e){
  const items={};
  $$('#mv_items .mv-cant').forEach(inp=>{ const id=inp.dataset.id; const row=inp.closest('tr'); const dev=row.querySelector('.mv-dev'), obs=row.querySelector('.mv-obs'); const cant=parseFloat(inp.value)||0; const devv=parseFloat(dev&&dev.value)||0; const obsv=obs?obs.value.trim():''; if(cant||devv||obsv) items[id]={cant,dev:devv,obs:obsv}; });
  const neumaticos={};
  $$('#mv_neu .neu-est').forEach(sel=>{ const p=sel.dataset.pos; const cod=$('#mv_neu .neu-cod[data-pos="'+p+'"]'); const codv=cod?cod.value.trim():''; if(sel.value||codv) neumaticos[p]={estado:sel.value,codigo:codv}; });
  return { tipo:$('#mv_tipo').value, folio:$('#mv_folio').value.trim(), fecha:$('#mv_fecha').value||toISO(today0()),
    conductor:$('#mv_conductor').value.trim(), guardia:$('#mv_guardia').value.trim(), inspector:$('#mv_inspector').value.trim(),
    km:$('#mv_km').value.trim(), patente:e.patente, tipoEquipo:e.tipo, items, neumaticos, obs:$('#mv_obs').value.trim(), firma:flSign||null };
}
function registrarMovimiento(){
  const e=DB.equipos.find(x=>x.id===FLOTA_ID); if(!e) return;
  const mov=gatherMovement(e); mov.id=uid();
  e.movimientos=e.movimientos||[]; e.movimientos.push(mov);
  if(mov.tipo==='entrega'){ e.conductor=mov.conductor; e.estadoOp='en_ruta'; } else { e.estadoOp='en_patio'; e.conductor=''; }
  if(mov.km) e.km=mov.km;
  if(DB.folioSeq && DB.folioSeq[e.tipo]!==undefined) DB.folioSeq[e.tipo]++;
  flSign=null;
  save(); renderFlotaBody(); render(); toast(mov.tipo==='entrega'?'Entrega registrada':'Devolución registrada','ok');
}
function printChecklist(mov){
  const e=DB.equipos.find(x=>x.id===FLOTA_ID)||{};
  const w=window.open('','_blank');
  if(!w){ toast('Permite ventanas emergentes para imprimir','err'); return; }
  w.document.write(buildPrintHTML(e, mov)); w.document.close(); w.focus();
  setTimeout(()=>{ try{ w.print(); }catch(x){} }, 500);
}
function buildPrintHTML(e, mov){
  const tipo=e.tipo||mov.tipoEquipo||'tracto';
  const items=itemsFor(tipo);
  const pos=(DB.neumaticoPos&&DB.neumaticoPos[tipo])||[];
  let grand=0;
  const rows=items.map(it=>{ const v=(mov.items||{})[it.id]||{}; const cant=v.cant||0; const tot=cant*it.precio; grand+=tot;
    return `<tr><td>${esc(it.nombre)}</td><td class="r">${money(it.precio)}</td><td class="c">${cant||''}</td><td class="r">${cant?money(tot):''}</td><td class="c">${v.dev||''}</td><td>${esc(v.obs||'')}</td></tr>`; }).join('');
  const neu=pos.map(p=>{ const v=(mov.neumaticos||{})[p]||{}; return `<tr><td class="c">${esc(p)}</td><td class="c">${esc(v.estado||'')}</td><td>${esc(v.codigo||'')}</td></tr>`; }).join('');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Checklist ${esc(mov.folio||'')}</title>
  <style>
    *{box-sizing:border-box} body{font:12px Arial,Helvetica,sans-serif;color:#000;margin:18px}
    h1{font-size:15px;margin:0} .sub{font-size:11px;color:#333}
    .hd{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #1f4e79;padding-bottom:6px;margin-bottom:8px}
    .brand{font-weight:800;font-size:18px;color:#1f4e79;letter-spacing:1px}
    table{border-collapse:collapse;width:100%;margin:6px 0} th,td{border:1px solid #888;padding:3px 5px;font-size:11px}
    th{background:#1f4e79;color:#fff;text-align:left} td.r{text-align:right} td.c{text-align:center}
    tfoot td{font-weight:700;background:#eef}
    .grid{display:flex;gap:10px;flex-wrap:wrap;margin:4px 0} .fld{border:1px solid #888;padding:3px 6px;font-size:11px;min-width:150px}
    .fld b{color:#1f4e79}
    .two{display:flex;gap:12px;align-items:flex-start} .two>div{flex:1}
    .decl{font-size:10.5px;margin-top:8px;border:1px solid #888;padding:6px}
    .sign{display:flex;gap:14px;margin-top:30px} .sign>div{flex:1;text-align:center} .sign img{display:block;margin:0 auto 2px} .sign .sl{border-top:1px solid #000;padding-top:3px;font-size:10.5px}
    @media print{body{margin:8mm}}
  </style></head><body>
  <div class="hd"><div><div class="brand">TZAMORA</div><h1>Checklist — Registro de Entrega y Recepción: ${tipo==='tracto'?'TRACTO':'RAMPLA'}</h1>
    <div class="sub">${mov.tipo==='entrega'?'ENTREGA':'DEVOLUCIÓN'}</div></div>
    <div style="text-align:right"><div class="fld"><b>N° Folio:</b> ${esc(mov.folio||'')}</div><div class="fld"><b>Fecha:</b> ${fmt(mov.fecha)}</div></div></div>
  <div class="grid">
    <div class="fld"><b>Conductor:</b> ${esc(mov.conductor||'')}</div>
    <div class="fld"><b>Patente:</b> ${esc(e.patente||'')}</div>
    <div class="fld"><b>Kilometraje:</b> ${esc(mov.km||'')}</div>
    <div class="fld"><b>Guardia:</b> ${esc(mov.guardia||'')}</div>
    <div class="fld"><b>Inspector / Jefe de patio:</b> ${esc(mov.inspector||'')}</div>
  </div>
  <div class="two">
    <div>
      <table><thead><tr><th>Elemento</th><th>Precio</th><th>Cant.</th><th>Total</th><th>Dev.</th><th>Observación</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td colspan="3" class="r">TOTAL AVALUADO</td><td class="r">${money(grand)}</td><td colspan="2"></td></tr></tfoot></table>
    </div>
    <div style="max-width:230px">
      <table><thead><tr><th>Pos</th><th>Est.</th><th>Código</th></tr></thead><tbody>${neu}</tbody></table>
    </div>
  </div>
  <div class="fld" style="width:100%"><b>Observaciones:</b> ${esc(mov.obs||'')}</div>
  <div class="decl">El conductor declara haber recibido conforme los artículos, y se compromete a cuidar y proteger los artículos señalados, los cuales están avaluados en <b>${money(grand)}</b>.</div>
  <div class="sign"><div>${mov.firma?`<img src="${mov.firma}" style="max-height:46px;max-width:180px">`:'&nbsp;'}<div class="sl">Firma Conductor</div></div><div><div class="sl">Firma Guardia</div></div><div><div class="sl">Firma Supervisor</div></div></div>
  </body></html>`;
}

/* ---------- dashboard (panel del gerente) ---------- */
let DASH = { win:'pend' }; // pend = vencidos + por vencer
function renderDashboard(){
  const equipos = DB.equipos;
  const genRows = equipos.map(e=>({e, ...evalEntidad(e, e.tipo)}));
  const gd={vencido:0,por_vencer:0,vigente:0,sin_dato:0}; genRows.forEach(r=>gd[r.estado]++);
  const mRows = equipos.filter(e=>e.tipo==='tracto').map(e=>({e, ...evalMant(e)}));
  const mVenc=mRows.filter(r=>r.est==='vencida'), mProx=mRows.filter(r=>r.est==='proxima');
  const fd={en_ruta:0,en_patio:0,en_taller:0}; equipos.forEach(e=>{const s=e.estadoOp||'en_patio'; fd[s]=(fd[s]||0)+1;});
  const enTaller=equipos.filter(e=>(e.estadoOp||'')==='en_taller');

  $('#kpis').innerHTML = `
    <div class="kpi red"><div class="n">${gd.vencido}</div><div class="l">Equipos con doc. vencido</div></div>
    <div class="kpi amber"><div class="n">${gd.por_vencer}</div><div class="l">Docs por vencer (≤30 días)</div></div>
    <div class="kpi"><div class="n" style="color:var(--red)">${mVenc.length}</div><div class="l">Mantención vencida</div></div>
    <div class="kpi"><div class="n" style="color:var(--brand)">${fd.en_ruta}</div><div class="l">En ruta</div></div>`;

  // documentos a atender (con filtro)
  const items=[];
  equipos.forEach(e=>{ docTypesFor(e.tipo).forEach(dt=>{ if(dt.tipo==='presencia')return; const s=docStatus(e.docs&&e.docs[dt.id],dt);
    if((s.est==='vencido'||s.est==='por_vencer')&&s.ven!=null) items.push({patente:e.patente,tipo:e.tipo,id:e.id,doc:dt.nombre,ven:s.ven,dias:s.dias,est:s.est,general:dt.general!==false}); }); });
  items.sort((a,b)=>a.dias-b.dias);
  const win=DASH.win;
  const filt=items.filter(it=> win==='vencidos'?it.est==='vencido':win==='7'?it.dias<=7:win==='30'?it.dias<=30:true);
  const nVenc=items.filter(i=>i.est==='vencido').length;
  const chip=(k,l)=>`<button class="segb${win===k?' active':''}" data-win="${k}">${l}</button>`;

  // acreditación por cliente (cards)
  const clientCards = DB.clientes.map(cli=>{
    const parts = ['tracto','rampla'].map(tp=>{
      const ids=reqIds(cli,tp); if(!ids.length) return '';
      const base=DB.equipos.filter(e=>e.tipo===tp); let ac=0,pv=0,no=0;
      base.forEach(e=>{const o=evalCliente(e,tp,ids).overall; if(o==='acreditado')ac++; else if(o==='por_vencer')pv++; else if(o==='no_acreditado')no++;});
      const tot=base.length;
      return `<div class="ccrow"><span class="cclbl">${tp==='tracto'?'Tractos':'Ramplas'}</span>
        <span class="ccbar"><i style="width:${tot?ac/tot*100:0}%" class="g"></i><i style="width:${tot?pv/tot*100:0}%" class="a"></i><i style="width:${tot?no/tot*100:0}%" class="r"></i></span>
        <span class="ccnum"><b>${ac}</b>/${tot}</span></div>`;
    }).join('');
    return `<button class="clientcard" data-cli="${cli.id}"><h4>${esc(cli.nombre)}</h4>${parts||'<div class="hint">sin requisitos</div>'}</button>`;
  }).join('');

  let html='';
  // Documentos a atender
  html += `<section class="dashsec"><div class="dashhead"><h3>Documentos a atender</h3>
      <div class="seg">${chip('vencidos','Vencidos ('+nVenc+')')}${chip('7','≤7 días')}${chip('30','≤30 días')}${chip('pend','Todos')}</div></div>`;
  if(!filt.length){ html+='<div class="tablewrap"><div class="empty">Nada por atender en este filtro. 🎉</div></div>'; }
  else { const body=filt.slice(0,50).map(it=>{ const txt=it.dias<0?`hace ${-it.dias} d`:(it.dias===0?'hoy':`en ${it.dias} d`);
      return `<tr class="row-doc" data-id="${it.id}"><td><b>${esc(it.patente)}</b></td><td><span class="pilltipo">${it.tipo==='tracto'?'Tracto':'Rampla'}</span></td>
        <td>${esc(it.doc)}${it.general?'':' <span class="pilltipo" style="opacity:.7">cliente</span>'}</td><td>${badge(it.est)}</td><td class="mono">${fmt(it.ven)}</td><td class="dias">${txt}</td></tr>`; }).join('');
    html+=`<div class="tablewrap"><table><thead><tr><th>Patente</th><th>Tipo</th><th>Documento</th><th>Estado</th><th>Vence</th><th>Faltan</th></tr></thead><tbody>${body}</tbody></table></div>${filt.length>50?`<p class="hint" style="margin-top:8px">Mostrando 50 de ${filt.length}.</p>`:''}`; }
  html+='</section>';

  // Mantención a atender
  html += `<section class="dashsec"><div class="dashhead"><h3>Mantención a atender</h3><span class="hint">tractos vencidos o próximos · click para el detalle</span></div>`;
  const ml=[...mVenc, ...mProx];
  if(!ml.length){ html+='<div class="tablewrap"><div class="empty">Ninguna mantención pendiente. 🎉</div></div>'; }
  else { const b=ml.map(r=>`<tr class="row-mant" data-id="${r.e.id}"><td><b>${esc(r.e.patente)}</b></td><td class="mono">${nkm(r.kmAct)}</td><td class="mono">${nkm(r.prox)}</td><td><span class="badge m_${r.est}">${MANT_LABEL[r.est]}</span> <span class="dias">${r.faltante<0?('-'+nkm(-r.faltante)):nkm(r.faltante)} km</span></td></tr>`).join('');
    html+=`<div class="tablewrap"><table><thead><tr><th>Patente</th><th>Km actual</th><th>Próxima</th><th>Faltan</th></tr></thead><tbody>${b}</tbody></table></div>`; }
  html+='</section>';

  // Estado de la flota
  html += `<section class="dashsec"><div class="dashhead"><h3>Estado de la flota</h3><span class="hint">🔵 ${fd.en_ruta} en ruta · 🟢 ${fd.en_patio} en patio · 🟠 ${fd.en_taller} en taller</span></div>`;
  if(enTaller.length){ const b=enTaller.map(e=>`<tr class="row-flota" data-id="${e.id}"><td><b>${esc(e.patente)}</b></td><td><span class="pilltipo">${e.tipo==='tracto'?'Tracto':'Rampla'}</span></td><td>${esc(e.conductor||'—')}</td><td><span class="badge op_en_taller">En taller</span></td></tr>`).join('');
    html+=`<div class="tablewrap"><table><thead><tr><th>Patente</th><th>Tipo</th><th>Conductor</th><th>Estado</th></tr></thead><tbody>${b}</tbody></table></div>`; }
  else { html+='<div class="tablewrap"><div class="empty">Ningún equipo en taller. 👍</div></div>'; }
  html+='</section>';

  // Acreditación por cliente
  html += `<section class="dashsec"><div class="dashhead"><h3>Acreditación por cliente</h3><span class="hint">🟢 acreditado · 🟡 por vencer · 🔴 no acreditado · click para el detalle</span></div><div class="clientcards">${clientCards}</div></section>`;

  $('#view').innerHTML = html;
  $$('.clientcard').forEach(b=> b.onclick=()=>{ CLIENT.id=b.dataset.cli; VIEW='clientes'; render(); });
  $$('.seg [data-win]').forEach(b=> b.onclick=()=>{ DASH.win=b.dataset.win; renderDashboard(); });
  $$('.row-doc').forEach(tr=> tr.onclick=()=>{ VIEW='equipos'; openEdit(tr.dataset.id); VIEW='dashboard'; });
  $$('.row-mant').forEach(tr=> tr.onclick=()=> openMantDetail(tr.dataset.id));
  $$('.row-flota').forEach(tr=> tr.onclick=()=> openFlotaDetail(tr.dataset.id));
}

function currentList(){
  const cat = VIEW==='personas'?'persona':VIEW; // equipos usa dos cats
  if(VIEW==='personas') return DB.personas.map(e=>({ent:e, cat:'persona', ...evalEntidad(e,'persona')}));
  return DB.equipos.map(e=>({ent:e, cat:e.tipo, ...evalEntidad(e,e.tipo)}));
}

function renderKpis(){
  const rows = VIEW==='personas'
    ? DB.personas.map(e=>evalEntidad(e,'persona'))
    : DB.equipos.map(e=>evalEntidad(e,e.tipo));
  const c={total:rows.length,vencido:0,por_vencer:0,vigente:0,sin_dato:0};
  rows.forEach(r=>c[r.estado]++);
  const tot = VIEW==='personas'?'conductores':'equipos';
  $('#kpis').innerHTML = `
    <div class="kpi"><div class="n">${c.total}</div><div class="l">${tot}</div></div>
    <div class="kpi red"><div class="n">${c.vencido}</div><div class="l">Con doc. vencido</div></div>
    <div class="kpi amber"><div class="n">${c.por_vencer}</div><div class="l">Por vencer (≤30 días)</div></div>
    <div class="kpi green"><div class="n">${c.vigente}</div><div class="l">Al día</div></div>`;
}

function applyFilterSort(list){
  let out = list.filter(r=>{
    if(VIEW==='equipos' && FILTER.tipo!=='todos' && r.ent.tipo!==FILTER.tipo) return false;
    if(FILTER.estado!=='todos' && r.estado!==FILTER.estado) return false;
    if(FILTER.q){
      const hay = (VIEW==='personas'? (r.ent.nombre+' '+r.ent.rut) : (r.ent.patente+' '+r.ent.marca+' '+r.ent.modelo)).toLowerCase();
      if(!hay.includes(FILTER.q.toLowerCase())) return false;
    }
    return true;
  });
  const k=SORT.key, dir=SORT.dir;
  out.sort((a,b)=>{
    let av,bv;
    if(k==='estadoOrden'){ av=a.estadoOrden; bv=b.estadoOrden; }
    else if(k==='dias'){ av=a.prox?a.prox.dias:1e9; bv=b.prox?b.prox.dias:1e9; }
    else { av=(a.ent[k]||'').toString().toLowerCase(); bv=(b.ent[k]||'').toString().toLowerCase(); }
    if(av<bv) return -1*dir; if(av>bv) return 1*dir; return 0;
  });
  return out;
}

function badge(est){ return `<span class="badge ${est}">${ESTADO_LABEL[est]}</span>`; }
function proxCell(prox){
  if(!prox) return '<span class="dias">—</span>';
  const dias = prox.dias;
  const txt = dias<0 ? `hace ${-dias} d` : (dias===0?'hoy':`en ${dias} d`);
  return `<div>${esc(prox.dt.nombre)}</div><div class="dias">${fmt(prox.ven)} · ${txt}</div>`;
}

function renderTable(){
  const list = applyFilterSort(currentList());
  const isPer = VIEW==='personas';
  const th = (key,label)=>`<th data-sort="${key}">${label}${SORT.key===key?` <span class="ar">${SORT.dir>0?'▲':'▼'}</span>`:''}</th>`;
  const filters = `
    <div class="toolbar">
      <h2>${isPer?'Personas':'Equipos'}</h2>
      <input class="input search" id="fq" placeholder="Buscar ${isPer?'nombre o RUT':'patente, marca…'}" value="${esc(FILTER.q)}">
      ${!isPer?`<select class="input" id="ftipo">
        <option value="todos">Todos los tipos</option>
        <option value="tracto">Tractos</option>
        <option value="rampla">Ramplas</option></select>`:''}
      <select class="input" id="festado">
        <option value="todos">Todos los estados</option>
        <option value="vencido">Vencidos</option>
        <option value="por_vencer">Por vencer</option>
        <option value="vigente">Al día</option>
        <option value="sin_dato">Sin dato</option></select>
      <span class="count">${list.length} de ${(isPer?DB.personas:DB.equipos).length}</span>
    </div>`;

  let head, body;
  if(isPer){
    head = `<tr>${th('nombre','Nombre')}${th('rut','RUT')}${th('contrato','Contrato')}${th('estadoOrden','Estado')}${th('dias','Próximo vencimiento')}</tr>`;
    body = list.map(r=>`<tr data-id="${r.ent.id}">
      <td><b>${esc(r.ent.nombre)}</b></td>
      <td class="mono">${esc(r.ent.rut||'—')}</td>
      <td>${esc(r.ent.contrato||'—')}</td>
      <td>${badge(r.estado)}</td>
      <td>${proxCell(r.prox)}</td></tr>`).join('');
  } else {
    head = `<tr>${th('patente','Patente')}${th('tipo','Tipo')}${th('marca','Marca / Modelo')}${th('estadoOrden','Estado')}${th('dias','Próximo vencimiento')}</tr>`;
    body = list.map(r=>`<tr data-id="${r.ent.id}">
      <td><b>${esc(r.ent.patente)}</b></td>
      <td><span class="pilltipo">${r.ent.tipo==='tracto'?'Tracto':'Rampla'}</span></td>
      <td>${esc(r.ent.marca||'')}${r.ent.modelo?' · '+esc(r.ent.modelo):''}${r.ent.anio?' · '+esc(r.ent.anio):''}</td>
      <td>${badge(r.estado)}</td>
      <td>${proxCell(r.prox)}</td></tr>`).join('');
  }
  const table = list.length
    ? `<div class="tablewrap"><table><thead>${head}</thead><tbody>${body}</tbody></table></div>`
    : `<div class="tablewrap"><div class="empty">Sin resultados. Ajusta los filtros o agrega un registro.</div></div>`;
  $('#view').innerHTML = filters + table;

  // eventos
  const fq=$('#fq'); if(fq){ fq.oninput=()=>{FILTER.q=fq.value; const p=fq.selectionStart; renderTable(); const n=$('#fq'); n.focus(); n.setSelectionRange(p,p);} }
  const ft=$('#ftipo'); if(ft){ ft.value=FILTER.tipo; ft.onchange=()=>{FILTER.tipo=ft.value; renderTable();}; }
  const fe=$('#festado'); if(fe){ fe.value=FILTER.estado; fe.onchange=()=>{FILTER.estado=fe.value; renderTable();}; }
  $$('#view thead th[data-sort]').forEach(h=> h.onclick=()=>{ const k=h.dataset.sort; if(SORT.key===k) SORT.dir*=-1; else {SORT.key=k;SORT.dir=1;} renderTable(); });
  $$('#view tbody tr').forEach(tr=> tr.onclick=()=> openEdit(tr.dataset.id));
}

/* ---------- modal edición ---------- */
let EDIT = null; // {cat, ent, isNew}
function openEdit(id){
  const isPer = VIEW==='personas';
  const list = isPer?DB.personas:DB.equipos;
  const ent = list.find(e=>e.id===id);
  if(!ent) return;
  EDIT = { cat: isPer?'persona':ent.tipo, ent: JSON.parse(JSON.stringify(ent)), isNew:false };
  fillModal();
}
function openAdd(){
  const isPer = VIEW==='personas';
  if(VIEW==='config'){ VIEW='equipos'; render(); }
  if(isPer){ EDIT={cat:'persona', ent:{id:uid(),nombre:'',rut:'',contrato:'',docs:{}}, isNew:true}; }
  else { EDIT={cat:'tracto', ent:{id:uid(),patente:'',tipo:'tracto',marca:'',modelo:'',anio:'',docs:{},conductor:'',estadoOp:'en_patio',notas:'',movimientos:[]}, isNew:true}; }
  fillModal();
}
function fillModal(){
  const {cat,ent,isNew}=EDIT;
  const isPer = cat==='persona';
  $('#mTitle').textContent = (isNew?'Agregar ':'Editar ')+(isPer?'persona':'equipo');
  $('#mDelete').style.display = isNew?'none':'';
  let head;
  if(isPer){
    head = `<div class="formgrid">
      <div class="field"><label>Nombre</label><input class="input" id="f_nombre" value="${esc(ent.nombre)}"></div>
      <div class="field"><label>RUT</label><input class="input" id="f_rut" value="${esc(ent.rut)}"></div>
      <div class="field"><label>Tipo de contrato</label><input class="input" id="f_contrato" value="${esc(ent.contrato||'')}"></div>
    </div>`;
  } else {
    head = `<div class="formgrid">
      <div class="field"><label>Patente</label><input class="input" id="f_patente" value="${esc(ent.patente)}"></div>
      <div class="field"><label>Tipo</label><select class="input" id="f_tipo">
        <option value="tracto"${ent.tipo==='tracto'?' selected':''}>Tracto</option>
        <option value="rampla"${ent.tipo==='rampla'?' selected':''}>Rampla</option></select></div>
      <div class="field"><label>Marca</label><input class="input" id="f_marca" value="${esc(ent.marca||'')}"></div>
      <div class="field"><label>Modelo</label><input class="input" id="f_modelo" value="${esc(ent.modelo||'')}"></div>
      <div class="field"><label>Año</label><input class="input" id="f_anio" value="${esc(ent.anio||'')}"></div>
    </div>`;
  }
  $('#mBody').innerHTML = head + `<div class="section-title">Documentos</div><div id="docs"></div>`;
  if(!isPer){ $('#f_tipo').onchange = e=>{ EDIT.cat=e.target.value; EDIT.ent.tipo=e.target.value; renderDocs(); }; }
  renderDocs();
  $('#overlay').classList.add('open');
}
function renderDocs(){
  const {cat,ent}=EDIT;
  const dts = docTypesFor(cat);
  if(!dts.length){ $('#docs').innerHTML='<p class="hint">No hay tipos de documento definidos para esta categoría. Agrégalos en Configuración.</p>'; return; }
  $('#docs').innerHTML = dts.map(dt=>{
    const doc = ent.docs[dt.id]||{};
    if(dt.tipo==='presencia'){
      const on = !!doc.cumple;
      return `<div class="docrow">
        <div class="dn">${esc(dt.nombre)}<small>presencia (SÍ / NO)</small></div>
        <div><label class="pres-wrap"><input type="checkbox" class="pres-chk" data-doc="${dt.id}"${on?' checked':''}> Cumple (SÍ)</label></div>
        <div style="text-align:right;min-width:150px">${badge(on?'vigente':'sin_dato')}</div>
      </div>`;
    }
    const ven = docVence(doc, dt);
    const est = estadoDe(diasDe(ven), !!doc.realizado);
    const vig = dt.vigenciaMeses ? `vigencia ${dt.vigenciaMeses} meses` : 'sin caducidad';
    return `<div class="docrow">
      <div class="dn">${esc(dt.nombre)}<small>${vig}</small></div>
      <div><input type="date" class="input date-doc" data-doc="${dt.id}" value="${esc(doc.realizado||'')}" style="width:100%"></div>
      <div style="text-align:right;min-width:150px">${badge(est)}<div class="dias">${ven?('vence '+fmt(ven)):'—'}</div></div>
    </div>`;
  }).join('');
  $$('#docs input.date-doc').forEach(inp=> inp.oninput=()=>{
    const id=inp.dataset.doc; const dt=dts.find(d=>d.id===id);
    if(!inp.value){ delete EDIT.ent.docs[id]; }
    else { EDIT.ent.docs[id]={ realizado:inp.value, vence:addMonths(inp.value, dt.vigenciaMeses) }; }
    renderDocs();
  });
  $$('#docs input.pres-chk').forEach(chk=> chk.onchange=()=>{
    const id=chk.dataset.doc;
    if(chk.checked){ EDIT.ent.docs[id]={cumple:true}; } else { delete EDIT.ent.docs[id]; }
    renderDocs();
  });
}
function saveEdit(){
  const {cat,ent,isNew}=EDIT; const isPer=cat==='persona';
  if(isPer){ ent.nombre=$('#f_nombre').value.trim(); ent.rut=$('#f_rut').value.trim(); ent.contrato=$('#f_contrato').value.trim();
    if(!ent.nombre){ toast('El nombre es obligatorio','err'); return; } }
  else { ent.patente=$('#f_patente').value.trim().toUpperCase(); ent.tipo=$('#f_tipo').value;
    ent.marca=$('#f_marca').value.trim(); ent.modelo=$('#f_modelo').value.trim(); ent.anio=$('#f_anio').value.trim();
    if(!ent.patente){ toast('La patente es obligatoria','err'); return; } }
  const list = isPer?DB.personas:DB.equipos;
  if(isNew){ list.push(ent); } else { const i=list.findIndex(e=>e.id===ent.id); if(i>=0) list[i]=ent; }
  save(); closeModal(); render(); toast('Guardado','ok');
}
function deleteEdit(){
  const {cat,ent}=EDIT; const isPer=cat==='persona';
  if(!confirm('¿Eliminar '+(isPer?'a '+ent.nombre:ent.patente)+'? Esta acción no se puede deshacer.')) return;
  const list=isPer?DB.personas:DB.equipos; const i=list.findIndex(e=>e.id===ent.id); if(i>=0) list.splice(i,1);
  save(); closeModal(); render(); toast('Eliminado','ok');
}
function closeModal(){ $('#overlay').classList.remove('open'); EDIT=null; }

/* ---------- configuración ---------- */
function renderConfig(){
  $('#kpis').innerHTML='';
  const cats=[['tracto','Documentos de Tractos'],['rampla','Documentos de Ramplas']];
  let html = `<div class="toolbar"><h2>Configuración</h2><span class="count">Define los documentos y su vigencia. La casilla <b>General</b> indica si el documento cuenta para el <b>estado general</b> del equipo (lo que exige la Planilla Madre). Los específicos de un cliente (Padrón, RTI…) van desmarcados: solo cuentan en la acreditación de ese cliente.</span></div>`;
  html += cats.map(([cat,titulo])=>`
    <div class="cfgcard">
      <h3>${titulo}</h3>
      <div class="cfgrow head" style="color:var(--faint);font-size:12px;text-transform:uppercase;letter-spacing:.03em"><div>Documento</div><div>Tipo</div><div>Vigencia</div><div>General</div><div></div></div>
      ${docTypesFor(cat).map(dt=>{ const pres=dt.tipo==='presencia'; return `<div class="cfgrow" data-cat="${cat}" data-id="${dt.id}">
        <input class="input cfg-nombre" value="${esc(dt.nombre)}">
        <select class="input cfg-tipo"><option value="fecha"${!pres?' selected':''}>Fecha</option><option value="presencia"${pres?' selected':''}>SÍ / NO</option></select>
        <input class="input cfg-vig mono" type="number" min="0" placeholder="${pres?'—':'sin caducidad'}" value="${dt.vigenciaMeses==null?'':dt.vigenciaMeses}"${pres?' disabled':''}>
        <label class="cfg-gen-wrap" title="Cuenta para el estado general del equipo"><input type="checkbox" class="cfg-gen"${dt.general!==false?' checked':''}></label>
        <button class="btn danger sm cfg-del">Quitar</button>
      </div>`; }).join('')}
      <div style="margin-top:10px"><button class="btn sm cfg-add" data-cat="${cat}">+ Agregar documento</button></div>
    </div>`).join('');
  html += `<div class="cfgcard"><h3>Items de checklist (entrega / devolución)</h3>
      <p class="hint" style="margin-top:0">Lo que se entrega al conductor, con su valor. Se usa en el módulo <b>Estado</b> y en el checklist impreso.</p>
      ${[['tracto','Tractos'],['rampla','Ramplas']].map(([tp,tit])=>`
        <div class="section-title">${tit}</div>
        <div class="cfgrow ck2 head" style="color:var(--faint);font-size:12px;text-transform:uppercase;letter-spacing:.03em"><div>Elemento</div><div>Precio</div><div></div></div>
        ${itemsFor(tp).map(it=>`<div class="cfgrow ck2" data-tipo="${tp}" data-id="${it.id}">
          <input class="input ck-nombre" value="${esc(it.nombre)}">
          <input class="input ck-precio mono" type="number" min="0" value="${it.precio||0}">
          <button class="btn danger sm ck-del">Quitar</button></div>`).join('')}
        <div style="margin:6px 0 12px"><button class="btn sm ck-add" data-tipo="${tp}">+ Agregar a ${tit.toLowerCase()}</button></div>`).join('')}
    </div>`;
  const mc=DB.mantConfig||{intervaloDefault:50000,avisoKm:5000};
  html += `<div class="cfgcard"><h3>Mantención</h3>
      <p class="hint" style="margin-top:0">Valores por defecto para el cálculo de la próxima mantención.</p>
      <div class="cfgrow" style="grid-template-columns:1fr 130px"><div>Intervalo por defecto (km)</div><input class="input mono" id="mcInter" type="number" min="0" value="${mc.intervaloDefault}"></div>
      <div class="cfgrow" style="grid-template-columns:1fr 130px"><div>Avisar cuando falten (km)</div><input class="input mono" id="mcAviso" type="number" min="0" value="${mc.avisoKm}"></div>
    </div>`;
  html += `<div class="cfgcard"><h3>Datos</h3>
      <p class="hint" style="margin-top:0">La app guarda todo en la nube (y una copia en este navegador). Exporta un respaldo cuando quieras.</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn" id="cfgReset">↺ Restaurar flota original</button>
        <button class="btn danger" id="cfgWipe">Borrar todos los datos</button>
      </div></div>`;
  $('#view').innerHTML = html;

  $$('.cfg-nombre').forEach(inp=> inp.onchange=()=>{ const row=inp.closest('.cfgrow'); const dt=findDt(row.dataset.cat,row.dataset.id); if(dt){dt.nombre=inp.value; save();} });
  $$('.cfg-vig').forEach(inp=> inp.onchange=()=>{ const row=inp.closest('.cfgrow'); const dt=findDt(row.dataset.cat,row.dataset.id); if(dt){dt.vigenciaMeses = inp.value===''?null:Math.max(0,parseInt(inp.value,10)||0); save();} });
  $$('.cfg-gen').forEach(inp=> inp.onchange=()=>{ const row=inp.closest('.cfgrow'); const dt=findDt(row.dataset.cat,row.dataset.id); if(dt){dt.general=inp.checked; save();} });
  $$('.cfg-tipo').forEach(sel=> sel.onchange=()=>{ const row=sel.closest('.cfgrow'); const dt=findDt(row.dataset.cat,row.dataset.id); if(dt){dt.tipo=sel.value; save(); renderConfig();} });
  $$('.cfg-del').forEach(b=> b.onclick=()=>{ const row=b.closest('.cfgrow'); const cat=row.dataset.cat; DB.docTypes[cat]=DB.docTypes[cat].filter(d=>d.id!==row.dataset.id); save(); renderConfig(); toast('Documento quitado','ok'); });
  $$('.cfg-add').forEach(b=> b.onclick=()=>{ const cat=b.dataset.cat; const nombre=prompt('Nombre del documento:'); if(!nombre) return;
    const id=nombre.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'')+'_'+Math.random().toString(36).slice(2,5);
    DB.docTypes[cat].push({id,nombre:nombre.trim(),vigenciaMeses:12,general:true,tipo:'fecha'}); save(); renderConfig(); });
  $$('.ck-nombre').forEach(inp=> inp.onchange=()=>{ const row=inp.closest('.cfgrow'); const it=itemsFor(row.dataset.tipo).find(i=>i.id===row.dataset.id); if(it){it.nombre=inp.value; save();} });
  $$('.ck-precio').forEach(inp=> inp.onchange=()=>{ const row=inp.closest('.cfgrow'); const it=itemsFor(row.dataset.tipo).find(i=>i.id===row.dataset.id); if(it){it.precio=parseInt(inp.value,10)||0; save();} });
  $$('.ck-del').forEach(b=> b.onclick=()=>{ const row=b.closest('.cfgrow'); const tp=row.dataset.tipo; DB.checklistItems[tp]=itemsFor(tp).filter(i=>i.id!==row.dataset.id); save(); renderConfig(); });
  $$('.ck-add').forEach(b=> b.onclick=()=>{ const tp=b.dataset.tipo; const n=prompt('Nombre del item:'); if(!n) return; DB.checklistItems[tp]=DB.checklistItems[tp]||[]; DB.checklistItems[tp].push({id:tp[0]+Math.random().toString(36).slice(2,6),nombre:n.trim(),precio:0}); save(); renderConfig(); });
  const mci=$('#mcInter'); if(mci) mci.onchange=()=>{ DB.mantConfig=DB.mantConfig||{}; DB.mantConfig.intervaloDefault=parseInt(mci.value,10)||50000; save(); };
  const mca=$('#mcAviso'); if(mca) mca.onchange=()=>{ DB.mantConfig=DB.mantConfig||{}; DB.mantConfig.avisoKm=parseInt(mca.value,10)||5000; save(); };
  $('#cfgReset').onclick=()=>{ if(confirm('Esto reemplaza tus datos actuales por la flota original importada. ¿Continuar?')) resetSeed(); };
  $('#cfgWipe').onclick=()=>{ if(confirm('¿Borrar TODOS los datos de este navegador? No se puede deshacer.')){ DB={docTypes:{tracto:[],rampla:[],persona:[]},equipos:[],personas:[]}; save(); render(); toast('Datos borrados','ok'); } };
}
function findDt(cat,id){ return docTypesFor(cat).find(d=>d.id===id); }

/* ---------- vista clientes (acreditación) ---------- */
let CLIENT = { id:null, modo:'equipos', tipo:'tracto' };
function acBadge(est){ return `<span class="badge ac_${est}">${ACRED_LABEL[est]}</span>`; }

function renderClientes(){
  if(!DB.clientes.length){ DB.clientes=defaultClientes(); save(); }
  if(!findCliente(CLIENT.id)) CLIENT.id = DB.clientes[0].id;
  const cli = findCliente(CLIENT.id);
  const cat = CLIENT.tipo;               // 'tracto' | 'rampla'
  const ids = reqIds(cli, cat);

  const base = DB.equipos.filter(e=>e.tipo===CLIENT.tipo);
  const rows = base.map(ent=>({ent, ...evalCliente(ent, cat, ids)}));

  // KPIs del cliente
  const c={total:rows.length,acreditado:0,por_vencer:0,no_acreditado:0,sin_req:0};
  rows.forEach(r=>c[r.overall]++);
  const tipoLbl = CLIENT.tipo==='tracto'?'tractos':'ramplas';
  $('#kpis').innerHTML = `
    <div class="kpi green"><div class="n">${c.acreditado}</div><div class="l">Acreditados</div></div>
    <div class="kpi amber"><div class="n">${c.por_vencer}</div><div class="l">Por vencer (≤30 días)</div></div>
    <div class="kpi red"><div class="n">${c.no_acreditado}</div><div class="l">No acreditados / faltantes</div></div>
    <div class="kpi"><div class="n">${c.total}</div><div class="l">${tipoLbl}</div></div>`;

  const chips = DB.clientes.map(cl=>`<button class="chip-cli${cl.id===CLIENT.id?' active':''}" data-cli="${cl.id}">${esc(cl.nombre)}</button>`).join('');
  let html = `
    <div class="clientbar"><div class="chips">${chips}<button class="chip-cli add" id="cliAdd">+ Cliente</button></div></div>
    <div class="toolbar">
      <div class="seg">
        <button class="segb${CLIENT.tipo==='tracto'?' active':''}" data-tipo="tracto">Tractos</button>
        <button class="segb${CLIENT.tipo==='rampla'?' active':''}" data-tipo="rampla">Ramplas</button></div>
      <span class="spacer" style="flex:1"></span>
      <button class="btn sm" id="cliReq">⚙️ Editar requisitos</button>
      <button class="btn sm" id="cliCsv">Exportar CSV</button>
      ${DB.clientes.length>1?`<button class="btn sm danger" id="cliDel">Quitar cliente</button>`:''}
    </div>`;

  if(!ids.length){
    html += `<div class="tablewrap"><div class="empty"><b>${esc(cli.nombre)}</b> no tiene documentos requeridos para ${tipoLbl}.<br>Usa <b>⚙️ Editar requisitos</b> para definirlos.</div></div>`;
  } else {
    const docHead = ids.map(id=>{ const dt=findDt(cat,id); return `<th title="${esc(dt?dt.nombre:id)}">${esc(dt?dt.nombre:id)}</th>`; }).join('');
    const head = `<tr><th>Patente</th>${docHead}<th>Acreditación</th></tr>`;
    const ord={no_acreditado:0,por_vencer:1,acreditado:2,sin_req:3};
    rows.sort((a,b)=> (ord[a.overall]-ord[b.overall]) || a.ent.patente.localeCompare(b.ent.patente));
    const body = rows.map(r=>{
      const cells = r.st.map(s=>{
        const t = `${s.dt.nombre} — ${s.est==='sin_dato'?'sin registro':(s.ven?('vence '+fmt(s.ven)):'ok')}`;
        return `<td><span class="sdot ${s.est}" title="${esc(t)}"></span></td>`;
      }).join('');
      return `<tr data-id="${r.ent.id}"><td><b>${esc(r.ent.patente)}</b></td>${cells}<td>${acBadge(r.overall)}</td></tr>`;
    }).join('');
    html += `<div class="tablewrap"><table><thead>${head}</thead><tbody>${body}</tbody></table></div>
      <p class="hint" style="margin-top:10px">🟢 vigente · 🟡 por vencer · 🔴 vencido · ⚪ sin registro · Pasa el cursor sobre cada punto para el detalle. Click en una fila para editar sus documentos.</p>`;
  }
  $('#view').innerHTML = html;

  // eventos
  $$('.chip-cli[data-cli]').forEach(b=> b.onclick=()=>{ CLIENT.id=b.dataset.cli; render(); });
  $('#cliAdd').onclick=()=>{ const n=prompt('Nombre del nuevo cliente:'); if(!n) return;
    DB.clientes.push({id:uid(),nombre:n.trim(),requisitos:{tracto:[],rampla:[]}}); save(); CLIENT.id=DB.clientes[DB.clientes.length-1].id; render(); openReqEditor(); };
  $$('.segb[data-tipo]').forEach(b=> b.onclick=()=>{ CLIENT.tipo=b.dataset.tipo; render(); });
  $('#cliReq').onclick=openReqEditor;
  $('#cliCsv').onclick=()=>exportCliente(cli, cat, ids, rows);
  const del=$('#cliDel'); if(del) del.onclick=()=>{ if(confirm('¿Quitar el cliente '+cli.nombre+'? (no borra equipos)')){ DB.clientes=DB.clientes.filter(c=>c.id!==cli.id); save(); CLIENT.id=null; render(); toast('Cliente quitado','ok'); } };
  $$('#view tbody tr').forEach(tr=> tr.onclick=()=> openEdit(tr.dataset.id));
}

function openReqEditor(){
  const cli = findCliente(CLIENT.id); if(!cli) return;
  const cats=[['tracto','Tractos'],['rampla','Ramplas']];
  $('#reqTitle').textContent = 'Requisitos de '+cli.nombre;
  $('#reqBody').innerHTML = cats.map(([cat,tit])=>`
    <div class="section-title">${tit}</div>
    <div class="reqgrid">
      ${docTypesFor(cat).map(dt=>{
        const on = reqIds(cli,cat).includes(dt.id);
        return `<label class="reqchk"><input type="checkbox" data-cat="${cat}" data-id="${dt.id}"${on?' checked':''}> ${esc(dt.nombre)}</label>`;
      }).join('') || '<span class="hint">Sin documentos definidos (ver Configuración)</span>'}
    </div>`).join('');
  $('#reqOverlay').classList.add('open');
}
function saveReqEditor(){
  const cli = findCliente(CLIENT.id); if(!cli) return;
  const req={tracto:[],rampla:[]};
  $$('#reqBody input[type=checkbox]:checked').forEach(ch=> req[ch.dataset.cat].push(ch.dataset.id));
  cli.requisitos=req; save(); $('#reqOverlay').classList.remove('open'); render(); toast('Requisitos actualizados','ok');
}
function exportCliente(cli, cat, ids, rows){
  const header=['Patente'].concat(ids.map(id=>{const dt=findDt(cat,id);return dt?dt.nombre:id;})).concat(['Acreditación']);
  const out=[header];
  rows.forEach(r=>{
    const row=[r.ent.patente];
    r.st.forEach(s=> row.push(s.est==='sin_dato'?'FALTA':(ACRED_LABEL[s.est]||s.est)+(s.ven?(' ('+fmt(s.ven)+')'):'')));
    row.push(ACRED_LABEL[r.overall]);
    out.push(row);
  });
  const csv='﻿'+out.map(r=>r.map(csvCell).join(';')).join('\n');
  download('acreditacion-'+cli.nombre.toLowerCase()+'-'+cat+'-'+toISO(today0())+'.csv', csv, 'text/csv');
  toast('CSV de '+cli.nombre+' descargado','ok');
}

/* ---------- exportar / importar ---------- */
function download(name, text, type){ const b=new Blob([text],{type}); const u=URL.createObjectURL(b); const a=document.createElement('a'); a.href=u; a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(u),1000); }
function exportJson(){ download('respaldo-flota-'+toISO(today0())+'.json', JSON.stringify(DB,null,1), 'application/json'); toast('Respaldo descargado','ok'); }
function csvCell(s){ s=String(s==null?'':s); return /[",\n;]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s; }
function exportCsv(kind){
  const isPer=kind==='personas';
  const cat = isPer?'persona':null;
  const dtsT = docTypesFor('tracto'), dtsR=docTypesFor('rampla');
  const rows=[];
  if(isPer){
    const dts=docTypesFor('persona');
    rows.push(['Nombre','RUT','Contrato','Estado'].concat(dts.flatMap(d=>[d.nombre+' realizado', d.nombre+' vence'])));
    DB.personas.forEach(e=>{ const ev=evalEntidad(e,'persona');
      const base=[e.nombre,e.rut,e.contrato,ESTADO_LABEL[ev.estado]];
      dts.forEach(d=>{const doc=e.docs[d.id]||{}; base.push(fmt(doc.realizado), fmt(docVence(doc,d)));}); rows.push(base); });
  } else {
    const allDts = [...new Map([...dtsT,...dtsR].map(d=>[d.id,d])).values()];
    rows.push(['Patente','Tipo','Marca','Modelo','Año','Estado'].concat(allDts.flatMap(d=>[d.nombre+' realizado', d.nombre+' vence'])));
    DB.equipos.forEach(e=>{ const ev=evalEntidad(e,e.tipo);
      const base=[e.patente,e.tipo,e.marca,e.modelo,e.anio,ESTADO_LABEL[ev.estado]];
      allDts.forEach(d=>{const doc=e.docs[d.id]||{}; base.push(fmt(doc.realizado), fmt(docVence(doc,d)));}); rows.push(base); });
  }
  const csv='﻿'+rows.map(r=>r.map(csvCell).join(';')).join('\n');
  download((isPer?'personas':'equipos')+'-'+toISO(today0())+'.csv', csv, 'text/csv');
  toast('CSV descargado','ok');
}
function importJson(file){
  const rd=new FileReader();
  rd.onload=()=>{ try{ const d=JSON.parse(rd.result);
      if(!d||!d.docTypes||!Array.isArray(d.equipos)||!Array.isArray(d.personas)) throw new Error('formato');
      if(!confirm('Esto reemplazará los datos actuales por los del respaldo. ¿Continuar?')) return;
      DB=d; DB.docTypes=DB.docTypes||{tracto:[],rampla:[],persona:[]}; ensureIds(); save(); render(); toast('Respaldo importado','ok');
    }catch(e){ toast('Archivo inválido: '+e.message,'err'); } };
  rd.readAsText(file);
}

/* ---------- toast ---------- */
let toastT=null;
function toast(msg,kind){ const t=$('#toast'); t.textContent=msg; t.className='toast show '+(kind||''); clearTimeout(toastT); toastT=setTimeout(()=>t.className='toast '+(kind||''),2600); }

/* ---------- nube (Supabase) ---------- */
let cloudTimer=null;
function setCloudState(txt){ const el=$('#cloudState'); if(el) el.textContent=txt; }
function cloudSaveDebounced(){ clearTimeout(cloudTimer); setCloudState('guardando…'); cloudTimer=setTimeout(cloudPush, 900); }
async function cloudPush(){
  if(!CLOUD.enabled) return;
  try{
    const { error } = await CLOUD.sb.from('flota_state')
      .update({ data: DB, updated_at: new Date().toISOString(), updated_by: CLOUD.email })
      .eq('id','main');
    if(error) throw error;
    setCloudState('☁️ guardado');
  }catch(e){ setCloudState('⚠️ sin guardar'); console.warn('cloudPush', e); }
}
async function cloudLoad(){
  const { data, error } = await CLOUD.sb.from('flota_state').select('data').eq('id','main').single();
  if(error) throw error;
  const cloud = data && data.data;
  if(cloud && Array.isArray(cloud.equipos) && cloud.equipos.length){
    DB = cloud; normalizeDB();
  } else {
    // primera vez en la nube: sembrar desde el navegador o el seed
    const raw = localStorage.getItem(LS_KEY);
    DB = raw ? JSON.parse(raw) : JSON.parse(JSON.stringify(window.SEED||emptyDB()));
    normalizeDB();
  }
  localStorage.setItem(LS_KEY, JSON.stringify(DB));
  await cloudPush(); // guarda la versión normalizada/sembrada
}
function showLogin(){ $('#loginScreen').style.display='flex'; setTimeout(()=>{ const em=$('#loginEmail'); if(em) em.focus(); },50); }
function hideLogin(){ $('#loginScreen').style.display='none'; }
async function doLogin(e){
  if(e) e.preventDefault();
  const email=$('#loginEmail').value.trim(), pass=$('#loginPass').value;
  const err=$('#loginErr');
  if(!email||!pass){ err.textContent='Ingresa correo y contraseña.'; return; }
  $('#loginBtn').textContent='Entrando…'; err.textContent='';
  try{
    const { data, error } = await CLOUD.sb.auth.signInWithPassword({ email, password: pass });
    if(error) throw error;
    await afterAuth(data.user.email);
  }catch(ex){
    err.textContent = /invalid/i.test(ex.message||'')?'Correo o contraseña incorrectos.':(ex.message||'No se pudo iniciar sesión.');
  }finally{ $('#loginBtn').textContent='Entrar'; }
}
async function afterAuth(email){
  CLOUD.email=email; CLOUD.enabled=true; hideLogin();
  $('#btnLogout').style.display='';
  setCloudState('☁️ '+(email||''));
  try{ await cloudLoad(); }
  catch(e){ toast('Error cargando de la nube: '+(e.message||e),'err'); loadDB(); }
  render();
}

/* ---------- eventos ---------- */
function wireEvents(){
  $$('.tab').forEach(t=> t.onclick=()=>{ VIEW=t.dataset.view; SORT={key:'estadoOrden',dir:1}; FILTER={tipo:'todos',estado:'todos',q:''}; render(); });
  $('#btnAdd').onclick=openAdd;
  $('#mClose').onclick=closeModal; $('#mCancel').onclick=closeModal;
  $('#mSave').onclick=saveEdit; $('#mDelete').onclick=deleteEdit;
  $('#overlay').onclick=e=>{ if(e.target.id==='overlay') closeModal(); };
  $('#btnExport').onclick=()=>$('#expOverlay').classList.add('open');
  $('#expClose').onclick=()=>$('#expOverlay').classList.remove('open');
  $('#expOverlay').onclick=e=>{ if(e.target.id==='expOverlay') e.currentTarget.classList.remove('open'); };
  $('#expJson').onclick=()=>{exportJson();$('#expOverlay').classList.remove('open');};
  $('#expCsvEq').onclick=()=>{exportCsv('equipos');$('#expOverlay').classList.remove('open');};
  $('#btnImport').onclick=()=>$('#fileInput').click();
  $('#fileInput').onchange=e=>{ if(e.target.files[0]) importJson(e.target.files[0]); e.target.value=''; };
  $('#reqClose').onclick=()=>$('#reqOverlay').classList.remove('open');
  $('#reqCancel').onclick=()=>$('#reqOverlay').classList.remove('open');
  $('#reqSave').onclick=saveReqEditor;
  $('#reqOverlay').onclick=e=>{ if(e.target.id==='reqOverlay') e.currentTarget.classList.remove('open'); };
  $('#flClose').onclick=()=>$('#flotaOverlay').classList.remove('open');
  $('#flCloseBtn').onclick=()=>$('#flotaOverlay').classList.remove('open');
  $('#flotaOverlay').onclick=e=>{ if(e.target.id==='flotaOverlay') e.currentTarget.classList.remove('open'); };
  $('#mtClose').onclick=()=>$('#mantOverlay').classList.remove('open');
  $('#mtCloseBtn').onclick=()=>$('#mantOverlay').classList.remove('open');
  $('#mantOverlay').onclick=e=>{ if(e.target.id==='mantOverlay') e.currentTarget.classList.remove('open'); };
  const lf=$('#loginForm'); if(lf) lf.onsubmit=doLogin;
  const lo=$('#btnLogout'); if(lo) lo.onclick=async ()=>{ if(CLOUD.sb){ try{ await CLOUD.sb.auth.signOut(); }catch(e){} } location.reload(); };
  document.addEventListener('keydown',e=>{ if(e.key==='Escape'){ closeModal(); $('#expOverlay').classList.remove('open'); $('#reqOverlay').classList.remove('open'); $('#flotaOverlay').classList.remove('open'); $('#mantOverlay').classList.remove('open'); } });
}

/* ---------- arranque ---------- */
async function boot(){
  wireEvents();
  if(window.SUPA_URL && window.SUPA_KEY && window.supabase && window.supabase.createClient){
    CLOUD.sb = window.supabase.createClient(window.SUPA_URL, window.SUPA_KEY);
    setCloudState('☁️');
    try{
      const { data } = await CLOUD.sb.auth.getSession();
      if(data && data.session){ await afterAuth(data.session.user.email); }
      else { showLogin(); }
    }catch(e){ toast('Error de conexión con la nube','err'); showLogin(); }
  } else {
    loadDB(); render(); // modo local (sin nube configurada)
  }
}
boot();
})();
