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
let VIEW = 'equipos';
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
function save(){ localStorage.setItem(LS_KEY, JSON.stringify(DB)); }
function uid(){ return 'e'+Math.random().toString(36).slice(2,9); }
function ensureIds(){
  ['equipos','personas'].forEach(k=> DB[k].forEach(e=>{ if(!e.id) e.id=uid(); if(!e.docs) e.docs={}; }));
}
function loadDB(){
  const raw = localStorage.getItem(LS_KEY);
  if(raw){ try{ DB=JSON.parse(raw); }catch(e){ DB=null; } }
  if(!DB){ DB = JSON.parse(JSON.stringify(window.SEED||{docTypes:{tracto:[],rampla:[],persona:[]},equipos:[],personas:[]})); }
  DB.docTypes = DB.docTypes||{tracto:[],rampla:[],persona:[]};
  DB.equipos = DB.equipos||[]; DB.personas = DB.personas||[];
  if(!DB.clientes) DB.clientes = defaultClientes();   // migración Fase 2
  migrate();                                          // documentos obligatorios faltantes
  ensureIds(); save();
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
}
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
  if(VIEW==='clientes'){ renderClientes(); return; }
  renderKpis();
  renderTable();
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
  else { EDIT={cat:'tracto', ent:{id:uid(),patente:'',tipo:'tracto',marca:'',modelo:'',anio:'',docs:{}}, isNew:true}; }
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
  html += `<div class="cfgcard"><h3>Datos</h3>
      <p class="hint" style="margin-top:0">La app guarda todo en este navegador. Exporta un respaldo con frecuencia.</p>
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

/* ---------- init / eventos ---------- */
function init(){
  loadDB();
  $$('.tab').forEach(t=> t.onclick=()=>{ VIEW=t.dataset.view; SORT={key: VIEW==='personas'?'estadoOrden':'estadoOrden',dir:1}; FILTER={tipo:'todos',estado:'todos',q:''}; render(); });
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
  document.addEventListener('keydown',e=>{ if(e.key==='Escape'){ closeModal(); $('#expOverlay').classList.remove('open'); $('#reqOverlay').classList.remove('open'); } });
  render();
}
init();
})();
