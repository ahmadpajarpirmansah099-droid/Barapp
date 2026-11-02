/* ===== JADWAL KERJA MINGGUAN (rencana, Senin-Minggu) ===== */
const JAD_CODES=['','6','7','8','9','10','11','12','1','2','L','S','PH'];
const JAD_TIME={'6':'06:00','7':'07:00','8':'08:00','9':'09:00','10':'10:00','11':'11:00','12':'12:00','1':'13:00','2':'14:00'};
const JAD_KEY={'':'blank',L:'off',S:'sakit',PH:'ph','6':'c6','7':'c7','8':'c8','9':'c9','10':'c10','11':'c11','12':'c12','1':'c1','2':'c1'};
const jadKey=c=>JAD_KEY[c]||'blank';
const jadOpt=c=>!c?'–':c==='L'?'Libur':c==='S'?'Sakit':c==='PH'?'PH':(JAD_TIME[c]||c);
const JAD_NAMA=['Sen','Sel','Rab','Kam','Jum','Sab','Min'];
const jadAddDays=(s,n)=>{const d=new Date(s+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};
const jadMon=s=>{const d=new Date(s+'T00:00:00Z');const wd=(d.getUTCDay()+6)%7;d.setUTCDate(d.getUTCDate()-wd);return d.toISOString().slice(0,10)};
async function jadDivList(){
  if(T.jadDivs)return T.jadDivs;
  if(isDeveloper()||T.dbRole=='hr'||T.dbRole=='legacy_admin'){
    if(T.jadOut===undefined)T.jadOut=(await outInit())||'ALL';
    const oid=T.jadOut==='ALL'?null:T.jadOut;
    T.jadDivs=await payQ('divisions','id,name,code,outlet_id',q=>oid?q.eq('outlet_id',oid).order('name'):q.order('name'));
  }else{
    const sc=await payQ('user_scopes','division_id');const ids=sc.map(x=>x.division_id);
    T.jadDivs=ids.length?await payQ('divisions','id,name,code,outlet_id',q=>q.in('id',ids).order('name')):[];
  }
  return T.jadDivs}
async function jadLoad(){
  try{
    const divs=await jadDivList();
    const multi=isDeveloper()||T.dbRole=='hr'||T.dbRole=='legacy_admin';
    if(!T.jadDid||(T.jadDid!=='ALL'&&!divs.some(d=>d.id==T.jadDid)))T.jadDid=(multi&&divs.length>1)?'ALL':((divs[0]||{}).id||null);
    const ws=T.jadWs||jadMon(today()),we=jadAddDays(ws,6),did=T.jadDid;
    let rows=[];
    if(did==='ALL'){const ids=divs.map(d=>d.id);if(ids.length)rows=await payQ('work_schedules','employee_id,day,code',q=>q.in('division_id',ids).gte('day',ws).lte('day',we))}
    else if(did){rows=await payQ('work_schedules','employee_id,day,code',q=>q.eq('division_id',did).gte('day',ws).lte('day',we))}
    const m={};rows.forEach(r=>m[r.employee_id+'|'+String(r.day).slice(0,10)]=r.code);
    T.jad=m;T.jadKey=ws+'|'+did;
  }catch(e){toast(errText(e),'err');T.jad={};T.jadKey='err'}
  R()}
function jadCellDomId(eid,day){return 'jadcell_'+String(eid).replace(/[^a-zA-Z0-9_-]/g,'_')+'_'+String(day).replace(/[^0-9]/g,'')}
function jadCapturePosition(eid,day){
 const sc=document.querySelector('.jad-table-scroll');
 return {eid,day,scrollY:window.scrollY||0,scrollX:window.scrollX||0,tableLeft:sc?sc.scrollLeft:0};
}
function jadRestorePosition(state){
 if(!state)return;
 setTimeout(()=>requestAnimationFrame(()=>{
  window.scrollTo({left:state.scrollX||0,top:state.scrollY||0,behavior:'auto'});
  const cell=document.getElementById(jadCellDomId(state.eid,state.day));
  const target=cell&&(cell.closest('.cs')||cell);
  const table=target&&target.closest('.jad-table-scroll');
  if(table)table.scrollLeft=state.tableLeft||0;
  if(target){
   const rect=target.getBoundingClientRect();
   if(rect.top<0||rect.bottom>window.innerHeight)target.scrollIntoView({block:'nearest',inline:'nearest',behavior:'auto'});
   target.classList.add('jad-last-edited');
   setTimeout(()=>target.classList.remove('jad-last-edited'),1400);
  }
 }),60);
}
async function jadSet(eid,day,code,didArg){
  const k=eid+'|'+day,did=didArg||T.jadDid,ws=T.jadWs||jadMon(today());
  if(!did||did==='ALL')return toast('Pilih divisi dulu','err');
  const lastPosition=jadCapturePosition(eid,day);
  T.jadLastCell={eid,day};
  const ok=await sbRun(async()=>{const c=sb();
    if(!code){const {error}=await c.from('work_schedules').delete().eq('employee_id',eid).eq('day',day);if(error)throw error}
    else{const {error}=await c.from('work_schedules').upsert({employee_id:eid,division_id:did,week_start:ws,day,code},{onConflict:'employee_id,day'});if(error)throw error}});
  if(ok){if(code)T.jad[k]=code;else delete T.jad[k]}
  R();
  jadRestorePosition(lastPosition);
}function jadNav(n){T.jadWs=jadAddDays(T.jadWs||jadMon(today()),n);T.jadKey=null;R()}
function jadNow(){T.jadWs=jadMon(today());T.jadKey=null;R()}
function jadPick(v){T.jadDid=v;T.jadKey=null;R()}
function jadOutCode(d){const o=(T.outlets||[]).find(x=>x.id==d.outlet_id);return o?o.code:''}
function jadPickOut(v){T.jadOut=v;T.jadDivs=null;T.jadDid=null;T.jadKey=null;T.jad=null;R()}
function jadCard(){
  const ws=T.jadWs||jadMon(today()),we=jadAddDays(ws,6),did=T.jadDid;
  if(T.jadKey!==ws+'|'+did&&!T.jadBusy){T.jadBusy=1;setTimeout(async()=>{try{await jadLoad()}finally{T.jadBusy=0}},0)}
  const locked=today()>=ws;
  const divs=T.jadDivs||[];
  const multi=isDeveloper()||T.dbRole=='hr'||T.dbRole=='legacy_admin';
  const outs=T.outlets||[];
  const osel=multi&&outs.length>1?`<label style="min-width:200px">Outlet<select onchange="jadPickOut(this.value)"><option value="ALL" ${(T.jadOut||'ALL')==='ALL'?'selected':''}>Semua outlet</option>${outs.map(o=>`<option value="${o.id}" ${o.id==T.jadOut?'selected':''}>${esc(o.name)} (${esc(o.code)})</option>`).join('')}</select></label>`:'';
  const dsel=divs.length>1?`<label style="min-width:200px">Divisi<select onchange="jadPick(this.value)">${multi?`<option value="ALL" ${did==='ALL'?'selected':''}>Semua divisi</option>`:''}${divs.map(d=>`<option value="${d.id}" ${d.id==did?'selected':''}>${esc(d.name)}${d.code?' ('+esc(d.code)+')':''}${jadOutCode(d)?' · '+esc(jadOutCode(d)):''}</option>`).join('')}</select></label>`:'';
  const head=`<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px"><div><b>${fdp(ws)} – ${fdp(we)}</b><div class="mu" style="font-size:12px;margin-top:2px">${locked?'Terkunci: minggu sudah dimulai':'Bisa diubah sampai minggu dimulai'}</div></div><div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn s x" onclick="jadNav(-7)">‹ Minggu lalu</button><button class="btn s x" onclick="jadNow()">Minggu ini</button><button class="btn s x" onclick="jadNav(7)">Minggu depan ›</button><button class="btn x" onclick="jadPdf()">Unduh PDF</button></div></div>`;
  if(!T.jad)return `<div class="card"><h3 class="abs-jadwal-heading">Jadwal</h3><p class="mu">Memuat jadwal…</p></div>`;
  if(!did)return `<div class="card"><h3 class="abs-jadwal-heading">Jadwal</h3><p class="mu">Belum ada divisi untuk akun ini.</p></div>`;
  const groups=did==='ALL'?divs:divs.filter(d=>d.id==did);
  const days=[0,1,2,3,4,5,6].map(i=>jadAddDays(ws,i));
  const blocks=groups.map(g=>{
    const emps=D.emp.filter(e=>e.aktif&&String(e.dv)==String(g.id));
    if(!emps.length)return did==='ALL'?'':`<p class="mu">Belum ada karyawan di divisi ini.</p>`;
    const title=did==='ALL'?`<div style="font-weight:700;margin:14px 0 6px">${esc(g.name)} <span class="mu" style="font-weight:500">${esc(g.code||'')}${jadOutCode(g)?' · '+esc(jadOutCode(g)):''}</span></div>`:'';
    return `${title}<div class="jad-table-scroll" style="overflow-x:auto"><table class="rpt" style="min-width:680px"><tr><th>Nama</th>${days.map((d,i)=>`<th style="text-align:center">${JAD_NAMA[i]}<br><span class="mu" style="font-size:10px">${d.slice(8,10)}/${d.slice(5,7)}</span></th>`).join('')}</tr>${emps.map(e=>`<tr><td class="nmc">${esc(e.nama)}</td>${days.map(d=>{const v=T.jad[e.id+'|'+d]||'';return `<td style="text-align:center"><select id="${jadCellDomId(e.id,d)}" data-jad-cell="1" class="jd jd-${jadKey(v)}" ${locked?'disabled':''} onchange="jadSet('${e.id}','${d}',this.value,'${e.dv}')" style="width:104px;min-width:104px;padding:6px 24px 6px 8px;text-align:left">${JAD_CODES.map(c=>`<option value="${c}" ${c==v?'selected':''}>${jadOpt(c)}</option>`).join('')}</select></td>`}).join('')}</tr>`).join('')}</table></div>`}).join('');
  return `<div class="card"><h3 class="abs-jadwal-heading">Jadwal</h3>${(osel||dsel)?`<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px">${osel}${dsel}</div>`:''}${head}${blocks||'<p class="mu">Belum ada karyawan.</p>'}<p class="mu" style="font-size:12px;margin-top:10px">6–12 & 1–2 = jam masuk shift · L = Libur · S = Sakit · PH = Public Holiday</p></div>`}

/* ===== JADWAL: tampilan & unduh PDF ===== */
const jadLabel=c=>c==='L'?'OFF':(JAD_TIME[c]||c||'');
const jadCls=c=>!c?'':c==='L'?'off':c==='S'?'sakit':c==='PH'?'ph':'shift';
function jadPdf(){
  const ws=T.jadWs||jadMon(today()),did=T.jadDid,divs=T.jadDivs||[];
  const groups=did==='ALL'?divs:divs.filter(d=>d.id==did);
  if(!groups.length)return toast('Tidak ada divisi untuk diunduh','err');
  const days=[0,1,2,3,4,5,6].map(i=>jadAddDays(ws,i));
  const dn=['SENIN','SELASA','RABU','KAMIS',"JUM'AT",'SABTU','MINGGU'];
  const pages=groups.map(g=>{
    const emps=D.emp.filter(e=>e.aktif&&String(e.dv)==String(g.id));
    if(!emps.length)return '';
    const ol=(T.outlets||[]).find(o=>o.id==g.outlet_id)||{};
    const head=`<div class="hd"><div class="l">DEPARTMENT: ${esc(String(g.name).toUpperCase())}</div><div class="r">${esc(String(ol.name||'').toUpperCase())} WORK SCHEDULE</div></div>`;
    const rowsHtml=emps.map((e,i)=>`<tr><td>${i+1}</td><td class="n">${esc(e.nama)}</td><td class="n">${esc(e.jab||'')}</td>${days.map(d=>{const c=T.jad[e.id+'|'+d]||'';return `<td class="c s-${jadKey(c)}">${esc(jadLabel(c))}</td>`}).join('')}</tr>`).join('');
    return `<section>${head}<table><thead><tr><th rowspan="2">NO</th><th rowspan="2">NAME</th><th rowspan="2">ROLE</th>${days.map(d=>`<th>${d.slice(8,10)}/${d.slice(5,7)}</th>`).join('')}</tr><tr>${dn.map(x=>`<th>${x}</th>`).join('')}</tr></thead><tbody>${rowsHtml}</tbody></table></section>`;
  }).join('');
  const css="@page{size:landscape;margin:12mm}body{font-family:Arial,Helvetica,sans-serif;color:#222;margin:0}section{page-break-after:always}section:last-child{page-break-after:auto}.hd{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;border-bottom:2px solid #7a2e22;padding-bottom:6px}.l{font-weight:700;font-size:16px}.r{font-weight:800;font-size:18px;color:#7a2e22}table{border-collapse:collapse;width:100%;font-size:11px}th,td{border:1px solid #999;padding:5px 4px;text-align:center}th{background:#f1d9d1;font-weight:700}td.n{text-align:left}td.c{font-weight:700}.s-shift{background:#e3f1d6}.s-off{background:#e6e4e0}.s-sakit{background:#f8d6c4}.s-ph{background:#d4e3f6}.s-blank{background:#fff}";
  const extraCss=`/* Sidebar/header finishing pass: keep the full navigation list usable. */
@media(min-width:900px){
  .side{overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:var(--br) transparent}
  .side .brand{position:sticky;top:0;z-index:2;flex:0 0 auto;background:var(--cd)}
  .side .nvl,.side .nv{flex:0 0 auto}
  .side .nv{padding-bottom:3px}
  .side .nvb{min-height:42px;padding-top:9px;padding-bottom:9px}
  .side .nvb span{overflow-wrap:anywhere}
  .side .sidew{flex:0 0 auto;margin-top:18px}
  .app-top{padding-top:14px;padding-bottom:14px}
  .hd-t small{max-width:min(68vw,760px)}
}
@media(max-width:899px){
  .hd-t{flex:1 1 120px}
  .hd-r{flex:0 0 auto}
  .hd-t small{max-width:100%}
  .dd{max-width:calc(100vw - 24px)}
}

/* Typography and icon consistency: clean SaaS / Lucide visual language. */
:root{--fn:'Plus Jakarta Sans';--fh:'Plus Jakarta Sans'}
body,#app,button,input,select,textarea,.nvb,.dd button,.sdi button{
  font-family:'Plus Jakarta Sans',system-ui,-apple-system,sans-serif!important;
}
h1,h2,h3,h4,h5,h6,.brand b,.hd-t h1,.card>h3:first-child,.md>h3:first-child{
  font-family:'Plus Jakarta Sans',system-ui,-apple-system,sans-serif!important;
  letter-spacing:-.025em;
}
.ic{flex:0 0 auto;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.nvb .ic,.dd button .ic,.sdi button .ic,.ibtn .ic{width:18px;height:18px}
.brand .ic,.brand-m .ic{width:21px;height:21px}
.toolbar .ic{vertical-align:-3px;margin-right:3px}

/* Final header and navigation polish for the clean SaaS layout. */
.hd{gap:10px}
.hd-t h1{font-size:clamp(17px,1.25vw,20px);font-weight:750;letter-spacing:-.035em}
.hd-t small{font-size:11.5px;line-height:1.45}
.nvb{gap:11px}
.nvb .ic{width:19px;height:19px}
.nvb.on .ic{stroke-width:2}
.settings-btn .ic{width:19px;height:19px}
.dd select{font:inherit;color:var(--tx);background:var(--bg);border:1px solid var(--br);border-radius:10px;padding:9px 10px}
@media(max-width:899px){
  .hd{gap:8px}
  .hd-t h1{font-size:17px}
  .hd-t small{font-size:10.5px}
  .hd-r{gap:6px}
  .ibtn{width:40px;height:40px;border-radius:12px}
}

/* Mobile navigation and compact controls: avoid clipped labels and oversized drawers. */
@media(max-width:599px){
  .mods-title{letter-spacing:-.025em}
  .modal .grid{grid-template-columns:repeat(2,minmax(0,1fr))!important}
  .modal .btn{min-width:0;overflow-wrap:anywhere}
  .modal .btn .ic{max-width:28px;max-height:28px}
  .dd{min-width:min(236px,calc(100vw - 24px));max-width:calc(100vw - 24px)}
  .hd-t{min-width:0}
  .hd-t small{white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
}
@media(min-width:600px) and (max-width:899px){
  .modal .grid{grid-template-columns:repeat(3,minmax(0,1fr))}
}

/* Navigation state and compact header interaction polish. */
.nvb[aria-current="page"]{font-weight:750;box-shadow:inset 3px 0 0 var(--ac)}
.nvb .ic{transition:transform .18s ease}
.nvb:hover .ic{transform:translateX(1px)}
.nvb:active .ic{transform:scale(.96)}
.settings-dd{padding:8px}
.settings-dd button{border-radius:9px}
.settings-dd button:hover{background:var(--in)}
.hd-refresh:hover{border-color:#b8d8c4;color:var(--ac);background:#f3faf5}
@media(prefers-reduced-motion:reduce){.nvb .ic{transition:none!important}}
/* Always-visible date and refresh affordance in the main header. */
.hd-date{display:inline-flex;align-items:center;gap:7px;min-height:38px;padding:0 11px;border:1px solid var(--br);border-radius:11px;background:var(--cd);color:var(--mu);font-size:11px;font-weight:650;white-space:nowrap}
.hd-date .ic{width:16px;height:16px;color:var(--gr)}
.hd-refresh{flex:0 0 auto}
@media(max-width:899px){.hd-date{display:none}}
@media(max-width:599px){.hd-refresh{width:38px;height:38px}}
/* Accessibility and compact header controls */
.nvb:focus-visible,.ibtn:focus-visible,.brand:focus-visible,.brand-m:focus-visible,
.btn:focus-visible,.dd button:focus-visible,.dd select:focus-visible{
  outline:3px solid rgba(22,134,83,.32)!important;
  outline-offset:2px!important;
}
.settings-mn{position:relative;flex:0 0 auto}
.settings-dd{z-index:80;max-height:min(72vh,560px);overflow-y:auto;overscroll-behavior:contain}
.settings-dd hr{border:0;border-top:1px solid var(--br);margin:7px 0}
.settings-dd button,.settings-dd select{min-height:40px}
.hd-r{align-items:center}
@media(min-width:900px){
  .app-top{position:sticky;top:0;z-index:25}
  .hd-t{min-width:0}
  .hd-t small{overflow-wrap:anywhere}
}
@media(max-width:599px){
  .app-top{padding-top:10px!important;padding-bottom:10px!important}
  .hd{align-items:center}
  .hd-t{flex:1 1 110px;min-width:0}
  .hd-t h1{overflow-wrap:anywhere}
  .hd-r{gap:5px}
  .settings-dd{right:0;left:auto;min-width:min(260px,calc(100vw - 24px))}
  .settings-dd button{white-space:normal;text-align:left}
}

/* Keep the active outlet visible in the desktop header for multi-outlet roles. */
.hd-outlet{display:flex;flex-direction:column;justify-content:center;gap:3px;min-width:145px;max-width:205px;padding:0 4px}
.hd-outlet>small{font-size:10px;color:var(--muted,#6b7b72);line-height:1.2}
.hd-outlet select{width:100%;min-width:0;max-width:100%;min-height:36px;padding:6px 28px 6px 9px;border:1px solid var(--br,#dce8df);border-radius:9px;background:var(--card,#fff);color:var(--tx,#172b23);font:inherit;font-size:12px}
@media(max-width:899px){.hd-outlet{min-width:112px;max-width:150px;padding:0}.hd-outlet select{min-height:34px;font-size:11px}}
@media(max-width:599px){.hd-outlet{flex:1 1 100%;max-width:none;order:5}.hd-outlet select{min-height:36px}}
/* Operational screen finishing pass: inventory, receiving, issues and COGS forms */
main .card label{min-width:0}
main .card input:not([type=checkbox]):not([type=radio]):not([type=hidden]),
main .card select,main .card textarea{
  max-width:100%;box-sizing:border-box
}
main .card input:disabled,main .card select:disabled,main .card textarea:disabled{
  cursor:not-allowed;opacity:.72
}
.cogs-wrap,.cogs-wrap>.card,.cogs-wrap .card{min-width:0;max-width:100%}
.cogs-scroll{
  max-width:100%;overflow-x:auto;overflow-y:hidden;
  -webkit-overflow-scrolling:touch;overscroll-behavior-x:contain;
  scrollbar-width:thin;scrollbar-color:#cbd9cf transparent
}
.cogs-table{border-collapse:separate;border-spacing:0}
.cogs-table td,.cogs-table th{vertical-align:middle}
.cogs-table input,.cogs-table select{min-width:84px;max-width:100%}
/* Mobile Daily SO: make the unit column roughly half-width without affecting other tables. */
@media(max-width:600px){
 main .cogs-wrap .ops-daily-so-table th:nth-child(3),
 main .cogs-wrap .ops-daily-so-table td:nth-child(3){width:92px!important;min-width:92px!important;max-width:92px!important;padding-left:5px!important;padding-right:5px!important}
 main .cogs-wrap .ops-daily-so-table td:nth-child(3) select{display:block;width:82px!important;min-width:0!important;max-width:82px!important;padding-left:7px!important;padding-right:20px!important;box-sizing:border-box!important;font-size:12px!important}
}
/* Mobile Penjualan Menu: fixed viewport-width columns, single-line menu names,
   and no horizontal scrolling. Desktop layout remains unchanged. */
@media(max-width:600px){
 html,body,#app,main,.cogs-wrap,.cogs-wrap>.card,.cogs-wrap .card{max-width:100%;min-width:0;overflow-x:clip}
 main .cogs-wrap .cogs-scroll:has(table.ops-sale-entry-table){
  display:block!important;width:100%!important;max-width:100%!important;min-width:0!important;
  overflow-x:hidden!important;overflow-y:visible!important;touch-action:pan-y!important
 }
 main .cogs-wrap table.ops-sale-entry-table{
  display:block!important;width:100%!important;min-width:0!important;max-width:100%!important;
  table-layout:fixed!important;box-sizing:border-box!important;border-collapse:separate!important;
  border-spacing:0!important;overflow:hidden!important
 }
 main .cogs-wrap .ops-sale-entry-table thead,
 main .cogs-wrap .ops-sale-entry-table tbody{display:block!important;width:100%!important;min-width:0!important;max-width:100%!important}
 main .cogs-wrap .ops-sale-entry-table tr{
  display:grid!important;grid-template-columns:minmax(0,46%) minmax(0,54%)!important;
  width:100%!important;max-width:100%!important;min-width:0!important;box-sizing:border-box!important
 }
 main .cogs-wrap .ops-sale-entry-table th,
 main .cogs-wrap .ops-sale-entry-table td{
  display:block!important;width:100%!important;min-width:0!important;max-width:100%!important;
  box-sizing:border-box!important;padding:12px 8px!important;white-space:normal!important;
  overflow-wrap:normal!important;word-break:normal!important;overflow:hidden!important
 }
 main .cogs-wrap .ops-sale-entry-table th{font-size:11px!important;line-height:1.35!important}
 main .cogs-wrap .ops-sale-entry-table th:nth-child(3),
 main .cogs-wrap .ops-sale-entry-table td:nth-child(3){display:none!important}
 main .cogs-wrap .ops-sale-entry-table td:first-child b{
  display:block!important;width:100%!important;min-width:0!important;max-width:100%!important;
  white-space:nowrap!important;text-overflow:ellipsis!important;overflow:hidden!important;
  overflow-wrap:normal!important;word-break:normal!important;line-height:1.4!important
 }
 main .cogs-wrap .ops-sale-entry-table input.ops-entry-qty{
  display:block!important;width:100%!important;min-width:0!important;max-width:100%!important;
  height:48px!important;margin:0!important;padding:10px 10px!important;box-sizing:border-box!important;
  font-size:16px!important;border-radius:10px!important
 }
}
.inv-actions{align-items:center}
.inv-actions>*{min-width:0}
@media(max-width:700px){
  .cogs-wrap .cogs-top{gap:10px}
  .cogs-wrap .cogs-top>label{width:100%;max-width:none!important}
  .cogs-wrap .cogs-top input,.cogs-wrap .cogs-top select{width:100%;box-sizing:border-box}
  .cogs-wrap .btns{gap:8px}
  .cogs-wrap .btns>.btn{min-width:0}
  .inv-actions{gap:8px}
  .inv-actions .btn{flex:1 1 135px}
}
@media(max-width:380px){
  main .card{padding:12px!important}
  .cogs-wrap .btns>.btn{flex:1 1 100%}
  .inv-actions .btn{flex:1 1 100%}
}
`;
const html='<!doctype html><html><head><meta charset="utf-8"><title>Jadwal '+ws+'</title><style>'+css+extraCss+'</style></head><body>'+(pages||'<p>Belum ada karyawan.</p>')+'<scr'+'ipt>window.onload=function(){window.print()}</scr'+'ipt></body></html>';
  const w=window.open('','_blank');
  if(!w)return toast('Izinkan pop-up untuk mengunduh PDF','err');
  w.document.open();w.document.write(html);w.document.close();
}

let csSeq=0;