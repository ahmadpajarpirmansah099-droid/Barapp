/* Extracted from index.html inline script 4. Preserve original execution order. */
if('serviceWorker' in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}))}

/* ===== COGS OPERATIONS: production WIP, Daily SO, and menu sales ===== */
const opsDivName=id=>(CG.divs.find(d=>String(d.id)===String(id))||{}).name||'Divisi';
function opsDivisionSelector(){const id=OPS.division||CG.divs[0]?.id||'';return '<div class="cogs-formgrid"><label>Divisi<select onchange="opsSetDivision(this.value)">'+CG.divs.map(d=>'<option value="'+d.id+'" '+(String(d.id)===String(id)?'selected':'')+'>'+esc(d.name)+'</option>').join('')+'</select></label></div>';}
const opsWip=id=>CG.wips.find(x=>String(x.id)===String(id));
const opsMenu=id=>CG.menus.find(x=>String(x.id)===String(id));
const opsKey=(type,id)=>type+':'+id;
const opsDate=()=>today();
const opsErr=e=>{
 const m=String(e&&e.message||e||'');
 if(/COGS_SO_ALREADY_SUBMITTED/i.test(m))return 'Daily SO tanggal ini sudah disimpan. Batalkan rekaman lama dulu kalau perlu koreksi.';
 if(/COGS_SO_MUST_COUNT_ALL_ITEMS/i.test(m))return 'Semua bahan dan WIP dalam daftar wajib dihitung.';
 if(/COGS_PRICE_MISSING|COGS_CHILD_COST_MISSING/i.test(m))return 'HPP tidak valid: ada bahan tanpa harga pembelian terakhir maupun harga acuan.';
 if(/COGS_RECIPE_EMPTY/i.test(m))return 'Resep belum lengkap.';
 if(/COGS_DIVISION_FORBIDDEN|42501|row-level security/i.test(m))return 'Akses ke divisi ini ditolak oleh aturan keamanan.';
 if(/COGS_WIP_NOT_ACTIVE/i.test(m))return 'WIP tidak aktif atau tidak ditemukan.';
 if(/COGS_MENU_NOT_ACTIVE/i.test(m))return 'Menu tidak aktif atau tidak ditemukan.';
 if(/schema cache|PGRST205|42P01|does not exist/i.test(m))return 'Backend data operasional belum tersedia. Periksa migrasi modul operasional.';
 return errText(e);
};
function opsUnitItem(p){return p.component_type==='material'?invItem(p.component_id):null}
function opsUnitList(p){const item=opsUnitItem(p),base=String(p.unit||item?.base_unit||'UNIT');if(p.component_type!=='material')return[{unit:base,factor:1}];let a=Array.isArray(item?.conversions)?item.conversions:[];a=a.filter(x=>x&&x.unit&&Number(x.factor)>0).map(x=>({unit:String(x.unit),factor:Number(x.factor)}));if(!a.some(x=>x.unit.toUpperCase()===base.toUpperCase()))a.unshift({unit:base,factor:1});const seen=new Set();return a.filter(x=>{const k=x.unit.toLowerCase();if(seen.has(k))return false;seen.add(k);return true})}
function opsDefaultUnit(p,k){const units=opsUnitList(p),item=opsUnitItem(p);if(OPS.unitSelections?.[k]&&units.some(u=>u.unit===OPS.unitSelections[k]))return OPS.unitSelections[k];const name=String(p.component_name||item?.name||'').trim().toLocaleLowerCase().replace(/\s+/g,' '),preferred={'skm':'CAN','skm coklat':'PACK','galon aqua':'GALON','galon vit':'GALON','es batu atlas':'BALL','gingerale':'CAN'}[name];if(preferred){const found=units.find(u=>String(u.unit||'').trim().toUpperCase()===preferred);if(found)return found.unit}for(const wanted of ['GALON','CAN','BALL']){const found=units.find(u=>String(u.unit||'').trim().toUpperCase()===wanted);if(found)return found.unit}return String(p.unit||item?.base_unit||units[0]?.unit||'UNIT')}
function opsUnitFactor(p,k){const units=opsUnitList(p),want=opsDefaultUnit(p,k);return units.find(x=>x.unit===want)?.factor||1}
function opsSetCountUnit(k,u){if(!OPS.unitSelections)OPS.unitSelections={};OPS.unitSelections[k]=u;R()}
function opsCountInput(k,val,factor){OPS.counts[k]=val===''?'':Number(val)*Number(factor);const key=(OPS.division||'')+'|'+(OPS.date||opsDate());OPS.countCache[key]=Object.assign({},OPS.counts)}
async function opsLoadUnitMaster(){
 if(INV.ready)return;
 // Daily SO needs only item units/conversions, not the full inventory history.
 const activeOutletId=await outInit();
 if(!activeOutletId||! /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(activeOutletId)))throw new Error('OUTLET_ACTIVE_REQUIRED');
 const outletKey=String(activeOutletId);
 // Reuse the lightweight Master Barang cache for this outlet; INV.ready remains reserved for the full inventory load.
 if(INV.unitMasterOutletId===outletKey)return;
 const divResult=await sb().from('divisions').select('id,name,outlet_id,code,active,has_cogs,module_config').eq('outlet_id',activeOutletId).order('name');
 if(divResult.error)throw divResult.error;
 const outletDivs=divResult.data||[];
 // Query only Master Barang rows for divisions the current COGS session is allowed to access.
 const visibleIds=(CG.divs||[]).map(d=>String(d.id));
 let items=[];
 if(visibleIds.length){
  const itemResult=await sb().from('barapp_items').select('*').in('division_id',visibleIds).order('created_at',{ascending:false}).limit(5000);
  if(itemResult.error)throw itemResult.error;
  items=itemResult.data||[];
 }
 // Do not let an old outlet request overwrite the cache after the user switches outlets.
 if(String(await outInit())!==outletKey)return;
 if(INV.ready)return;
 INV.divs=outletDivs;
 INV.items=items;
 INV.unitMasterOutletId=outletKey;
}
async function opsLoadPosition(show,force){
 if(!CG.ready)return;
 const div=OPS.division||CG.divs[0]?.id||'',date=OPS.date||opsDate(),key=div+'|'+date;
 if(OPS.positionLoading&&!force)return;
 if(!force&&OPS.positionLoadedFor===key)return;
 const requestId=(OPS.positionRequestId||0)+1;OPS.positionRequestId=requestId;
 OPS.positionLoading=true;OPS.positionError='';OPS.positionErrorFor='';if(show&&pg==='cogs_daily_so')R();
 let timeoutId=null,controller=null;
 try{
  // One deadline covers both the lightweight unit-cache preflight and the stock-position RPC.
  const timeout=new Promise((_,reject)=>{timeoutId=setTimeout(()=>{if(controller)controller.abort();reject(new Error('SO_POSITION_TIMEOUT'))},25000)});
  if(!INV.ready){
   try{await Promise.race([opsLoadUnitMaster(),timeout])}
   catch(e){if(/SO_POSITION_TIMEOUT/.test(String(e&&e.message||e)))throw e;console.warn('Master Barang units could not be loaded for Daily SO:',e)}
  }
  if(requestId!==OPS.positionRequestId)return;
  if(!div){
   const hasServiceDivision=(INV.divs||[]).some(d=>/service/i.test(String(d.code||d.name||'')));
   OPS.positionError=hasServiceDivision
    ?'Divisi Service tidak memakai Daily SO COGS. Untuk stok guest supplies, buka menu SUPLIES (Daily SO SUPLIES).'
    :'Belum ada divisi COGS yang bisa diakses untuk Daily SO ini.';
   OPS.positionErrorFor=key;OPS.position=[];return;
  }
  // If the selected outlet/division/date changed while the unit cache was loading, skip this stale request.
  const requestKey=(OPS.division||CG.divs[0]?.id||'')+'|'+(OPS.date||opsDate());
  if(requestId!==OPS.positionRequestId||requestKey!==key)return;
  const request=sb().rpc('cogs_get_stock_position',{p_division_id:div,p_as_of:date});
  if(typeof AbortController==='function'&&request&&typeof request.abortSignal==='function'){
   controller=new AbortController();request.abortSignal(controller.signal);
  }
  const result=await Promise.race([request,timeout]);
  if(timeoutId){clearTimeout(timeoutId);timeoutId=null}
  const {data,error}=result;
  if(error)throw error;
  // Ignore a slow response if the user has changed the outlet division or date while it was loading.
  const currentKey=(OPS.division||CG.divs[0]?.id||'')+'|'+(OPS.date||opsDate());
  if(requestId!==OPS.positionRequestId||currentKey!==key)return;
  let rows=(data||[]).sort((a,b)=>invAlpha(a.component_name,b.component_name)||invAlpha(a.component_type,b.component_type));
  const existing=CG.dailySO.find(s=>String(s.division_id)===String(div)&&String(s.so_date)===String(date)&&s.status==='submitted');
  if(existing){
   const old=CG.dailySOLines.filter(l=>String(l.so_id)===String(existing.id));
   rows=rows.map(p=>{
    const l=old.find(x=>x.component_type===p.component_type&&String(p.component_id)==String(p.component_type==='material'?x.item_id:x.component_wip_id));
    return l?Object.assign({},p,{component_name:l.component_name_snapshot,unit:l.unit_snapshot,expected_qty_base:l.expected_qty_base,unit_cost:l.unit_cost_snapshot,stored_counted_qty:l.counted_qty_base,stored_variance_qty:l.variance_qty_base,stored_variance_value:l.variance_value_snapshot}):p;
   });
   // Preserve the complete submitted SO snapshot in history, including items later deactivated.
   const present=new Set(rows.map(p=>opsKey(p.component_type,p.component_id)));
   old.forEach(l=>{
    const type=l.component_type,id=type==='material'?l.item_id:l.component_wip_id,k=opsKey(type,id);
    if(!present.has(k)){
     rows.push({component_type:type,component_id:id,component_name:l.component_name_snapshot,unit:l.unit_snapshot,
      expected_qty_base:l.expected_qty_base,unit_cost:l.unit_cost_snapshot,cost_source:'snapshot',
      stored_counted_qty:l.counted_qty_base,stored_variance_qty:l.variance_qty_base,stored_variance_value:l.variance_value_snapshot});
     present.add(k);
    }
   });
   OPS.counts={};rows.forEach(p=>OPS.counts[opsKey(p.component_type,p.component_id)]=p.stored_counted_qty==null?'':String(p.stored_counted_qty));
  }else{
   OPS.counts=Object.assign({},OPS.countCache?.[key]||{});rows.forEach(p=>{const k=opsKey(p.component_type,p.component_id);if(!(k in OPS.counts))OPS.counts[k]=''});
  }
  OPS.position=rows;OPS.positionLoadedFor=key;if(show)toast('Saldo berhasil dimuat: '+rows.length+' item.','ok');
 }catch(e){
  if(timeoutId){clearTimeout(timeoutId);timeoutId=null}
  const currentKey=(OPS.division||CG.divs[0]?.id||'')+'|'+(OPS.date||opsDate());
  if(requestId!==OPS.positionRequestId||currentKey!==key)return;
  OPS.positionError=/SO_POSITION_TIMEOUT/.test(String(e&&e.message||e))
   ?'Penghitungan saldo melewati 25 detik dan dibatalkan. Periksa koneksi lalu coba muat saldo lagi.'
   :opsErr(e);
  OPS.positionErrorFor=key;OPS.position=[];if(show)toast(OPS.positionError,'err')
 }finally{
  if(timeoutId)clearTimeout(timeoutId);
  if(requestId===OPS.positionRequestId){OPS.positionLoading=false;}
  if(requestId===OPS.positionRequestId&&pg==='cogs_daily_so'){
   R();
   if(show&&OPS.positionLoadedFor===key){
    const table=document.querySelector('.ops-daily-so-table');
    if(table)table.scrollIntoView({behavior:'smooth',block:'start'});
   }
   const latestKey=(OPS.division||CG.divs[0]?.id||'')+'|'+(OPS.date||opsDate());
   if(latestKey!==key)opsLoadPosition(false);
  }
 }
}
function opsRetryPosition(){OPS.positionError='';OPS.positionErrorFor='';OPS.positionLoadedFor='';OPS.position=[];opsLoadPosition(true,true)}
function opsSetDivision(id){OPS.division=id;OPS.positionLoadedFor='';OPS.positionError='';OPS.positionErrorFor='';OPS.position=[];OPS.counts={};if(pg==='cogs_daily_so')opsLoadPosition(true,true);else R()}
function opsSetDate(date,force){const next=date||opsDate(),div=OPS.division||CG.divs[0]?.id||'',key=div+'|'+next;if(OPS.positionLoading&&next===OPS.date&&!force)return;if(!force&&next===OPS.date&&OPS.positionLoadedFor===key)return;OPS.date=next;const input=document.getElementById('ops_so_date');if(input&&input.value!==next)input.value=next;OPS.positionLoadedFor='';OPS.position=[];OPS.positionError='';OPS.positionErrorFor='';OPS.counts=Object.assign({},OPS.countCache?.[key]||{});opsLoadPosition(true,true)}
async function opsAddEntryRow(kind){
 const tbody=document.getElementById(kind==='sale'?'ops_sale_entry_rows':'ops_prod_entry_rows');if(!tbody)return;
 const first=tbody.querySelector('.ops-entry-row');if(!first)return;
 const row=first.cloneNode(true);
 row.querySelectorAll('select').forEach(el=>el.value='');
 row.querySelectorAll('input').forEach(el=>el.value='');
 const action=row.querySelector('button');if(action){action.textContent='Hapus';action.className='btn x d';action.setAttribute('onclick',"this.closest('.ops-entry-row').remove()");}
 tbody.appendChild(row);
}
function opsEntryRows(kind){
 const tbodyId=kind==='sale'?'ops_sale_entry_rows':'ops_prod_entry_rows';
 const raw=Array.from(document.querySelectorAll('#'+tbodyId+' .ops-entry-row')).map(el=>({id:String(el.dataset.itemId||el.querySelector('.ops-entry-item')?.value||'').trim(),qty:String(el.querySelector('.ops-entry-qty')?.value||'').trim(),fixedItem:!!el.dataset.itemId}));
 // Pada tabel yang menampilkan semua item, item sudah terpilih secara default.
 // Baris tersebut baru dianggap mulai diisi ketika QTY diisi; untuk dropdown,
 // pemilihan item saja tetap dianggap sebagai baris yang mulai diisi.
 const filled=raw.filter(x=>x.qty!==''||(!x.fixedItem&&x.id));
 if(filled.some(x=>!x.id||x.qty===''))return {rows:[],error:kind==='sale'?'Lengkapi ITEM MENU dan QTY pada setiap baris yang mulai diisi.':'Lengkapi ITEM WIP dan jumlah batch pada setiap baris yang mulai diisi.'};
 if(filled.some(x=>!Number.isFinite(Number(x.qty))||Number(x.qty)<=0))return {rows:[],error:kind==='sale'?'QTY terjual harus angka lebih besar dari 0.':'Jumlah batch harus angka lebih besar dari 0.'};
 return {rows:filled};
}
async function opsRecordProductionBatch(){
 if(!cgRoleOK())return;
 const division=v('ops_prod_div'),produced_at=v('ops_prod_date')||opsDate(),notes=v('ops_prod_note').trim(),parsed=opsEntryRows('production');
 if(parsed.error)return toast(parsed.error,'warn');
 const rows=parsed.rows.map(x=>({wip_id:x.id,batches:Number(x.qty)}));
 if(!division)return toast('Pilih divisi terlebih dahulu.','warn');
 if(!rows.length)return toast('Pilih ITEM WIP dan isi jumlah batch untuk minimal satu baris.','warn');
 for(const x of rows){
  const w=opsWip(x.wip_id);
  if(!w)return toast('Item WIP tidak ditemukan. Muat ulang data.','err');
  if(!Number.isInteger(x.batches)||x.batches<=0)return toast('Jumlah batch harus bilangan bulat lebih besar dari 0.','warn');
  if(!Number.isFinite(Number(w.yield_qty))||Number(w.yield_qty)<=0)return toast('Hasil per batch untuk WIP '+w.name+' belum diatur di resep.','err');
  const c=cgWipCost(x.wip_id,[]);
  if(!c.ok)return toast('Resep WIP '+w.name+' belum valid: '+c.reason,'err');
  x.produced_qty=x.batches*Number(w.yield_qty);
 }
 const btn=document.getElementById('ops_prod_save');if(btn){btn.disabled=true;btn.textContent='Menyimpan…'}
 try{
  const lines=rows.map(x=>({wip_id:x.wip_id,batches:x.batches}));
  const {data,error}=await sb().rpc('cogs_record_production_batch',{p_division_id:division,p_produced_at:produced_at,p_lines:lines,p_notes:notes||null});
  if(error)throw error;
  await opsReload();toast('Berhasil menyimpan '+(data??rows.length)+' item produksi WIP. Qty stok dihitung otomatis dari jumlah batch × hasil per batch.','ok');
 }catch(e){toast(opsErr(e),'err')}
 finally{const b=document.getElementById('ops_prod_save');if(b){b.disabled=false;b.textContent='Simpan produksi'}}
}
async function opsRecordSalesTable(){
  if(!cgRoleOK())return;
  const parsed=opsEntryRows('sale');
  if(parsed.error)return toast(parsed.error,'warn');
  const division=v('ops_sale_div'),sold_at=v('ops_sale_date')||opsDate(),notes=(v('ops_sale_note')||'').trim();
  const rows=parsed.rows.map(x=>({menu_id:x.id,qty:Number(x.qty)}));
  if(!division)return toast('Pilih divisi terlebih dahulu.','warn');
  if(!rows.length)return toast('Pilih ITEM MENU dan isi QTY YANG TERJUAL untuk minimal satu baris.','warn');
  const seen=new Set();
  for(const x of rows){
    if(!x.menu_id||!Number.isFinite(x.qty)||x.qty<=0)return toast('Periksa setiap baris: menu dan jumlah terjual wajib diisi dengan benar.','warn');
    if(seen.has(String(x.menu_id)))return toast('Menu yang sama cukup satu baris; gabungkan jumlahnya.','warn');
    seen.add(String(x.menu_id));
    const menu=CG.menus.find(m=>String(m.id)===String(x.menu_id));
    if(!menu||String(menu.division_id)!==String(division))return toast('Menu tidak sesuai dengan divisi yang dipilih. Muat ulang data lalu coba lagi.','err');
    const cost=cgMenuCost(x.menu_id);
    if(!cost.ok)return toast('HPP menu '+(opsMenu(x.menu_id)?.name||'')+' belum valid: '+cost.reason,'err');
  }
  const lines=rows.map(x=>({menu_id:x.menu_id,qty:x.qty,selling_price:null}));
  const saveBtn=document.getElementById('ops_sale_save');
  if(saveBtn){saveBtn.disabled=true;saveBtn.textContent='Menyimpan…'}
  try{
    const {data,error}=await sb().rpc('cogs_record_menu_sales_batch',{p_division_id:division,p_sold_at:sold_at,p_lines:lines,p_notes:notes||null});
    if(error)throw error;
    await opsReload();
    toast('Berhasil menyimpan '+(data??rows.length)+' baris penjualan sekaligus.','ok');
  }catch(e){
    toast(opsErr(e),'err');
  }finally{
    const b=document.getElementById('ops_sale_save');
    if(b){b.disabled=false;b.textContent='Simpan penjualan'}
  }
}
function opsPreviewProduction(){
 const batches=Number(v('ops_prod_qty')),id=v('ops_prod_wip'),el=document.getElementById('ops_prod_preview');if(!el)return;
 if(!(batches>0)||!id){el.textContent='Pilih WIP dan jumlah batch produksi.';return}
 const c=cgWipCost(id,[]),w=opsWip(id);if(!c.ok){el.textContent='HPP belum valid: '+c.reason;return}
 const perBatch=Number(w.yield_qty),totalQty=batches*perBatch,totalHpp=c.unitCost*totalQty;
 el.innerHTML='<b>Hasil 1 batch:</b> '+invNum(perBatch)+' '+esc(w.yield_unit)+'<br><b>Total hasil ('+invNum(batches)+' batch):</b> '+invNum(totalQty)+' '+esc(w.yield_unit)+'<br><b>HPP per '+esc(w.yield_unit)+':</b> '+cgMoney(c.unitCost)+'<br><b>HPP per batch:</b> '+cgMoney(c.unitCost*perBatch)+'<br><b>Total HPP produksi:</b> '+cgMoney(totalHpp)+(c.source==='reference'?' <span class="cogs-pill ref">Mengandung harga acuan</span>':'');
}
async function opsRecordProduction(){
 if(!cgRoleOK())return;
 const division=v('ops_prod_div'),wip_id=v('ops_prod_wip'),batch_count=Number(v('ops_prod_qty')),produced_at=v('ops_prod_date')||opsDate(),notes=v('ops_prod_note').trim(),w=opsWip(wip_id),produced_qty=batch_count*Number(w?.yield_qty||0);
 if(!division||!wip_id||!(batch_count>0)||!Number.isFinite(produced_qty)||!(produced_qty>0))return toast('Lengkapi divisi, WIP, dan jumlah batch produksi.','warn');
 const c=cgWipCost(wip_id,[]);if(!c.ok)return toast('Resep belum menghasilkan HPP valid: '+c.reason,'err');
 try{
  const {error}=await sb().rpc('cogs_record_production',{p_division_id:division,p_wip_id:wip_id,p_produced_qty:produced_qty,p_produced_at:produced_at,p_notes:notes||null});
  if(error)throw error;
  OPS.prodQty='';await opsReload();toast('Produksi WIP tersimpan. HPP batch disimpan sebagai snapshot.','ok');
 }catch(e){toast(opsErr(e),'err')}
}
function opsPreviewSale(){
 const qty=Number(v('ops_sale_qty')),id=v('ops_sale_menu'),priceRaw=v('ops_sale_price'),el=document.getElementById('ops_sale_preview');if(!el)return;
 if(!(qty>0)||!id){el.textContent='Pilih menu dan jumlah terjual.';return}
 const c=cgMenuCost(id),m=opsMenu(id);if(!c.ok){el.textContent='HPP belum valid: '+c.reason;return}
 const price=priceRaw===''?Number(m.selling_price):Number(priceRaw);if(!Number.isFinite(price)||price<0){el.textContent='Harga jual tidak valid.';return}
 const hpp=c.total*qty,sales=price*qty;
 el.innerHTML='<b>Penjualan: '+cgMoney(sales)+'</b><br>HPP tersimpan: <b>'+cgMoney(hpp)+'</b><br>Margin kotor: <b>'+(sales-hpp>=0?cgMoney(sales-hpp):'-'+cgMoney(hpp-sales))+'</b>'+(c.source==='reference'?' <span class="cogs-pill ref">HPP estimasi</span>':'');
}
function opsAddSaleRow(menuId='',qty=''){
 const host=document.getElementById('ops_sale_batch_rows');if(!host)return;
 const row=document.createElement('div');row.className='card ops-sale-batch-row';row.style.cssText='display:grid;grid-template-columns:minmax(0,1fr) minmax(95px,.55fr);gap:10px;align-items:end;padding:12px;margin:10px 0;min-width:0;box-sizing:border-box';
 row.innerHTML='<label style="display:block;grid-column:1/-1;min-width:0">Menu<select class="ops-batch-menu" style="display:block;width:100%;max-width:100%;min-width:0;box-sizing:border-box"><option value="">Pilih menu</option>'+Array.from(document.getElementById('ops_sale_menu_source').content.querySelectorAll('option')).filter(o=>o.value).map(o=>'<option value="'+esc(o.value)+'">'+esc(o.textContent)+'</option>').join('')+'</select></label><label style="display:block;min-width:0">Jumlah terjual<input class="ops-batch-qty" type="number" min="0.0001" step="any" inputmode="decimal" placeholder="Contoh: 12" style="display:block;width:100%;max-width:100%;min-width:0;box-sizing:border-box"></label><button type="button" class="btn s" style="justify-self:start" onclick="this.closest(\'.ops-sale-batch-row\').remove()">Hapus baris</button>';
 row.querySelector('.ops-batch-menu').value=menuId;row.querySelector('.ops-batch-qty').value=qty;host.appendChild(row);
}
async function opsRecordSaleBatch(){
 if(!cgRoleOK())return;
 const division=v('ops_sale_div'),sold_at=v('ops_sale_date')||opsDate(),notes=v('ops_sale_note').trim();
 const rows=Array.from(document.querySelectorAll('#ops_sale_batch_rows .card')).map(row=>({menu_id:row.querySelector('.ops-batch-menu').value,qty:row.querySelector('.ops-batch-qty').value.trim()})).filter(x=>x.menu_id||x.qty||x.selling_price);
 if(!division||!rows.length)return toast('Pilih divisi dan isi minimal satu baris penjualan.','warn');
 if(rows.some(x=>!x.menu_id||!(Number(x.qty)>0)))return toast('Periksa setiap baris: menu dan jumlah terjual wajib diisi.','warn');
 const seen=new Set();for(const x of rows){if(seen.has(x.menu_id))return toast('Menu yang sama cukup satu baris; gabungkan jumlahnya.','warn');seen.add(x.menu_id);const c=cgMenuCost(x.menu_id);if(!c.ok)return toast('HPP menu '+(opsMenu(x.menu_id)?.name||'')+' belum valid: '+c.reason,'err')}
 const lines=rows.map(x=>({menu_id:x.menu_id,qty:Number(x.qty),selling_price:null}));
 try{const {data,error}=await sb().rpc('cogs_record_menu_sales_batch',{p_division_id:division,p_sold_at:sold_at,p_lines:lines,p_notes:notes||null});if(error)throw error;await opsReload();toast('Berhasil menyimpan '+(data??rows.length)+' baris penjualan sekaligus.','ok')}
 catch(e){toast(opsErr(e),'err')}
}
async function opsReload(){
 OPS.positionLoadedFor='';OPS.positionError='';OPS.positionErrorFor='';OPS.position=[];
 try{await cgLoad(true)}catch(e){}
 if(pg==='cogs_daily_so')await opsLoadPosition(false);
 R();
}
async function opsSaveDailySO(){
 if(!cgRoleOK())return;
 const division=v('ops_so_div')||OPS.division,so_date=v('ops_so_date')||OPS.date||opsDate(),notes=(v('ops_so_note')||OPS.notes||'').trim();
 const existing=CG.dailySO.find(s=>String(s.division_id)===String(division)&&String(s.so_date)===String(so_date)&&s.status==='submitted');
 if(existing)return toast('Daily SO untuk divisi dan tanggal ini sudah disimpan. Batalkan dulu jika ingin koreksi.','warn');
 if(!OPS.position.length)return toast('Saldo belum dimuat. Tekan Muat saldo dulu.','warn');
 const lines=OPS.position.map(p=>({type:p.component_type,id:p.component_id,counted_qty_base:OPS.counts[opsKey(p.component_type,p.component_id)]}));
 if(lines.some(l=>l.counted_qty_base===''||l.counted_qty_base==null||!Number.isFinite(Number(l.counted_qty_base))||Number(l.counted_qty_base)<0))return toast('Isi jumlah fisik semua bahan dan WIP, termasuk angka 0 jika stok habis.','warn');
 try{
  const {error}=await sb().rpc('cogs_save_daily_so',{p_division_id:division,p_so_date:so_date,p_lines:lines.map(l=>({type:l.type,id:l.id,counted_qty_base:Number(l.counted_qty_base)})),p_notes:notes||null});
  if(error)throw error;
  await opsReload();toast('Daily SO tersimpan. Selisih stok dan nilai varians sudah disnapshot.','ok');
 }catch(e){toast(opsErr(e),'err')}
}
function opsConfirmCancel(kind,id){
 const label=kind==='production'?'produksi WIP':kind==='sale'?'penjualan menu':'Daily SO';
 modal('<h3>Batalkan '+label+'?</h3><p class="mu">Rekaman historis tetap disimpan, tetapi tidak lagi masuk perhitungan saldo stok. Isi alasan pembatalan.</p><label>Alasan<input id="ops_cancel_reason" maxlength="500"></label><div class="btns"><button class="btn s" onclick="closeM()">Kembali</button><button class="btn" onclick="opsDoCancel(&quot;'+kind+'&quot;,&quot;'+id+'&quot;)">Konfirmasi batal</button></div>');
}
async function opsDoCancel(kind,id){
 const reason=v('ops_cancel_reason').trim();
 try{const {error}=await sb().rpc('cogs_cancel_operation',{p_kind:kind,p_id:id,p_reason:reason||null});if(error)throw error;closeM();await opsReload();toast('Rekaman dibatalkan. Data historis tetap tersimpan.','ok')}catch(e){toast(opsErr(e),'err')}
}
function opsCancelButton(kind,id){return '<button class="btn o x" onclick="opsConfirmCancel(&quot;'+kind+'&quot;,&quot;'+id+'&quot;)">Batalkan</button>'}

async function exportDailySOExcel(){
 if(!window.XLSX)return toast('Modul Excel belum siap. Tunggu sebentar lalu coba lagi.','warn');
 if(!INV.ready)await invLoad(true);if(!CG.ready)await cgLoad(true);
 const date=OPS.soHistoryDate||OPS.date||opsDate(),division=OPS.division||CG.divs[0]?.id||'';
 const so=CG.dailySO.find(x=>String(x.division_id)===String(division)&&String(x.so_date)===String(date)&&x.status==='submitted');
 if(!so)return toast('Belum ada Daily SO tersimpan untuk divisi dan tanggal yang dipilih.','warn');
 const lines=CG.dailySOLines.filter(x=>String(x.so_id)===String(so.id));
 const rows=[['LAPORAN DAILY SO'],['TANGGAL',date],['DIVISI',opsDivName(division)],[],['ITEM','BARANG MASUK','TERPAKAI SALES','TERPAKAI PENGELUARAN','SUPLIES','TERPAKAI PRODUKSI WIP','STOCK AKHIR AKTUAL','STOCK SISTEM','SELISIH QTY','NILAI RP SELISIH']];
 const sum=(xs,fn)=>xs.reduce((a,x)=>a+Number(fn(x)||0),0);
 lines.forEach(l=>{
  const type=l.component_type==='material'?'material':'wip',id=type==='material'?l.item_id:l.component_wip_id;
  const item=type==='material'?cgItem(id):opsWip(id);
  const incoming=type==='material'
   ?sum(INV.ins.filter(x=>String(x.item_id)===String(id)&&String(x.division_id)===String(division)&&x.status==='posted'&&String(x.received_at)===String(date)),x=>x.qty_base)-sum(INV.rets.filter(x=>String(x.item_id)===String(id)&&String(x.division_id)===String(division)&&x.status==='posted'&&String(x.returned_at)===String(date)),x=>x.qty_base)+sum(INV.stockOut.filter(x=>String(x.target_item_id)===String(id)&&String(x.to_division_id)===String(division)&&x.category==='Move'&&x.status==='posted'&&String(x.out_date)===String(date)),x=>x.qty_base)
   :sum(CG.productions.filter(x=>String(x.wip_id)===String(id)&&String(x.division_id)===String(division)&&x.status==='posted'&&String(x.produced_at)===String(date)),x=>x.produced_qty);
  const usedOut=sum(INV.stockOut.filter(x=>String(x.item_id)===String(id)&&String(x.from_division_id)===String(division)&&x.status==='posted'&&String(x.out_date)===String(date)),x=>x.qty_base);
  const sales=sum(CG.saleLines.filter(x=>x.component_type===type&&String(type==='material'?x.item_id:x.component_wip_id)===String(id)&&CG.sales.some(z=>String(z.id)===String(x.sale_id)&&String(z.division_id)===String(division)&&z.status==='posted'&&String(z.sold_at)===String(date))),x=>x.qty_base);
  const production=sum(CG.productionInputs.filter(x=>x.component_type===type&&String(type==='material'?x.item_id:x.component_wip_id)===String(id)&&CG.productions.some(z=>String(z.id)===String(x.batch_id)&&String(z.division_id)===String(division)&&z.status==='posted'&&String(z.produced_at)===String(date))),x=>x.qty_base);
  let price=l.unit_cost_snapshot==null?null:Number(l.unit_cost_snapshot);
  if(price==null){if(type==='material'){const p=cgPrice(item);price=p?.value??0}else{const p=cgWipCost(id,[]);price=p.ok?p.unitCost:0}}
  const variance=Number(l.variance_qty_base||0);
  const supplyLine=(INV.suppliesSOLines||[]).find(q=>String(q.item_id)===String(id)&&String(q.so_id)==String((INV.suppliesSO||[]).find(z=>String(z.division_id)===String(division)&&String(z.so_date)===String(date)&&z.status==='submitted')?.id));
  const suppliesUsed=supplyLine?Math.max(0,Number(supplyLine.expected_qty_base||0)-Number(supplyLine.counted_qty_base||0)):0;
  rows.push([l.component_name_snapshot||item?.name||'Item',incoming,sales,usedOut,suppliesUsed,production,Number(l.counted_qty_base||0),Number(l.expected_qty_base||0),variance,variance*Number(price||0)]);
 });
 const dataStart=6,dataEnd=rows.length+1;rows.push(['TOTAL','','','','','','','','',null]);
 const ws=XLSX.utils.aoa_to_sheet(rows);ws['!cols']=[{wch:28},{wch:17},{wch:18},{wch:24},{wch:14},{wch:24},{wch:22},{wch:18},{wch:14},{wch:24}];
 ws['J'+rows.length]={t:'n',f:'SUM(J'+dataStart+':J'+(rows.length-1)+')',z:'\"Rp\" #,##0.00;[Red]-\"Rp\" #,##0.00'};
 for(let r=dataStart;r<=rows.length;r++){const cell=ws['J'+r];if(cell)cell.z='"Rp" #,##0.00;[Red]-"Rp" #,##0.00'}
 ws['A1'].s={font:{bold:true,sz:14}};ws['A2'].s={font:{bold:true}};ws['A3'].s={font:{bold:true}};
 for(let col=0;col<10;col++){const cell=ws[XLSX.utils.encode_cell({r:4,c:col})];if(cell)cell.s={font:{bold:true,color:{rgb:col===6?'1F4E78':col===7?'548235':col===8?'C65911':'FFFFFF'}},fill:{fgColor:{rgb:col===6?'D9EAF7':col===7?'E2F0D9':col===8?'FCE4D6':'5B463B'}}};}
 for(let r=6;r<rows.length;r++){const actual=ws['G'+r],system=ws['H'+r],varianceCell=ws['I'+r];if(actual)actual.s={fill:{fgColor:{rgb:'D9EAF7'}}};if(system)system.s={fill:{fgColor:{rgb:'E2F0D9'}}};if(varianceCell)varianceCell.s={fill:{fgColor:{rgb:'FCE4D6'}}};}
 ws['A'+rows.length].s={font:{bold:true}};ws['J'+rows.length].s={font:{bold:true}};
 const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Daily SO');
 XLSX.writeFile(wb,'Daily-SO-'+String(opsDivName(division)).replace(/[^a-z0-9]+/gi,'-')+'-'+date+'.xlsx');
}
async function exportSuppliesSOExcel(){
 if(!window.XLSX)return toast('Modul Excel belum siap. Tunggu sebentar lalu coba lagi.','warn');
 if(!INV.ready)await invLoad(true);if(!CG.ready)await cgLoad(true);
 const date=SUPS.historyDate||SUPS.date||today(),division=SUPS.division||INV.divs[0]?.id||'';
 const so=INV.suppliesSO.find(x=>String(x.division_id)===String(division)&&String(x.so_date)===String(date)&&x.status==='submitted');
 if(!so)return toast('Belum ada Daily SO Suplies tersimpan untuk divisi dan tanggal yang dipilih.','warn');
 const lines=INV.suppliesSOLines.filter(x=>String(x.so_id)===String(so.id));
 const rows=[['ITEM','BARANG MASUK','JUMLAH AKHIR AKTUAL','SELISIH','JUMLAH AKHIR SISTEM','TERPAKAI PENGELUARAN','TERPAKAI SALES','TERPAKAI PRODUKSI WIP','HARGA SATUAN','JUMLAH SELISIH DALAM RUPIAH']];
 const sum=(xs,fn)=>xs.reduce((a,x)=>a+Number(fn(x)||0),0);
 lines.forEach(l=>{
  const id=l.item_id,item=invItem(id);
  const incoming=sum(INV.ins.filter(x=>String(x.item_id)===String(id)&&String(x.division_id)===String(division)&&x.status==='posted'&&String(x.received_at)===String(date)),x=>x.qty_base)-sum(INV.rets.filter(x=>String(x.item_id)===String(id)&&String(x.division_id)===String(division)&&x.status==='posted'&&String(x.returned_at)===String(date)),x=>x.qty_base)+sum(INV.stockOut.filter(x=>String(x.target_item_id)===String(id)&&String(x.to_division_id)===String(division)&&x.category==='Move'&&x.status==='posted'&&String(x.out_date)===String(date)),x=>x.qty_base);
  const usedOut=sum(INV.stockOut.filter(x=>String(x.item_id)===String(id)&&String(x.from_division_id)===String(division)&&x.status==='posted'&&String(x.out_date)===String(date)),x=>x.qty_base);
  const sales=sum(INV.menuSalesLines.filter(x=>x.component_type==='material'&&String(x.item_id)===String(id)&&INV.menuSales.some(z=>String(z.id)===String(x.sale_id)&&String(z.division_id)===String(division)&&z.status==='posted'&&String(z.sold_at)===String(date))),x=>x.qty_base);
  const production=sum(INV.productionInputs.filter(x=>x.component_type==='material'&&String(x.item_id)===String(id)&&INV.productionBatches.some(z=>String(z.id)===String(x.batch_id)&&String(z.division_id)===String(division)&&z.status==='posted'&&String(z.produced_at)===String(date))),x=>x.qty_base);
  const price=Number(item?.last_purchase_price_per_base??item?.reference_price_per_base??0),variance=Number(l.variance_qty_base||0);
  rows.push([l.item_name_snapshot||item?.name||'Item',incoming,Number(l.actual_qty_base||0),variance,Number(l.system_qty_base||0),usedOut,sales,production,price,variance*price]);
 });
 const ws=XLSX.utils.aoa_to_sheet(rows);ws['!cols']=[{wch:28},{wch:17},{wch:22},{wch:14},{wch:22},{wch:22},{wch:18},{wch:24},{wch:18},{wch:26}];
 for(let r=2;r<=rows.length;r++)for(const c of ['I','J']){const cell=ws[c+r];if(cell)cell.z='"Rp" #,##0.00;[Red]-"Rp" #,##0.00'}
 const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Suplies');
 XLSX.writeFile(wb,'Suplies-'+String(suppliesDivName(division)).replace(/[^a-z0-9]+/gi,'-')+'-'+date+'.xlsx');
}

function opsOpenProductionDetail(groupIndex){
 const groups=window.__opsProductionHistoryGroups||[],g=groups[Number(groupIndex)];
 if(!g)return;
 const items=g.items.slice().sort((a,b)=>String(a.produced_at||'').localeCompare(String(b.produced_at||'')));
 const cards=items.map((b,i)=>{
  const raw=String(b.created_at||''),d=raw?new Date(raw):null;
  const time=d&&!Number.isNaN(d.getTime())?d.toLocaleTimeString('id-ID',{timeZone:'Asia/Jakarta',hour:'2-digit',minute:'2-digit',hour12:false}):'Jam tidak tersedia';
  const status=b.status==='posted'?'<span class="cogs-pill">Tersimpan</span>':'<span class="cogs-pill bad">Dibatalkan</span>';
  return '<div class="ops-production-detail-batch"><div class="ops-production-detail-head"><b>Batch '+(i+1)+'</b><b>'+time+'</b></div><div class="ops-production-detail-grid"><div><small>Qty produksi</small><b>'+cgNum(b.produced_qty)+' '+esc(b.yield_unit||g.unit)+'</b></div><div><small>HPP per unit</small><b>'+cgMoney(b.unit_cost_snapshot)+' / '+esc(b.yield_unit||g.unit)+'</b></div></div><div class="ops-production-detail-foot">'+status+(b.status==='posted'?opsCancelButton('production',b.id):'')+'</div></div>';
 }).join('');
 modal('<div class="ops-production-popup"><div class="ops-production-popup-head"><div><h3>'+esc(g.name)+'</h3><p class="mu">'+fdp(g.day)+' · '+items.length+' batch</p></div><button class="btn s" onclick="closeM()">Tutup</button></div><div class="ops-production-popup-list">'+cards+'</div></div>');
}
(window.__barappPendingViews||(window.__barappPendingViews={})).cogs_production=()=>{
 if(!cgRoleOK())return '<div class="card empty">Akses ditolak.</div>';cgInit();if(!CG.ready)return CG.err?cgErrCard():'<div class="card">Memuat data produksi…</div>';const gate=cgModuleGate('cogs_production','Produksi WIP');if(gate)return gate;
 const selectedDiv=OPS.division||CG.divs[0]?.id||'';OPS.division=selectedDiv;
 const divOptions=CG.divs.map(d=>'<option value="'+d.id+'" '+(String(selectedDiv)===String(d.id)?'selected':'')+'>'+esc(d.name)+'</option>').join('');
 const wips=CG.wips.filter(w=>w.active&&String(w.division_id)===String(selectedDiv)).sort((a,b)=>invAlpha(a.name,b.name));
 
 const prodHistoryFrom=OPS.prodHistoryFrom||opsDate(),prodHistoryTo=OPS.prodHistoryTo||opsDate();
 const productionRows=CG.productions.filter(b=>String(b.division_id)===String(selectedDiv)&&String(b.produced_at||'').slice(0,10)>=prodHistoryFrom&&String(b.produced_at||'').slice(0,10)<=prodHistoryTo);
 const productionGroups=new Map();
 productionRows.forEach(b=>{
  const day=String(b.produced_at||'').slice(0,10),key=day+'|'+String(b.wip_id||b.wip_name_snapshot||'');
  if(!productionGroups.has(key))productionGroups.set(key,{day,wipId:b.wip_id,name:b.wip_name_snapshot||opsWip(b.wip_id)?.name||'WIP',unit:b.yield_unit||'',items:[]});
  productionGroups.get(key).items.push(b);
 });
 const historyGroups=Array.from(productionGroups.values()).sort((a,b)=>b.day.localeCompare(a.day)||invAlpha(a.name,b.name));
 window.__opsProductionHistoryGroups=historyGroups;
 const rows=historyGroups.map((g,i)=>{
  const posted=g.items.filter(b=>b.status==='posted');
  const totalQty=posted.reduce((sum,b)=>sum+Number(b.produced_qty||0),0);
  const batchCount=posted.reduce((sum,b)=>sum+Math.max(1,Number(b.batches??b.batch_count??b.batch_qty??1)||1),0);
  return '<tr class="ops-production-history-row"><td colspan="4"><div class="ops-production-compact-row"><div class="ops-production-compact-main"><b>'+esc(g.name)+'</b><span>'+batchCount+' batch | '+cgNum(totalQty)+' '+esc(g.unit)+'</span></div><div class="ops-production-compact-sub"><small class="mu">'+fdp(g.day)+'</small><button class="btn s" onclick="opsOpenProductionDetail('+i+')">DETAIL</button></div></div></td></tr>';
 }).join('');
 return '<div class="cogs-wrap ops-feature-page ops-production-page"><div class="card ops-entry-card"><div class="cogs-top"><div><h3>Produksi WIP</h3></div><div class="btns"><button class="btn s daily-so-back" onclick="go(\'cogs_daily_so\')">← Kembali ke Daily SO</button><button class="btn s" onclick="cgLoad(true)">Muat ulang</button></div></div><div class="cogs-formgrid"><label>Divisi<select id="ops_prod_div" onchange="OPS.division=this.value;R()">'+divOptions+'</select></label><label>Tanggal produksi<input id="ops_prod_date" type="date" value="'+opsDate()+'" max="'+opsDate()+'"></label></div><div class="cogs-scroll"><table class="cogs-table ops-production-entry-table"><thead><tr><th>ITEM WIP</th><th>JUMLAH BATCH</th><th>Aksi</th></tr></thead><tbody id="ops_prod_entry_rows">'+wips.map(w=>'<tr class="ops-entry-row" data-item-id="'+w.id+'"><td><b>'+esc(w.name)+'</b></td><td><input class="ops-entry-qty" type="number" min="1" step="1" inputmode="numeric" placeholder="" aria-label="Jumlah batch '+esc(w.name)+'"></td><td><span class="mu">Batch</span></td></tr>').join('')+'</tbody></table></div><label>Catatan<input id="ops_prod_note" maxlength="500" placeholder="Shift atau keterangan produksi (opsional)"></label><button class="btn" id="ops_prod_save" onclick="opsRecordProductionBatch()">Simpan produksi</button></div><div class="card ops-history-card"><div class="cogs-top"><h3>Riwayat Produksi WIP</h3><button class="btn s" onclick="rOpen(\'P\')">📅 '+(OPS.prodHistoryPicked?fdp(prodHistoryFrom)+' s/d '+fdp(prodHistoryTo):'Pilih rentang tanggal')+'</button></div><div class="cogs-scroll ops-production-history-scroll"><table class="cogs-table ops-production-history-table"><thead><tr><th>Item WIP / tanggal</th><th>Total qty produksi</th><th>Jumlah batch</th><th>Rincian</th></tr></thead><tbody>'+(rows||'<tr><td colspan="4" class="mu">Belum ada transaksi produksi.</td></tr>')+'</tbody></table></div></div></div>';
};
(window.__barappPendingViews||(window.__barappPendingViews={})).cogs_sales=()=>{
 if(!cgRoleOK())return '<div class="card empty">Akses ditolak.</div>';cgInit();if(!CG.ready)return CG.err?cgErrCard():'<div class="card">Memuat data penjualan…</div>';const gate=cgModuleGate('cogs_sales','Penjualan Menu');if(gate)return gate;
 const selectedDiv=OPS.division||CG.divs[0]?.id||'';OPS.division=selectedDiv;
 const divOptions=CG.divs.map(d=>'<option value="'+d.id+'" '+(String(selectedDiv)===String(d.id)?'selected':'')+'>'+esc(d.name)+'</option>').join('');
 const menus=CG.menus.filter(m=>m.active&&String(m.division_id)===String(selectedDiv)).sort((a,b)=>invAlpha(a.name,b.name));
 
 const saleHistoryFrom=OPS.saleHistoryFrom||opsDate(),saleHistoryTo=OPS.saleHistoryTo||opsDate();
 const rows=CG.sales.filter(s=>String(s.division_id)===String(selectedDiv)&&String(s.sold_at)>=saleHistoryFrom&&String(s.sold_at)<=saleHistoryTo).sort((a,b)=>invAlpha(a.menu_name_snapshot,b.menu_name_snapshot)).map(s=>{
  const margin=Number(s.gross_sales_snapshot)-Number(s.total_hpp_snapshot);
  return '<tr><td><b>'+esc(s.menu_name_snapshot)+'</b></td><td>'+cgNum(s.qty)+'</td><td>'+cgMoney(s.selling_price_snapshot)+'</td><td>'+cgMoney(s.total_hpp_snapshot)+'</td><td>'+cgMoney(margin)+'</td><td>'+(s.status==='posted'?'<span class="cogs-pill">Tersimpan</span>':'<span class="cogs-pill bad">Dibatalkan</span>')+' '+(s.status==='posted'?opsCancelButton('sale',s.id):'')+'</td></tr>';
 }).join('');
 return '<div class="cogs-wrap ops-feature-page ops-sales-page"><div class="card ops-entry-card"><div class="cogs-top"><div><h3>Penjualan Menu</h3></div><div class="btns"><button class="btn s daily-so-back" onclick="go(\'cogs_daily_so\')">← Kembali ke Daily SO</button><button class="btn s" onclick="cgLoad(true)">Muat ulang</button></div></div><div class="cogs-formgrid"><label>Divisi<select id="ops_sale_div" onchange="OPS.division=this.value;R()">'+divOptions+'</select></label><label>Tanggal penjualan<input id="ops_sale_date" type="date" value="'+opsDate()+'" max="'+opsDate()+'"></label></div><div class="cogs-scroll"><table class="cogs-table ops-sale-entry-table"><thead><tr><th>ITEM MENU</th><th>QTY YANG TERJUAL</th><th>Aksi</th></tr></thead><tbody id="ops_sale_entry_rows">'+menus.map(m=>'<tr class="ops-entry-row" data-item-id="'+m.id+'"><td><b>'+esc(m.name)+'</b></td><td><input class="ops-entry-qty" type="number" min="0" step="any" inputmode="decimal" placeholder="" aria-label="Qty terjual '+esc(m.name)+'"></td><td><span class="mu">Qty</span></td></tr>').join('')+'</tbody></table></div><label>Catatan / nomor transaksi (opsional)<input id="ops_sale_note" maxlength="500" placeholder="Contoh: Shift pagi / POS"></label><button class="btn" id="ops_sale_save" onclick="opsRecordSalesTable()">Simpan penjualan</button></div><div class="card ops-history-card"><div class="cogs-top"><h3>Riwayat penjualan</h3><button class="btn s" onclick="rOpen(\'S\')">📅 '+(OPS.saleHistoryPicked?fdp(saleHistoryFrom)+' s/d '+fdp(saleHistoryTo):'Pilih rentang tanggal')+'</button></div><div class="cogs-scroll"><table class="cogs-table"><thead><tr><th>Item menu</th><th>Qty</th><th>Harga jual</th><th>Total HPP</th><th>Margin kotor</th><th>Status / aksi</th></tr></thead><tbody>'+(rows||'<tr><td colspan="6" class="mu">Belum ada transaksi penjualan pada tanggal ini.</td></tr>')+'</tbody></table></div></div></div>';
};
(window.__barappPendingViews||(window.__barappPendingViews={})).cogs_daily_so=()=>{
 if(!cgRoleOK())return '<div class="card empty">Akses ditolak.</div>';cgInit();if(!CG.ready)return CG.err?cgErrCard():'<div class="card">Memuat saldo Daily SO…</div>';const gate=cgModuleGate('cogs_daily_so','Daily SO COGS');if(gate)return gate;
 const division=OPS.division||CG.divs[0]?.id||'';OPS.division=division;const date=OPS.date||opsDate();OPS.date=date;
 const key=division+'|'+date;
 if(!OPS.positionLoading&&OPS.positionLoadedFor!==key&&OPS.positionErrorFor!==key)opsLoadPosition(false)
 if(OPS.positionErrorFor===key&&OPS.positionError){
  const retryDivs=CG.divs.map(d=>'<option value="'+d.id+'" '+(String(division)===String(d.id)?'selected':'')+'>'+esc(d.name)+'</option>').join('');
  const serviceHint=/Divisi Service tidak memakai Daily SO COGS/i.test(OPS.positionError);
  return '<div class="cogs-wrap"><div class="card"><h3>Saldo Daily SO belum berhasil dimuat</h3><p class="cogs-pill bad">'+esc(OPS.positionError)+'</p>'+
   (serviceHint&&allowed().includes('supplies')?'<button class="btn" onclick="go(&quot;supplies&quot;)">Buka SUPLIES · Daily SO</button>':'')+
   (CG.divs.length?'<label>Divisi<select onchange="opsSetDivision(this.value)">'+retryDivs+'</select></label>':'')+
   '<label>Tanggal SO<input type="date" value="'+esc(date)+'" max="'+opsDate()+'" onchange="opsSetDate(this.value)"></label>'+
   (CG.divs.length?'<button class="btn s" onclick="opsRetryPosition()">Coba muat saldo lagi</button>':'')+
   '</div></div>';
 }
 const active=CG.dailySO.find(s=>String(s.division_id)===String(division)&&String(s.so_date)===String(date)&&s.status==='submitted');
 const divOptions=CG.divs.map(d=>'<option value="'+d.id+'" '+(String(division)===String(d.id)?'selected':'')+'>'+esc(d.name)+'</option>').join('');
 const dailyShortcuts='<div class="card daily-so-shortcuts"><h3>Operasional Daily SO</h3><div class="grid daily-so-shortcut-grid">'+[['pengeluaran','Pengeluaran','arrow-left-right'],['supplies','Suplies','clipboard-list'],['masuk','Barang Masuk','truck'],['cogs_sales','Penjualan Menu','receipt-text'],['cogs_production','Produksi WIP','cooking-pot']].filter(x=>allowed().includes(x[0])).map(x=>'<button class="btn s daily-shortcut-'+x[0]+'" style="min-width:0;white-space:normal" onclick="go(&quot;'+x[0]+'&quot;)">'+IC(x[2],18)+' '+x[1]+'</button>').join('')+'</div></div>';
 const rows=OPS.position.map(p=>{
  const k=opsKey(p.component_type,p.component_id),stored=active&&p.stored_counted_qty!=null;
  const units=opsUnitList(p),factor=opsUnitFactor(p,k),baseVal=OPS.counts[k]??'',val=baseVal===''?'':Number(baseVal)/factor;
  const variance=stored?Number(p.stored_variance_qty):Number(baseVal)===''?null:Number(baseVal)-Number(p.expected_qty_base);
  const varValue=stored?p.stored_variance_value:(variance==null||p.unit_cost==null?null:variance*Number(p.unit_cost));
  const type=p.component_type==='material'?'Bahan':'WIP';
  return '<tr><td><small class="mu">'+type+'</small><br><b>'+esc(p.component_name)+'</b></td><td><input type="number" min="0" step="any" style="width:115px" value="'+esc(val)+'" '+(active?'disabled':'')+' oninput="opsCountInput(&quot;'+k+'&quot;,this.value,'+factor+')"></td><td>'+(!active?'<select aria-label="Satuan input '+esc(p.component_name)+'" style="min-width:96px;max-width:140px" onchange="opsSetCountUnit(&quot;'+k+'&quot;,this.value)">'+units.map(u=>'<option value="'+esc(u.unit)+'" '+(u.unit===opsDefaultUnit(p,k)?'selected':'')+'>'+esc(u.unit)+'</option>').join('')+'</select>':esc(p.unit)+' · terkunci')+'</td><td>'+cgNum(p.expected_qty_base)+'</td><td>'+(variance==null?'–':cgNum(variance))+'</td><td>'+(varValue==null?'–':cgMoney(varValue))+'</td></tr>';
 }).join('');
 const positionRows=OPS.positionLoading?'<tr><td colspan="6" class="mu">Menghitung saldo harapan untuk Daily SO…</td></tr>':(rows||'<tr><td colspan="6" class="mu">Belum ada bahan atau WIP di divisi ini.</td></tr>');
 const soHistoryDate=OPS.soHistoryDate||opsDate();const hrows=CG.dailySO.filter(s=>String(s.division_id)===String(division)&&String(s.so_date)===String(soHistoryDate)).sort((a,b)=>String(b.so_date||'').localeCompare(String(a.so_date||''))).map(s=>{
  const lines=CG.dailySOLines.filter(l=>String(l.so_id)===String(s.id));
  const varianceCount=lines.filter(l=>Math.abs(Number(l.variance_qty_base))>0.000001).length;
  const totalValue=lines.reduce((a,l)=>a+Number(l.variance_value_snapshot||0),0);
  return '<tr><td><b>'+esc(s.so_date)+'</b><br><small class="mu">'+esc(opsDivName(s.division_id))+'</small></td><td>'+lines.length+' item</td><td>'+varianceCount+' selisih</td><td>'+cgMoney(totalValue)+'</td><td>'+(s.status==='submitted'?'<span class="cogs-pill">Disimpan</span>':'<span class="cogs-pill bad">Dibatalkan</span>')+' '+(s.status==='submitted'?opsCancelButton('daily_so',s.id):'')+'</td></tr>';
 }).join('');
 return '<div class="cogs-wrap daily-so-page">'+dailyShortcuts+'<div class="card daily-so-main-card"><div class="cogs-top"><div><h3>Daily SO · Stock Opname</h3></div><div class="btns" style="gap:8px;flex-wrap:wrap"><button class="btn s" onclick="window.__clOpenOperationalTemplateFromDailySO()">Template Daily SO (Excel)</button><button class="btn s" onclick="opsSetDate(v(&quot;ops_so_date&quot;),true)">Muat saldo</button></div></div><div class="cogs-formgrid"><label>Divisi<select id="ops_so_div" onchange="opsSetDivision(this.value)">'+divOptions+'</select></label><label>Tanggal SO<input id="ops_so_date" type="date" value="'+esc(date)+'" max="'+opsDate()+'" onchange="opsSetDate(this.value)"></label></div>'+(OPS.positionError?'<p class="cogs-pill bad">'+esc(OPS.positionError)+'</p>':'')+(active?'<p class="mu">SO tanggal ini sudah disimpan dan dikunci. Batalkan di riwayat untuk mengoreksi.</p>':'')+'<label>Catatan SO<input id="ops_so_note" maxlength="500" value="'+esc(OPS.notes||'')+'" '+(active?'disabled':'')+' oninput="OPS.notes=this.value" placeholder="Petugas, shift, atau keterangan"></label><div class="cogs-scroll"><table class="cogs-table ops-daily-so-table"><thead><tr><th>Bahan / WIP</th><th>Fisik</th><th>Satuan input</th><th>Saldo harapan</th><th>Selisih</th><th>Nilai selisih</th></tr></thead><tbody>'+positionRows+'</tbody></table></div><div class="btns"><button class="btn o" onclick="opsSetDate(v(&quot;ops_so_date&quot;),true)">Hitung ulang saldo</button><button class="btn" '+(active?'disabled':'')+' onclick="opsSaveDailySO()">Simpan Daily SO</button></div></div><div class="card daily-so-history-card"><div class="cogs-top"><h3>Riwayat Daily SO</h3><label style="max-width:190px">Tanggal riwayat<input type="date" value="'+esc(soHistoryDate)+'" max="'+opsDate()+'" onchange="OPS.soHistoryDate=this.value||opsDate();R()"></label></div><div class="cogs-scroll"><table class="cogs-table"><thead><tr><th>Tanggal / divisi</th><th>Item</th><th>Jumlah selisih</th><th>Total nilai varians</th><th>Status / aksi</th></tr></thead><tbody>'+(hrows||'<tr><td colspan="5" class="mu">Belum ada Daily SO.</td></tr>')+'</tbody></table></div></div></div>';
};


function cgDashSetKind(kind){CG.dashboardKind=kind==='wip'?'wip':'menu';CG.dashboardItemId='';CG.dashboardFilter='';R()}
function cgDashChooseItem(id){CG.dashboardItemId=id;CG.dashboardFilter='';R()}
function cgDashSearch(input){
 const results=document.getElementById('cg_dashboard_results');
 if(!input||!results)return;
 const q=String(input.value||'').trim().toLocaleLowerCase();
 if(!q){results.classList.remove('open');return;}
 let shown=0;
 results.querySelectorAll('.cg-dashboard-option').forEach(button=>{
  const match=String(button.dataset.search||'').includes(q);
  button.style.display=match?'':'none';
  if(match)shown++;
 });
 const empty=results.querySelector('.cg-component-empty');
 if(empty)empty.style.display=shown?'none':'block';
 results.classList.add('open');
}
function cgDashPick(button){
 if(!button)return;
 CG.dashboardItemId=button.dataset.componentId||'';
 CG.dashboardFilter='';
 R();
}
function cgDashChooseDivision(id){OPS.division=id;CG.division=id;CG.dashboardItemId='';CG.dashboardFilter='';R()}
function cgDashIngredientRows(kind,id,total){
 function row(line,depth,quantityFactor,shareBase,shareLabel,stack){
  const quantity=(Number(line.qty_base)||0)*(Number(quantityFactor)||0);
  const isMaterial=line.component_type==='material';
  let name='Komponen tidak ditemukan',unit='',type='WIP turunan',cost=null,source='',childLines=[],childFactor=1,childStack=stack,cycle=false;
  if(isMaterial){
   const x=cgItem(line.item_id),p=cgMaterialPrice(x);
   name=x&&x.name||'Bahan tidak ditemukan';unit=x&&x.base_unit||'';type='Bahan';
   if(x&&x.active&&p&&quantity>0){cost=quantity*p.value;source=p.source==='reference'?'Harga acuan':'Harga terakhir'}
  }else{
   const child=cgWip(line.component_wip_id);
   name=child&&child.name||'WIP tidak ditemukan';unit=child&&child.yield_unit||'';type='WIP turunan';
   cycle=!!child&&stack.includes(String(child.id));
   const wc=child&&!cycle?cgWipCost(child.id,stack):null;
   if(wc&&wc.ok&&quantity>0){cost=quantity*wc.unitCost;source=wc.source==='reference'?'Memakai harga acuan':'Cost sesuai pemakaian'}
   const yieldQty=Number(child&&child.yield_qty)||0;
   if(child&&!cycle&&yieldQty>0&&quantity>0){
    childLines=CG.wipLines.filter(x=>String(x.wip_id)===String(child.id));
    childFactor=quantity/yieldQty;
    childStack=stack.concat(String(child.id));
   }
  }
  const share=cost!=null&&Number(shareBase)>0?cgNum(cost/Number(shareBase)*100)+'% dari '+shareLabel:'—';
  const pad=Math.min(depth,8)*16;
  const mainLine=depth===0;
  let html='<div class="cg-dashboard-ingredient-row '+(mainLine?'cg-dashboard-root-ingredient':'cg-dashboard-child-ingredient')+'" style="margin-left:'+pad+'px;position:relative;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center;padding:'+(mainLine?'11px 0 10px ':'9px 0 9px ') +(depth?'10px':'0')+';border-bottom:1px solid var(--br);'+(mainLine?'border-top:1px solid var(--br);':'')+(depth?'border-left:2px solid var(--br);':'')+'">';
  html+='<div style="min-width:0"><div style="font-size:'+(mainLine?'14px':'12px')+'px;font-weight:'+(mainLine?'800':'650')+';overflow-wrap:anywhere">'+(depth?'<span style="color:var(--mu);margin-right:5px">↳</span>':'<span style="font-size:14px;font-weight:800;margin-right:6px">•</span>')+esc(name)+'</div><div class="mu" style="font-size:11px;line-height:1.45;margin-top:3px">'+type+' · '+cgNum(quantity)+' '+esc(unit||'—')+(source?' · '+source:'')+'</div></div>';
  html+='<div style="text-align:right;white-space:nowrap"><div style="font-size:12px;font-weight:650">'+(cost==null?'<span class="mu">—</span>':cgMoney(cost))+'</div><div class="mu" style="font-size:11px;margin-top:3px">'+share+'</div></div></div>';
  if(cycle){
   html+='<div style="margin-left:'+Math.min(depth+1,8)*16+'px;padding:5px 8px;font-size:11px;color:var(--mu);border-left:2px solid var(--br)">Siklus WIP terdeteksi; rincian dihentikan.</div>';
  }else if(childLines.length){
   for(const childLine of childLines){
    html+=row(childLine,depth+1,childFactor,cost,'cost '+name,childStack);
   }
  }else if(!isMaterial&&quantity>0){
   const child=cgWip(line.component_wip_id);
   if(child)html+='<div style="margin-left:'+Math.min(depth+1,8)*16+'px;padding:5px 8px;font-size:11px;color:var(--mu);border-left:2px solid var(--br)">Belum ada detail ingredient dalam resep WIP ini.</div>';
  }
  return html;
 }
 const lines=kind==='menu'?CG.menuLines.filter(l=>String(l.menu_id)===String(id)):CG.wipLines.filter(l=>String(l.wip_id)===String(id));
 if(!lines.length)return '<div class="cogs-empty" style="font-size:12px;padding:14px">Belum ada detail ingredient pada resep ini.</div>';
 return lines.map(l=>row(l,0,1,total,'HPP',kind==='wip'?[String(id)]:[])).join('');
}
(window.__barappPendingViews||(window.__barappPendingViews={})).cogs_dashboard=()=>{
 if(!cgRoleOK())return '<div class="card empty">Akses ditolak.</div>';
 cgInit();if(!CG.ready)return CG.err?cgErrCard():'<div class="card"><h3>Memuat Dashboard COGS…</h3><p class="mu">Mengambil data Master Bahan, Menu, dan Resep WIP.</p></div>';
 const gate=cgModuleGate('cogs_dashboard','Dashboard COGS');if(gate)return gate;
 const div=OPS.division||CG.divs[0]?.id||'';OPS.division=div;CG.division=div;
 CG.dashboardKind=CG.dashboardKind==='wip'?'wip':'menu';
 const kind=CG.dashboardKind;
 const all=(kind==='wip'?CG.wips:CG.menus).filter(x=>String(x.division_id)===String(div)).sort((a,b)=>invAlpha(a.name,b.name));
 let selectedId=CG.dashboardItemId;
 if(!all.some(x=>String(x.id)===String(selectedId))){selectedId=all[0]?.id||'';CG.dashboardItemId=selectedId}
 const opts=all.map(x=>'<button type="button" class="cg-component-option cg-dashboard-option" data-component-id="'+esc(x.id)+'" data-search="'+esc(String(x.name||'').toLocaleLowerCase())+'" onclick="cgDashPick(this)">'+esc(x.name)+(x.active?'':' · Nonaktif')+'</button>').join('');
 const divOpts=CG.divs.map(d=>'<option value="'+esc(d.id)+'" '+(String(d.id)===String(div)?'selected':'')+'>'+esc(d.name)+'</option>').join('');
 const item=all.find(x=>String(x.id)===String(selectedId));
 const calc=item?(kind==='wip'?cgWipCost(item.id,[]):cgMenuCost(item.id)):null;
 const menuPrice=item&&kind==='menu'?Number(item.selling_price)||0:0;
 const foodPct=calc&&calc.ok&&kind==='menu'&&menuPrice>0?calc.total/menuPrice*100:null;
 const marginValue=calc&&calc.ok&&kind==='menu'&&menuPrice>0?menuPrice-calc.total:null;
 const marginPct=marginValue!=null&&menuPrice>0?marginValue/menuPrice*100:null;
 const metric=(label,value,sub)=>'<div class="cogs-stat cg-dashboard-metric" style="min-width:0"><span class="mu cg-dashboard-metric-label">'+label+'</span><b class="cg-dashboard-metric-value" style="font-size:clamp(15px,4vw,21px);overflow-wrap:anywhere">'+value+'</b><small class="mu cg-dashboard-metric-note" style="font-size:11px;line-height:1.4">'+sub+'</small></div>';
 let metrics='';
 if(item&&kind==='menu'){
  metrics=metric('TOTAL HPP / COST',calc&&calc.ok?cgMoney(calc.total):'Belum valid',calc&&calc.ok?(calc.source==='reference'?'Ada bahan memakai harga acuan':'Berdasarkan harga bahan terkini'):(calc&&calc.reason||'Resep belum tersedia'))
   +metric('HARGA JUAL',cgMoney(menuPrice),'Harga jual pada data Menu')
   +metric('FOOD COST',foodPct==null?'—':cgNum(foodPct)+'%','HPP dibanding harga jual')
   +metric('MARGIN KOTOR',marginPct==null?'—':cgNum(marginPct)+'%',marginValue==null?'Belum dapat dihitung':cgMoney(marginValue)+' per menu');
 }else if(item){
  metrics=metric('HPP / BATCH',calc&&calc.ok?cgMoney(calc.total):'Belum valid',calc&&calc.ok?(calc.source==='reference'?'Ada bahan memakai harga acuan':'Berdasarkan harga bahan terkini'):(calc&&calc.reason||'Resep belum tersedia'))
   +metric('HPP / SATUAN',calc&&calc.ok?cgMoney(calc.unitCost):'—','Per '+esc(item.yield_unit||'satuan hasil'))
   +metric('HASIL PER BATCH',cgNum(item.yield_qty)+' '+esc(item.yield_unit||''),'Hasil resep WIP')
   +metric('JUMLAH INGREDIENT',String(CG.wipLines.filter(l=>String(l.wip_id)===String(item.id)).length),'Komponen langsung dalam resep');
 }
 const details=item?'<div class="cogs-section cg-dashboard-ingredients" style="margin-top:12px;background:var(--cd)!important;opacity:1!important;color:var(--tx)!important"><div class="cogs-top cg-dashboard-ingredients-header" style="align-items:center"><div><b>Detail ingredient</b><div class="mu" style="font-size:11px;margin-top:3px">Jumlah, satuan, cost, dan persentase kontribusi</div></div><span class="cogs-pill">'+(kind==='menu'?'Per menu':'Per batch')+'</span></div><div class="cg-dashboard-ingredient-list" style="margin-top:7px">'+cgDashIngredientRows(kind,item.id,calc&&calc.ok?calc.total:null)+'</div></div>':'<div class="cogs-section cg-dashboard-ingredients" style="margin-top:12px;background:var(--cd)!important;opacity:1!important;color:var(--tx)!important"><div class="cogs-empty">Belum ada '+(kind==='wip'?'Resep WIP':'Menu')+' untuk divisi ini.</div></div>';
 return '<div class="cogs-wrap cg-dashboard-root"><div class="card cg-dashboard-summary-card">'
  +'<div class="cogs-top cg-dashboard-header" style="align-items:center;gap:10px;flex-wrap:wrap"><div class="cg-dashboard-heading" style="min-width:0;flex:1"><span class="cg-dashboard-eyebrow">COST OVERVIEW</span><h3 class="cg-dashboard-item-title">'+(item?esc(item.name):'Dashboard COGS')+'</h3><p class="mu" style="font-size:12px;margin-top:4px">'+(item?(kind==='menu'?'Menu':'Resep WIP')+' · '+(item.active?'Aktif':'Nonaktif'):'Pilih menu atau resep WIP untuk melihat rincian.')+'</p></div><div class="cogs-actions cg-dashboard-tabs" style="align-items:center"><button class="btn '+(kind==='menu'?'s':'o')+'" onclick="cgDashSetKind(\'menu\')">Menu</button><button class="btn '+(kind==='wip'?'s':'o')+'" onclick="cgDashSetKind(\'wip\')">Resep WIP</button></div></div>'
  +'<div class="cg-dashboard-controls-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));gap:10px;margin-top:12px"><label class="cg-dashboard-field">Divisi<select onchange="cgDashChooseDivision(this.value)">'+divOpts+'</select></label><label class="cg-dashboard-field">'+(kind==='wip'?'Cari resep WIP':'Cari menu')+'<div class="cg-component-picker cg-dashboard-picker"><input id="cg_dashboard_search" type="search" value="'+esc(item?item.name:'')+'" placeholder="'+(kind==='wip'?'Cari nama resep WIP...':'Cari nama menu...')+'" oninput="cgDashSearch(this)" onfocus="cgDashSearch(this)" autocomplete="off" style="width:100%;min-width:0"><div id="cg_dashboard_results" class="cg-component-results">'+(opts||'<div class="cg-component-empty" style="padding:10px 12px;color:var(--mu)">Belum ada item.</div>')+'<div class="cg-component-empty" style="display:none;padding:10px 12px;color:var(--mu)">Item tidak ditemukan.</div></div></div></label></div>'
  +'<div class="cg-dashboard-note" style="margin-top:10px"><span class="cogs-pill">Baca saja</span><p class="mu" style="font-size:11px;margin:7px 0 0">Sumber: Master Bahan, Menu, dan Resep WIP. Dashboard ini hanya membaca data; tidak mengubah stok, resep, harga, atau transaksi.</p></div>'
  +(item?'<div class="cg-dashboard-metrics" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;margin-top:14px">'+metrics+'</div>'+(calc&&!calc.ok?'<p class="mu" style="font-size:12px;margin-top:10px">Catatan: '+esc(calc.reason||'HPP belum valid')+'</p>':''):'')
  +'</div>'+details+'</div>';
};

// Register deferred feature views from the shared window bridge.
if(typeof window.__barappRegisterViews==='function')window.__barappRegisterViews(window.__barappPendingViews||{});
if(window.__barappRefreshUI)window.__barappRefreshUI();
