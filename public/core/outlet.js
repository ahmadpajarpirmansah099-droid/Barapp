/* ===== OUTLET (dev bisa pindah outlet; data tiap outlet terpisah) ===== */
async function outInit(){
  const validUuid=id=>!!id&&typeof id==='string'&&!['null','undefined','all'].includes(id.trim().toLowerCase())&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id.trim());
  if(!T.outlets){try{T.outlets=await payQ('outlets','id,code,name,active',q=>q.eq('active',true).order('code'))}catch(e){T.outlets=[]}}
  if(T.outlets.length){const l=T.outlets.find(x=>['LJ','LJN'].includes(String(x.code||'').toUpperCase())||String(x.name||'').trim().toUpperCase()==='LAZY JENNIE')||T.outlets[0];if(l&&validUuid(l.id))D.ljId=l.id}
  const multi=isDeveloper();
  if(!multi){
    if(T.scopeOut===undefined){
      try{
        const sc=await payQ('user_scopes','outlet_id');
        const ids=[...new Set((sc||[]).map(x=>String(x.outlet_id||'')).filter(validUuid))];
        T.scopeOut=ids.length===1?ids[0]:null;
        T.scopeInvalid=ids.length!==1;
      }catch(e){T.scopeOut=null;T.scopeInvalid=true}
    }
    const activeScope=validUuid(T.scopeOut)&&(T.outlets||[]).some(o=>String(o.id)===String(T.scopeOut)&&(o.active===true||o.active==='true'));
    if(activeScope){
      D.outId=T.scopeOut;
      try{localStorage.setItem('bar_out_'+((D.me&&D.me.uid)||''),T.scopeOut)}catch(e){}
      sv();
      return T.scopeOut;
    }
    D.outId=null;T.scopeInvalid=true;
    try{localStorage.removeItem('bar_out_'+((D.me&&D.me.uid)||''))}catch(e){}
    sv();
    return null;
  }
  const ok=id=>!!id&&id!=='ALL'&&T.outlets.some(o=>o.id==id);
  if(!T.outlets.length)return validUuid(D.outId)?D.outId:(validUuid(D.ljId)?D.ljId:null);
  if(!ok(D.outId)){let r=null;try{r=localStorage.getItem('bar_out_'+((D.me&&D.me.uid)||''))}catch(e){}
    D.outId=ok(r)?r:(D.ljId||null);sv()}
  return validUuid(D.outId)?D.outId:(validUuid(D.ljId)?D.ljId:null)}
async function outSwitch(id){
  if(!isDeveloper()){toast('Hanya Developer yang bisa mengganti outlet.','err');return}
  if(!T.outlets?.some(o=>String(o.id)===String(id)&&(o.active===true||o.active==='true'))){toast('Outlet tidak aktif atau tidak valid.','err');return}
  if(!id||String(id)===String(D.outId))return;
  D.outId=id;sv();try{localStorage.setItem('bar_out_'+((D.me&&D.me.uid)||''),id)}catch(e){}F.f='';F.t='';
  T.divs=null;T.divInit=0;T.dvDet=null;T.jadDivs=null;T.jadDid=null;T.jadKey=null;T.jad=null;T.jadOut=undefined;
  D.emp=[];D.att=[];D.ot=[];
  PAY.run=null;PAY.items=[];PAY.rep=null;PAY.urls={};PAY.lapInit=false;PAY.need=true;PAY.busy=false;
  PAY.pp={};PAY.allow=[];PAY.cash=[];PAY.bal={};
  INV.items=[];INV.wips=[];INV.ins=[];INV.rets=[];INV.stockOut=[];INV.suppliesSO=[];INV.suppliesSOLines=[];INV.qtyByItem=null;INV.qtyByWip=null;INV.productionBatches=[];INV.productionInputs=[];INV.menuSales=[];INV.menuSalesLines=[];INV.dailySO=[];INV.dailySOLines=[];INV.ready=false;INV.init=false;INV.err='';SUPS.division='';SUPS.date=today();SUPS.historyDate=today();SUPS.position=[];SUPS.positionLoadedFor='';SUPS.positionLoading=false;SUPS.positionError='';SUPS.actuals={};
  CG.items=[];CG.wips=[];CG.wipLines=[];CG.menus=[];CG.menuLines=[];CG.productions=[];CG.productionInputs=[];CG.sales=[];CG.saleLines=[];CG.dailySO=[];CG.dailySOLines=[];CG.ready=false;CG.err='';CG.filter='';CG.materialTab='active';CG.wipTab='active';CG.menuTab='active';
  OPS.division='';OPS.date=today();OPS.prodHistoryDate=today();OPS.soHistoryDate=today();OPS.position=[];OPS.positionLoadedFor='';OPS.positionLoading=false;OPS.positionError='';OPS.counts={};
  if(typeof guestArrivalOutletChanged==='function')guestArrivalOutletChanged();
  toast('Outlet diganti · memuat data outlet baru…');R();
  try{await sbLoad();await Promise.all([payLoad(),invLoad(true),cgLoad(true)]);if(pg==='cogs_daily_so'||pg==='cogs_production')await opsLoadPosition(true);R();toast('Data outlet baru sudah dimuat.','ok')}
  catch(e){R();toast('Outlet berubah, tetapi sebagian data gagal dimuat. Tekan Muat ulang pada halaman terkait.','err')}
}
function outMenuHtml(){
  if(!isDeveloper())return '';
  if(!Array.isArray(T.outlets)||!T.outlets.length){
    if(!T.outMenuLoading){T.outMenuLoading=true;setTimeout(async()=>{try{T.outlets=await payQ('outlets','id,code,name,active',q=>q.eq('active',true).order('code'));if(!D.ljId&&T.outlets.length)D.ljId=T.outlets.find(x=>x.code=='LJ')?.id||T.outlets[0].id}catch(e){T.outlets=[]}finally{T.outMenuLoading=false;R()}},0)}
    return '<div class="hd-outlet"><small>Outlet</small><div class="mu" style="padding:8px 0">Memuat daftar outlet…</div></div>';
  }
  const cur=(D.outId&&D.outId!=='ALL')?D.outId:(D.ljId||T.outlets[0].id);
  const opts=T.outlets.map(o=>`<option value="${o.id}" ${o.id==cur?'selected':''}>${esc(o.name)} (${esc(o.code)})</option>`).join('');
  return `<div class="hd-outlet"><small>Outlet</small><select aria-label="Pilih outlet aktif" onchange="outSwitch(this.value)">${opts}</select></div>`}
