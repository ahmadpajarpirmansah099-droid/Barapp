/* ===== DAILY CLOSING APPROVAL: six operational modules ===== */
(function(){
const clToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta'}).format(new Date());
const CL={division:'',date:clToday(),period:null,modules:[],history:[],snapshots:{},loading:false,ready:false,error:'',busy:''};
function clCanAccess(){return (typeof isDeveloper==='function'&&isDeveloper())||(typeof T!=='undefined'&&T.dbRole==='div_admin')}
const MODS=[
 {key:'daily_so',name:'Daily SO',desc:'Stok fisik, saldo harapan, dan selisih',page:'cogs_daily_so',config:'cogs_daily_so'},
 {key:'pengeluaran',name:'Pengeluaran',desc:'Waste, QC, R&D, Kalibrasi, Move, Lainnya',page:'pengeluaran',config:null},
 {key:'sales',name:'Sales',desc:'Penjualan menu dan pemakaian resep',page:'cogs_sales',config:'cogs_sales'},
 {key:'barang_masuk',name:'Barang Masuk',desc:'Penerimaan dan retur barang',page:'masuk',config:null},
 {key:'produksi_wip',name:'Produksi WIP',desc:'Hasil produksi dan pemakaian resep',page:'cogs_production',config:'cogs_production'},
 {key:'suplies',name:'Suplies',desc:'Stok aktual perlengkapan service',page:'supplies',config:'supplies'}
];
function clDivision(id){
 const groups=[(typeof INV!=='undefined'&&INV.divs)||[],(typeof CG!=='undefined'&&CG.divs)||[],(typeof T!=='undefined'&&T.divs)||[]];
 for(const g of groups){const d=g.find(x=>String(x.id)===String(id));if(d)return d}
 return null;
}
function clModuleOn(div,key){
 const d=clDivision(div);if(!d)return false;
 const c=d.module_config&&typeof d.module_config==='object'?d.module_config:{};
 if(key==='closing'||key==='inventory')return true;
 if(Object.prototype.hasOwnProperty.call(c,key))return c[key]===true;
 return !!d.has_cogs;
}
function clModulesForDivision(div){return MODS.filter(m=>!m.config||clModuleOn(div,m.config))}
function count(key,div,date){
 if(key==='daily_so')return CG.dailySO.filter(x=>String(x.division_id)===String(div)&&String(x.so_date)===String(date)&&x.status==='submitted').length;
 if(key==='pengeluaran')return INV.stockOut.filter(x=>String(x.from_division_id)===String(div)&&String(x.out_date)===String(date)&&x.status==='posted').length;
 if(key==='sales')return CG.sales.filter(x=>String(x.division_id)===String(div)&&String(x.sold_at)===String(date)&&x.status==='posted').length;
 if(key==='barang_masuk')return INV.ins.filter(x=>String(x.division_id)===String(div)&&String(x.received_at)===String(date)&&x.status==='posted').length+INV.rets.filter(x=>String(x.division_id)===String(div)&&String(x.returned_at)===String(date)&&x.status==='posted').length;
 if(key==='produksi_wip')return CG.productions.filter(x=>String(x.division_id)===String(div)&&String(x.produced_at)===String(date)&&x.status==='posted').length;
 if(key==='suplies')return INV.suppliesSO.filter(x=>String(x.division_id)===String(div)&&String(x.so_date)===String(date)&&x.status==='submitted').length;
 return 0;
}
function clError(e){
 const m=String(e?.message||e||'');
 if(/CLOSING_ACCESS_DENIED|CLOSING_ROLE_FORBIDDEN/.test(m))return 'Approval Closing hanya tersedia untuk Developer dan Admin Divisi.';
 if(/CLOSING_INVALID_DATE/.test(m))return 'Tanggal closing tidak valid.';
 if(/CLOSING_MODULE_HAS_DATA/.test(m))return 'Modul memiliki transaksi. Pilih konfirmasi data, bukan konfirmasi kosong.';
 if(/CLOSING_CONFIRM_EMPTY_REQUIRED/.test(m))return 'Ada data pada modul ini. Konfirmasi sebagai data terisi.';
 if(/CLOSING_DAILY_SO_REQUIRED/.test(m))return 'Daily SO wajib disimpan sebelum closing.';
 if(/CLOSING_MODULES_INCOMPLETE/.test(m))return 'Semua modul aktif harus dikonfirmasi sebelum approval.';
 if(/CLOSING_SO_ITEM_SET_CHANGED/.test(m))return 'Daftar item Daily SO berubah. Muat ulang dan periksa kembali daftar item.';
 if(/CLOSING_ALREADY_APPROVED/.test(m))return 'Closing sudah disetujui. Gunakan proses rekonsiliasi untuk perubahan.';
 if(/CLOSING_NOT_STARTED/.test(m))return 'Belum ada proses closing untuk tanggal dan divisi ini.';
 if(/CLOSING_INVALID_MODULE/.test(m))return 'Modul closing tidak dikenali.';
 return opsErr(e);
}
function same(a,b){return !!a&&!!b&&String(a.fingerprint||'')===String(b.fingerprint||'')&&Number(a.count||0)===Number(b.count||0)&&Number(a.quantity||0)===Number(b.quantity||0)}
async function load(show=true){
 if(!clCanAccess()){CL.ready=false;CL.error='Approval Closing hanya tersedia untuk Developer dan Admin Divisi.';if(show&&pg==='cogs_closing')R();return;}
 if(CL.loading)return;
 CL.loading=true;CL.error='';
 try{
  if(!CG.ready)await cgLoad(false);
  if(!INV.ready)await invLoad(false);
  if(!CG.ready)throw new Error(CG.err||'Data operasional belum selesai dimuat.');
  if(!INV.ready)throw new Error(INV.err||'Data inventori belum selesai dimuat.');
  const divs=INV.divs.length?INV.divs:CG.divs;
  if(!CL.division||!divs.some(d=>String(d.id)===String(CL.division)))CL.division=divs[0]?.id||'';
  if(!CL.division)throw new Error('Tidak ada divisi yang bisa diakses pada outlet aktif.');
  const {data:period,error:pe}=await sb().from('barapp_closing_periods').select('*').eq('division_id',CL.division).eq('closing_date',CL.date).maybeSingle();
  if(pe)throw pe;CL.period=period||null;CL.modules=[];CL.snapshots={};
  const activeModules=clModulesForDivision(CL.division);
  if(period){const {data:rows,error}=await sb().from('barapp_closing_modules').select('*').eq('closing_id',period.id);if(error)throw error;CL.modules=(rows||[]).filter(x=>activeModules.some(m=>m.key===x.module_key));}
  await Promise.all(activeModules.map(async m=>{const {data,error}=await sb().rpc('barapp_closing_module_snapshot',{p_division_id:CL.division,p_closing_date:CL.date,p_module_key:m.key});if(error)throw error;CL.snapshots[m.key]=data;}));
  const {data:hist,error:he}=await sb().from('barapp_closing_periods').select('id,division_id,closing_date,status,approved_at,approved_by,summary').eq('division_id',CL.division).order('closing_date',{ascending:false}).limit(15);
  if(he)throw he;CL.history=hist||[];CL.ready=true;
 }catch(e){CL.error=String(e?.message||e||'Gagal memuat approval closing.');}
 finally{CL.loading=false;if(show&&pg==='cogs_closing')R();}
}
function init(){if(!CL.ready&&!CL.loading)load(true)}
async function filter(k,val){if(k==='division')CL.division=val;else CL.date=val||clToday();CL.ready=false;await load(true)}
function state(m){const saved=CL.modules.find(x=>x.module_key===m.key),cur=CL.snapshots[m.key],fresh=saved&&same(saved.snapshot,cur);if(saved&&fresh)return {saved,fresh:true};if(saved)return {saved,fresh:false};return {saved:null,fresh:false}}
async function confirmModule(key){
 if(!clCanAccess())return toast('Approval Closing hanya tersedia untuk Developer dan Admin Divisi.','warn');
 if(CL.busy)return;const m=clModulesForDivision(CL.division).find(x=>x.key===key);if(!m)return;const current=state(m);if(current.saved&&current.fresh)return toast(m.name+' sudah dikonfirmasi. Tidak perlu diklik lagi.','ok');
 if(CL.period?.status==='approved')return toast('Closing sudah approved. Perubahan harus melalui rekonsiliasi.','warn');
 const n=count(key,CL.division,CL.date);if(key==='daily_so'&&!n)return toast('Simpan Daily SO terlebih dahulu sebelum closing.','warn');
 if(n===0&&!confirm('Konfirmasi bahwa '+m.name+' memang tidak memiliki transaksi/data pada tanggal ini?'))return;
 CL.busy=key;R();
 try{const {error}=await sb().rpc('barapp_closing_confirm_module',{p_division_id:CL.division,p_closing_date:CL.date,p_module_key:key,p_confirmed_empty:n===0,p_note:null});if(error)throw error;CL.ready=false;await load(false);toast(m.name+' berhasil dikonfirmasi.','ok')}
 catch(e){toast(clError(e),'err')}
 finally{CL.busy='';if(pg==='cogs_closing')R()}
}
async function approve(){
 if(!clCanAccess())return toast('Approval Closing hanya tersedia untuk Developer dan Admin Divisi.','warn');
 if(CL.busy||CL.period?.status==='approved')return;
 const activeModules=clModulesForDivision(CL.division);
 const missing=activeModules.filter(m=>{const x=state(m);return !x.saved||!x.fresh});
 if(missing.length)return toast('Konfirmasi ulang modul: '+missing.map(x=>x.name).join(', '),'warn');
 if(clModuleOn(CL.division,'cogs_daily_so')&&!count('daily_so',CL.division,CL.date))return toast('Daily SO wajib tersimpan sebelum closing.','warn');
 if(!confirm('Setujui closing '+CL.date+'? Sistem menghitung ulang saldo dan mengunci snapshot closing.'))return;
 CL.busy='approve';R();
 try{const {data,error}=await sb().rpc('barapp_closing_approve',{p_division_id:CL.division,p_closing_date:CL.date,p_note:null});if(error)throw error;CL.ready=false;await load(false);if(data?.status==='needs_reconciliation')toast('Data berubah saat approval. Periksa dan konfirmasi ulang: '+(data.changed_modules||[]).join(', '),'warn');else toast('Closing berhasil disetujui. Snapshot stok sudah difinalisasi.','ok')}
 catch(e){toast(opsErr(e),'err');CL.ready=false;await load(false)}
 finally{CL.busy='';if(pg==='cogs_closing')R()}
}



function opTId(){try{if(window.crypto&&typeof window.crypto.randomUUID==='function')return window.crypto.randomUUID()}catch(e){}return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.random()*16|0;return(c==='x'?r:(r&3|8)).toString(16)})}
function opTBlank(v){return v===null||v===undefined||String(v).trim()===''}
function opTNum(v){if(typeof v==='number')return Number.isFinite(v)?v:NaN;if(opTBlank(v))return null;const n=Number(String(v).trim().replace(/\s/g,'').replace(',','.'));return Number.isFinite(n)?n:NaN}
function opTDate(v){if(v instanceof Date&&!Number.isNaN(v.getTime()))return v.toISOString().slice(0,10);if(typeof v==='number'&&Number.isFinite(v)&&v>=1&&v<100000){const d=new Date(Date.UTC(1899,11,30)+Math.round(v)*86400000);if(!Number.isNaN(d.getTime()))return d.toISOString().slice(0,10)}const x=String(v??'').trim();if(/^\d{4}-\d{2}-\d{2}$/.test(x))return x;const m=x.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);return m?m[3]+'-'+String(m[2]).padStart(2,'0')+'-'+String(m[1]).padStart(2,'0'):x}
function opTSameSet(a,b){if(a.length!==b.length)return false;const x=new Set(a),y=new Set(b);return x.size===a.length&&y.size===b.length&&a.every(v=>y.has(v))}
function opTPreferredUnit(item){
 const key=String(item?.name||'').toLocaleUpperCase().replace(/[^A-Z0-9]/g,'');
 const pref={'SKM':'CAN','SKMCOKLAT':'PACK','GALONAQUA':'GALON','GALONVIT':'GALON','ESBATUATLAS':'BALL','GINGERALE':'CAN','GINGGERALE':'CAN','COCONUTWATER':'BOTOL/PACK','RON88':'BOTOL/PACK'}[key];
 const base=String(item?.base_unit||'UNIT'),convs=(Array.isArray(item?.conversions)?item.conversions:[]).filter(x=>x&&String(x.unit||'').trim()&&Number(x.factor)>0);
 if(pref){const match=convs.find(x=>String(x.unit).trim().toUpperCase()===pref);if(match)return {unit:String(match.unit).trim(),factor:Number(match.factor),requested:pref,missing:false};return {unit:base,factor:1,requested:pref,missing:true}}
 const exact=convs.find(x=>String(x.unit).trim().toUpperCase()===base.toUpperCase());
 return {unit:base,factor:exact?Number(exact.factor):1,requested:'',missing:false};
}
function opTStockOutCategories(){const x=window.__barappStockOutCategories;return [...new Set((Array.isArray(x)?x:['Move','Waste','QC','R&D','Kalibrasi','Lainnya']).map(v=>String(v||'').trim()).filter(Boolean))]}
function opTCatalog(){
 const division=String(CL.division),date=String(CL.date),div=clDivision(division),outlet=String(div?.outlet_id||'');
 const allItems=(INV.items||[]).filter(x=>String(x.division_id)===division&&x.active===true).sort((a,b)=>invAlpha(a.name,b.name));
 const materials=allItems.filter(x=>x.is_supply!==true),supplies=allItems.filter(x=>x.is_supply===true&&String(x.created_at||'0000-01-01').slice(0,10)<=date),items=materials.concat(supplies);
 const wips=(CG.wips||[]).filter(x=>String(x.division_id)===division&&x.active===true).sort((a,b)=>invAlpha(a.name,b.name));
 const menus=(CG.menus||[]).filter(x=>String(x.division_id)===division&&x.active===true).sort((a,b)=>invAlpha(a.name,b.name));
 const divisions=[...(INV.divs||[]),...(CG.divs||[])],dm=new Map();
 divisions.forEach(d=>{if(d&&d.id&&d.active!==false&&String(d.id)!==division&&(!outlet||String(d.outlet_id)===outlet))dm.set(String(d.id),d)});
 const returns=(INV.ins||[]).filter(r=>String(r.division_id)===division&&r.status==='posted').map(r=>{
   const it=(INV.items||[]).find(x=>String(x.id)===String(r.item_id));
   const returned=(INV.rets||[]).filter(q=>String(q.stock_in_id)===String(r.id)&&q.status==='posted').reduce((n,q)=>n+Number(q.qty_base||0),0);
   return {receipt:r,item:it,remaining:Number(r.qty_base||0)-returned};
  }).filter(x=>x.remaining>0.000001&&!((INV.rets||[]).some(q=>String(q.stock_in_id)===String(x.receipt.id)&&String(q.returned_at)===date&&q.status==='posted')))
  .sort((a,b)=>String(b.receipt.received_at||'').localeCompare(String(a.receipt.received_at||''))||invAlpha(a.item?.name,b.item?.name));
 const expenseItems=items.map(x=>({id:String(x.id),rawType:'material',labelType:x.is_supply===true?'Supplies':'Item',name:String(x.name),unit:String(x.is_supply===true?(x.base_unit||'UNIT'):opTPreferredUnit(x).unit),division_id:String(x.division_id),item:x}))
   .concat((divisionModuleOn(div,'cogs_wip')?wips:[]).map(x=>({id:String(x.id),rawType:'wip',labelType:'WIP',name:String(x.name),unit:String(x.yield_unit||'UNIT'),division_id:String(x.division_id),item:x})))
   .sort((a,b)=>invAlpha(a.name,b.name)||invAlpha(a.labelType,b.labelType));
 const dailyOn=clModuleOn(division,'cogs_daily_so'),wipOn=clModuleOn(division,'cogs_wip'),productionOn=clModuleOn(division,'cogs_production'),salesOn=clModuleOn(division,'cogs_sales'),suppliesOn=clModuleOn(division,'supplies');
 return {division,date,outlet,div,items,materials,supplies,wips:wipOn?wips:[],menus:salesOn?menus:[],returns,expenseItems,categories:opTStockOutCategories(),divisions:[...dm.values()].sort((a,b)=>invAlpha(a.name,b.name)),dailyOn,wipOn,productionOn,salesOn,suppliesOn,
   dailyMaterials:dailyOn?materials:[],dailyWips:dailyOn&&wipOn?wips:[]};
}
function opTEnsureExcelJS(){
 if(window.ExcelJS&&typeof window.ExcelJS.Workbook==='function')return Promise.resolve(window.ExcelJS);
 if(window.__opTExcelJSLoading)return window.__opTExcelJSLoading;
 window.__opTExcelJSLoading=new Promise((resolve,reject)=>{
  const sc=document.createElement('script');sc.src='https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';sc.async=true;
  sc.onload=()=>window.ExcelJS&&typeof window.ExcelJS.Workbook==='function'?resolve(window.ExcelJS):reject(new Error('Library Excel tidak berhasil dimuat.'));
  sc.onerror=()=>reject(new Error('Gagal memuat library Excel. Periksa koneksi internet lalu coba lagi.'));
  document.head.appendChild(sc);
 });
 return window.__opTExcelJSLoading.finally(()=>{window.__opTExcelJSLoading=null});
}
function opTPermissions(p){
 if(isDeveloper()||!p)return [];
 const errors=[],need=(yes,key,label)=>{if(yes&&!hasFeature(key))errors.push('Akun belum memiliki izin '+label+'.')};
 need(p.daily_so.length,'cogs.daily_so.edit','edit Daily SO');
 need(p.sales.length,'cogs.sales.manage','input Penjualan');
 need(p.production.length,'cogs.production.manage','input Produksi WIP');
 const invWrite=!!(p.stock_in.length||p.stock_out.length||p.supplies.length||p.stock_returns.length);
 need(invWrite,'inventory.view','lihat Inventory');need(invWrite,'inventory.manage','mengelola Inventory');
 return [...new Set(errors)];
}
function opTOpenDialog(){
 if(!clCanAccess())return toast('Approval Closing hanya tersedia untuk Developer dan Admin Divisi.','warn');
 if(!window.XLSX)return toast('Modul Excel belum siap. Muat ulang halaman lalu coba lagi.','warn');
 if(!CL.division||!CL.date)return toast('Pilih divisi dan tanggal closing terlebih dahulu.','warn');
 if(CL.period&&['approved','needs_reconciliation'].includes(CL.period.status))return toast('Closing sudah final atau memerlukan rekonsiliasi. Template untuk tanggal ini dikunci.','warn');
 modal('<h3>Template Daily SO</h3><p class="mu">File Excel khusus Stock Opname. Isi hanya kolom Stok Fisik Akhir untuk item dan WIP yang tampil. Master serta satuan mengikuti Barapp; bagian operasional lain tidak digunakan.</p><p class="mu"><b>Divisi:</b> '+esc(clDivision(CL.division)?.name||'Divisi')+'<br><b>Tanggal:</b> '+esc(CL.date)+'</p><div class="btns"><button class="btn" type="button" onclick="window.__clDownloadOperationalTemplate()">Export Template Daily SO</button><label class="btn s" style="display:inline-flex;align-items:center;gap:8px;cursor:pointer">Import Template Daily SO<input id="op_template_file" type="file" accept=".xlsx,.xls" style="display:none" onchange="window.__clPreviewOperationalImport(this)"></label></div><p class="mu" style="font-size:12px">Isi hanya kolom Stok Fisik Akhir. Jangan mengubah nama item, ID tersembunyi, struktur, outlet, divisi, atau tanggal. Import hanya menyimpan Daily SO.</p>');
}
async function opTOpenFromDailySO(){
 if(!clCanAccess())return toast('Template Daily SO hanya tersedia untuk Developer dan Admin Divisi.','warn');
 const division=typeof OPS!=='undefined'?String(OPS.division||CG.divs[0]?.id||''):'';
 const date=typeof OPS!=='undefined'?String(OPS.date||opsDate()):clToday();
 if(!division||!date)return toast('Pilih divisi dan tanggal Daily SO terlebih dahulu.','warn');
 CL.division=division;CL.date=date;CL.period=null;CL.operationalTemplateDraft=null;
 try{
  const {data:period,error}=await sb().from('barapp_closing_periods').select('id,status').eq('division_id',division).eq('closing_date',date).maybeSingle();
  if(error)throw error;
  CL.period=period||null;
  opTOpenDialog();
 }catch(e){toast('Gagal memeriksa status closing: '+clError(e),'err')}
}

async function opTDownload(){
 if(!clCanAccess())return toast('Akses ditolak.','warn');
 if(!window.XLSX)return toast('Modul Excel belum siap.','warn');
 if(!CL.division||!CL.date)return toast('Pilih divisi dan tanggal closing terlebih dahulu.','warn');
 if(CL.period&&['approved','needs_reconciliation'].includes(CL.period.status))return toast('Tanggal closing terkunci.','warn');
 try{
  if(!CG.ready)await cgLoad(false);if(!INV.ready)await invLoad(false);
  if(!CG.ready||!INV.ready)throw new Error('Master operasional belum berhasil dimuat.');
  const c=opTCatalog(),ExcelJS=await opTEnsureExcelJS(),book=new ExcelJS.Workbook(),ws=book.addWorksheet('DAILY SO');
  const rowMeta=[],headerRows=[];
  ws.getCell('A1').value='BARAPP — TEMPLATE DAILY SO';
  ws.getCell('A2').value='FORMAT';ws.getCell('B2').value='BARAPP_DAILY_SO_TEMPLATE_V1';
  ws.getCell('A3').value='OUTLET_ID';ws.getCell('B3').value=c.outlet;ws.getCell('C3').value='DIVISI';ws.getCell('D3').value=String(c.div?.name||'');ws.getCell('E3').value='TANGGAL SO';ws.getCell('F3').value=String(CL.date);
  ws.getCell('A4').value='CATATAN';ws.getCell('B4').value='Isi hanya kolom Stok Fisik Akhir. Kosongkan jika belum melakukan stock opname.';
  ws.mergeCells('B4:G4');ws.getCell('B4').alignment={wrapText:true,vertical:'middle'};
  const addSection=(title,headers)=>{
   const sec=ws.addRow([title]),r=sec.number;ws.mergeCells(r,1,r,headers.length);sec.height=22;
   const head=ws.addRow(headers);head.height=30;headerRows.push(head.number);return head.number+1;
  };
  const stockStart=addSection('1. DAILY SO — STOK FISIK AKHIR ITEM',['Nama Barang','Jenis Master','Satuan Input','','','Stok Fisik Akhir (Qty)','Catatan']);
  const unitSet=new Set();
  c.dailyMaterials.forEach(x=>{
   const pref=opTPreferredUnit(x);
   const row=ws.addRow([x.name,'Item',pref.unit,'','','','']);
   rowMeta.push({section:'STOCK',row:row.number,id:String(x.id),type:'material',name:x.name,unit:pref.unit,base_unit:String(x.base_unit||'UNIT'),factor:pref.factor,missing:pref.missing});
   (Array.isArray(x.conversions)?x.conversions:[]).forEach(cv=>{const u=String(cv.unit||'').trim();if(u&&Number(cv.factor)>0)unitSet.add(u)});
  });
  const wipStart=addSection('2. DAILY SO — STOK FISIK AKHIR WIP',['Nama WIP','Satuan Hasil','','Stok Fisik Akhir (Qty)','Catatan']);
  c.dailyWips.forEach(x=>{
   const row=ws.addRow([x.name,String(x.yield_unit||'UNIT'),'','','']);
   rowMeta.push({section:'WIP',row:row.number,id:String(x.id),type:'wip',name:x.name,unit:String(x.yield_unit||'UNIT'),base_unit:String(x.yield_unit||'UNIT'),factor:1,yield_qty:Number(x.yield_qty||0)});
  });
  const rowEnd=ws.rowCount;
  ws.views=[{state:'frozen',ySplit:7}];
  [34,18,16,19,22,21,32].forEach((w,i)=>ws.getColumn(i+1).width=w);
  const thin={style:'thin',color:{argb:'FFBEBEBE'}},border={top:thin,bottom:thin,left:thin,right:thin};
  ws.getRow(1).height=28;ws.getCell('A1').font={name:'Arial',size:14,bold:true,color:{argb:'FF111111'}};
  for(const addr of ['A2','A3','C3','E3','A4'])ws.getCell(addr).font={name:'Arial',size:10,bold:true,color:{argb:'FF111111'}};
  for(let r=1;r<=rowEnd;r++){
   if(headerRows.includes(r)){
    for(let col=1;col<=7;col++){const cell=ws.getCell(r,col);cell.font={name:'Arial',size:10,bold:true,color:{argb:'FFFFFFFF'}};cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF333333'}};cell.alignment={vertical:'middle',horizontal:'center',wrapText:true};cell.border=border}
    continue;
   }
   if(r>1&&headerRows.includes(r+1)){for(let col=1;col<=7;col++){const cell=ws.getCell(r,col);cell.font={name:'Arial',size:10,bold:true,color:{argb:'FF111111'}};cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFE7E7E7'}};cell.border=border}continue;}
   if((r>=stockStart&&r<stockStart+c.dailyMaterials.length)||(r>=wipStart&&r<=rowEnd)){
    for(let col=1;col<=7;col++){const cell=ws.getCell(r,col);cell.border=border;cell.font={name:'Arial',size:10,color:{argb:'FF111111'}};cell.alignment={vertical:'middle',wrapText:col===1||col===6||col===7};if(r%2===0)cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF5F5F5'}}}
   }
  }
  for(const x of rowMeta.filter(x=>x.section==='STOCK'))ws.getCell(x.row,6).numFmt='0.####';
  for(const x of rowMeta.filter(x=>x.section==='WIP'))ws.getCell(x.row,4).numFmt='0.####';
  const hiddenCols=['AA','AB','AC','AD','AE','AF','AG','AH','AI','AJ','AK','AL','AM','AN','AO'];
  hiddenCols.forEach(col=>ws.getColumn(col).hidden=true);
  [['FORMAT','BARAPP_DAILY_SO_TEMPLATE_V1'],['TEMPLATE_ID',opTId()],['OUTLET_ID',c.outlet],['DIVISION_ID',String(CL.division)],['TARGET_DATE',String(CL.date)],['GENERATED_AT',new Date().toISOString()]].forEach(([key,val],i)=>{ws.getCell('AA'+(i+1)).value=key;ws.getCell('AB'+(i+1)).value=val});
  ['SECTION','ROW','ID','TYPE','NAME','UNIT','BASE_UNIT','FACTOR','YIELD_QTY','AUX_ID','REMAINING','RECEIVED_AT'].forEach((v,i)=>ws.getCell(1,30+i).value=v);
  rowMeta.forEach((x,i)=>[x.section,x.row,x.id,x.type,x.name,x.unit,x.base_unit,x.factor??1,x.yield_qty??'',x.aux_id||'',x.remaining??'',x.received_at||''].forEach((v,j)=>ws.getCell(i+2,30+j).value=v));
  const allUnits=new Set();c.dailyMaterials.forEach(x=>{if(x.base_unit)allUnits.add(String(x.base_unit));(Array.isArray(x.conversions)?x.conversions:[]).forEach(v=>{if(v?.unit&&Number(v.factor)>0)allUnits.add(String(v.unit))})});
  [...allUnits].sort((a,b)=>invAlpha(a,b)).forEach((u,i)=>ws.getCell(i+2,43).value=u);
  const unitEnd=Math.max(2,allUnits.size+1);
  if(allUnits.size)ws.dataValidations.add('C'+stockStart+':C'+Math.max(stockStart,stockStart+c.dailyMaterials.length-1),{type:'list',allowBlank:true,formulae:['=$AQ$2:$AQ$'+unitEnd],showErrorMessage:true,errorStyle:'stop',errorTitle:'Satuan tidak valid',error:'Pilih satuan dari daftar; satuan akan diperiksa lagi berdasarkan master item.'});
  ws.autoFilter={from:{row:stockStart-1,column:1},to:{row:Math.max(stockStart,stockStart+c.dailyMaterials.length-1),column:7}};
  const buf=await book.xlsx.writeBuffer(),blob=new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='BARAPP_Template_Daily_SO_'+String(clDivision(CL.division)?.name||'Divisi').replace(/[^a-z0-9]+/gi,'-')+'-'+CL.date+'.xlsx';document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
  toast('Telah Di Unduh, DAGOAN!','ok');
 }catch(e){toast('Gagal membuat template Daily SO: '+String(e?.message||e),'err')}
}
function opTReadMeta(ws){
 const out={};for(let r=1;r<=6;r++){const k=String(ws['AA'+r]?.v||'').trim();if(k)out[k]=String(ws['AB'+r]?.v??'').trim()}
 return out;
}
function opTMapRows(ws){
 const range=XLSX.utils.decode_range(ws['!ref']||'A1:AP1'),out=[];
 for(let r=2;r<=range.e.r+1;r++){
  const section=String(ws['AD'+r]?.v||'').trim(),id=String(ws['AF'+r]?.v||'').trim();
  if(!section||!id)continue;
  out.push({section,row:Number(ws['AE'+r]?.v),id,type:String(ws['AG'+r]?.v||''),name:String(ws['AH'+r]?.v||''),unit:String(ws['AI'+r]?.v||''),base_unit:String(ws['AJ'+r]?.v||''),factor:Number(ws['AK'+r]?.v||1),yield_qty:Number(ws['AL'+r]?.v||0),aux_id:String(ws['AM'+r]?.v||''),remaining:Number(ws['AN'+r]?.v||0),received_at:String(ws['AO'+r]?.v||'')});
 }
 return out;
}
function opTExpenseOptions(ws){
 const range=XLSX.utils.decode_range(ws['!ref']||'A1:BA1'),out=[];
 for(let r=2;r<=range.e.r+1;r++){const label=String(ws['AQ'+r]?.v||'').trim(),id=String(ws['AR'+r]?.v||'').trim();if(!label||!id)continue;out.push({label,id,rawType:String(ws['AS'+r]?.v||''),masterType:String(ws['AT'+r]?.v||''),unit:String(ws['AU'+r]?.v||''),division_id:String(ws['AV'+r]?.v||''),name:String(ws['AW'+r]?.v||'')})}
 return out;
}
function opTConflictErrors(p,c){
 const e=[],d=String(CL.division),date=String(CL.date);
 if(p.daily_so.length&&(CG.dailySO||[]).some(x=>String(x.division_id)===d&&String(x.so_date)===date&&x.status==='submitted'))e.push('Daily SO sudah tersimpan pada tanggal ini. Kosongkan semua kolom Stok Fisik untuk melewati bagian ini.');
 if(p.supplies.length&&(INV.suppliesSO||[]).some(x=>String(x.division_id)===d&&String(x.so_date)===date&&x.status==='submitted'))e.push('Daily SO Supplies sudah tersimpan pada tanggal ini. Kosongkan seluruh Stok Fisik Supplies untuk melewati bagian ini.');
 if(p.sales.length&&(CG.sales||[]).some(x=>String(x.division_id)===d&&String(x.sold_at)===date&&x.status==='posted'))e.push('Sudah ada Penjualan Menu pada tanggal ini. Kosongkan seluruh Qty Terjual agar tidak duplikat.');
 if(p.stock_in.length&&(INV.ins||[]).some(x=>String(x.division_id)===d&&String(x.received_at)===date&&x.status==='posted'))e.push('Sudah ada Barang Masuk pada tanggal ini. Kosongkan seluruh Barang Masuk agar tidak duplikat.');
 if(p.stock_out.length&&(INV.stockOut||[]).some(x=>String(x.from_division_id)===d&&String(x.out_date)===date&&x.status==='posted'))e.push('Sudah ada Pengeluaran pada tanggal ini. Kosongkan seluruh Pengeluaran agar tidak duplikat.');
 if(p.production.length&&(CG.productions||[]).some(x=>String(x.division_id)===d&&String(x.produced_at)===date&&x.status==='posted'&&x.cost_source!=='opening'))e.push('Sudah ada Produksi WIP pada tanggal ini. Kosongkan seluruh Produksi Aktual agar tidak duplikat.');
 return e;
}
async function opTPreview(input){
 const file=input&&input.files&&input.files[0];if(!file)return;
 if(!clCanAccess())return toast('Akses ditolak.','warn');
 if(!window.XLSX)return toast('Modul Excel belum siap.','warn');
 if(file.size>15*1024*1024)return toast('Ukuran file terlalu besar. Maksimal 15 MB.','warn');
 modal('<h3>Memvalidasi Template Operasional…</h3><p class="mu">Memeriksa master, satuan, stok fisik ITEM dan WIP, serta status Daily SO. Belum ada data disimpan.</p>');
 const errors=[];
 try{
  await Promise.all([cgLoad(false),invLoad(false)]);
  const {data:period,error:pe}=await sb().from('barapp_closing_periods').select('id,status').eq('division_id',CL.division).eq('closing_date',CL.date).maybeSingle();if(pe)throw pe;
  CL.period=period?Object.assign({},CL.period||{},period):null;
  const wb=XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:false}),ws=wb.Sheets['DAILY SO'];
  if(!ws)errors.push('Sheet DAILY SO tidak ditemukan. Gunakan template operasional yang diekspor dari Approval.');
  if(!ws)throw new Error('Sheet utama tidak ditemukan.');
  const meta=opTReadMeta(ws);
  if(String(ws['B2']?.v||'').trim()!=='BARAPP_DAILY_SO_TEMPLATE_V1'||meta.FORMAT!=='BARAPP_DAILY_SO_TEMPLATE_V1')errors.push('Format template lama atau tidak dikenali. Unduh template Daily SO terbaru.');
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(meta.TEMPLATE_ID||''))errors.push('ID template tidak valid. Unduh ulang template.');
  if(String(meta.DIVISION_ID||'')!==String(CL.division))errors.push('Template dibuat untuk divisi berbeda.');
  if(String(meta.TARGET_DATE||'')!==String(CL.date))errors.push('Tanggal template berbeda dari tanggal closing yang dipilih.');
  if(String(meta.OUTLET_ID||'')!==String(clDivision(CL.division)?.outlet_id||''))errors.push('Template berasal dari outlet berbeda.');
  if(CL.period&&['approved','needs_reconciliation'].includes(CL.period.status))errors.push('Closing tanggal ini final atau memerlukan rekonsiliasi. Import ditolak.');
  if(!CG.ready||!INV.ready)throw new Error(CG.err||INV.err||'Master operasional belum berhasil dimuat.');
  const c=opTCatalog(),mapped=opTMapRows(ws),expenseOptions=opTExpenseOptions(ws);
  const byKey=new Map(mapped.map(x=>[x.section+':'+x.id,x]));
  if(byKey.size!==mapped.length)errors.push('Metadata template berisi ID duplikat.');
  const requiredSections={
   STOCK:c.dailyMaterials.map(x=>({id:String(x.id),name:String(x.name),type:'material',unit:String(opTPreferredUnit(x).unit||x.base_unit||'UNIT')})),
   WIP:c.dailyWips.map(x=>({id:String(x.id),name:String(x.name),type:'wip',unit:String(x.yield_unit||'UNIT')})),
  };
  for(const sec of Object.keys(requiredSections)){
   const actual=mapped.filter(x=>x.section===sec),expected=requiredSections[sec];
   if(actual.length!==expected.length||!opTSameSet(actual.map(x=>x.id+':'+x.type),expected.map(x=>x.id+':'+x.type)))errors.push(sec+': daftar master berubah. Unduh template baru.');
   actual.forEach(x=>{
    const ex=expected.find(y=>y.id===x.id);
    if(!ex||x.name!==ex.name||x.type!==ex.type||x.unit!==ex.unit)errors.push(sec+' baris '+x.row+': nama, jenis, atau satuan tidak sesuai master terbaru.');
   });
  }
  const p={daily_so:[],sales:[],stock_in:[],opening_wip:[],stock_out:[],production:[],supplies:[],stock_returns:[],daily_so_notes:'',sales_notes:'',production_notes:'',supplies_notes:''};
  const globalNote=String(ws['B4']?.v??'').trim();
  if(globalNote.length>500)errors.push('Catatan umum maksimal 500 karakter.');
  p.daily_so_notes=globalNote;p.sales_notes=globalNote;p.production_notes=globalNote;p.supplies_notes=globalNote;
  const dailyRows=[],supplyRows=[],stockSeen=new Set();
  const dailyPhysicalTouched=mapped.some(x=>(x.section==='STOCK'&&x.type==='material'&&!opTBlank(ws['F'+x.row]?.v))||(x.section==='WIP'&&!opTBlank(ws['D'+x.row]?.v)));
  const supplyPhysicalTouched=mapped.some(x=>x.section==='STOCK'&&x.type==='supply'&&!opTBlank(ws['F'+x.row]?.v));
  let dailyTouched=dailyPhysicalTouched,supplyTouched=supplyPhysicalTouched;
  mapped.filter(x=>x.section==='STOCK').forEach(x=>{
   const row=x.row,name=String(ws['A'+row]?.v??'').trim(),type=String(ws['B'+row]?.v??'').trim(),unit=String(ws['C'+row]?.v??'').trim();
   const item=(INV.items||[]).find(y=>String(y.id)===x.id);
   if(!item||item.active!==true||String(item.division_id)!==String(CL.division)||String(item.name)!==x.name||name!==x.name) {errors.push('STOCK baris '+row+': item berubah, tidak aktif, atau bukan milik divisi ini.');return}
   const expectedType=item.is_supply===true?'Supplies':'Item';
   if(type!==expectedType)errors.push('STOCK baris '+row+': Jenis Master tidak sesuai master Barapp.');
   const unitOption=[{unit:item.base_unit,factor:1},...(Array.isArray(item.conversions)?item.conversions:[])].find(cv=>String(cv.unit||'').trim().toLowerCase()===unit.toLowerCase()&&Number(cv.factor||0)>0);
   if(!unitOption)errors.push('STOCK baris '+row+': Satuan "'+unit+'" tidak tersedia untuk item ini.');
   const factor=Number(unitOption?.factor||1);
   const qtyIn=opTNum(ws['D'+row]?.v),invoice=opTNum(ws['E'+row]?.v),actual=opTBlank(ws['F'+row]?.v)?0:opTNum(ws['F'+row]?.v),note=String(ws['G'+row]?.v??'').trim();
   if(!opTBlank(ws['D'+row]?.v)){
    if(qtyIn===null||!Number.isFinite(qtyIn)||qtyIn<0)errors.push('STOCK baris '+row+': Barang Masuk harus angka 0 atau lebih.');
    else if(qtyIn>0&&unitOption){
     if(stockSeen.has(x.id))errors.push('Barang Masuk: item yang sama muncul lebih dari sekali.');else{stockSeen.add(x.id);if(invoice!==null&&(!Number.isFinite(invoice)||invoice<0))errors.push('STOCK baris '+row+': total invoice harus 0 atau lebih.');else p.stock_in.push({item_id:x.id,qty:qtyIn,unit:unit,invoice_total:invoice===null?null:invoice,notes:note})}
    }
   }else if(!opTBlank(ws['E'+row]?.v))errors.push('STOCK baris '+row+': Total Invoice harus kosong jika Barang Masuk tidak diisi.');
   if(!opTBlank(ws['F'+row]?.v)||(item.is_supply===true?supplyPhysicalTouched&&c.suppliesOn:dailyPhysicalTouched&&c.dailyOn)){
    if(actual===null||!Number.isFinite(actual)||actual<0)errors.push('STOCK baris '+row+': Stok Fisik harus angka 0 atau lebih.');
    else if(item.is_supply===true){
     if(c.suppliesOn)supplyRows.push({item_id:x.id,qty:actual*factor,actual_qty_base:actual*factor});
     else if(!opTBlank(ws['F'+row]?.v))errors.push('STOCK baris '+row+': Modul SUPPLIES tidak aktif untuk divisi ini.');
    }else{
     if(c.dailyOn)dailyRows.push({item_id:x.id,item_type:'material',qty:actual*factor});
     else if(!opTBlank(ws['F'+row]?.v))errors.push('STOCK baris '+row+': Daily SO tidak aktif untuk divisi ini.');
    }
   }
  });
  if(dailyTouched){
   if(!c.dailyOn)errors.push('Daily SO tidak aktif untuk divisi ini, tetapi kolom Stok Fisik ITEM diisi.');
   const expected=c.dailyMaterials.map(x=>String(x.id)),got=dailyRows.filter(x=>x.item_type==='material').map(x=>String(x.item_id));
   if(!opTSameSet(got,expected))errors.push('Daily SO: jika Stok Fisik ITEM diisi, isi semua ITEM aktif non-Supplies termasuk angka 0.');
  }
  if(supplyTouched){
   if(!c.suppliesOn)errors.push('Modul SUPPLIES tidak aktif untuk divisi ini.');
   const expected=c.supplies.map(x=>String(x.id)),got=supplyRows.map(x=>String(x.item_id));
   if(!opTSameSet(got,expected))errors.push('SUPPLIES: jika Stok Fisik supplies diisi, isi semua supplies aktif termasuk angka 0.');
   p.supplies=supplyRows;
  }
  if(dailyTouched)p.daily_so=dailyRows;
  mapped.filter(x=>x.section==='WIP').forEach(x=>{
   const r=x.row,w=(CG.wips||[]).find(y=>String(y.id)===x.id);
   const name=String(ws['A'+r]?.v??'').trim(),unit=String(ws['B'+r]?.v??'').trim();
   if(!w||w.active!==true||String(w.division_id)!==String(CL.division)||name!==x.name||unit!==String(w.yield_unit||'UNIT')){errors.push('WIP baris '+r+': WIP atau satuan hasil tidak cocok dengan master.');return}
    const produced=opTNum(ws['C'+r]?.v),actual=opTBlank(ws['D'+r]?.v)?0:opTNum(ws['D'+r]?.v),yieldQty=Number(w.yield_qty||0);
   if(!opTBlank(ws['C'+r]?.v)){if(produced===null||!Number.isFinite(produced)||produced<0)errors.push('WIP baris '+r+': Produksi Aktual harus angka 0 atau lebih.');else if(produced>0){if(!(yieldQty>0))errors.push('WIP baris '+r+': hasil per batch di master tidak valid.');else{const batches=produced/yieldQty,round=Math.round(batches);if(Math.abs(batches-round)>1e-8)errors.push('WIP baris '+r+': Produksi Aktual harus kelipatan '+yieldQty+' '+unit+' per batch.');else p.production.push({wip_id:x.id,batches:round})}}}
   if(!opTBlank(ws['D'+r]?.v)||(dailyPhysicalTouched&&c.dailyOn)){if(actual===null||!Number.isFinite(actual)||actual<0)errors.push('WIP baris '+r+': Stok Fisik harus angka 0 atau lebih.');else if(c.dailyOn)dailyRows.push({item_id:x.id,item_type:'wip',qty:actual});else if(!opTBlank(ws['D'+r]?.v))errors.push('WIP baris '+r+': Daily SO tidak aktif untuk divisi ini.')}
  });
  if(dailyTouched){
   const expected=c.dailyMaterials.map(x=>String(x.id)).concat(c.dailyWips.map(x=>String(x.id)));
   const got=dailyRows.map(x=>String(x.item_id));
   if(!c.dailyOn)errors.push('Daily SO tidak aktif untuk divisi ini, tetapi kolom Stok Fisik diisi.');
   if(!opTSameSet(got,expected))errors.push('Daily SO: jika Stok Fisik WIP diisi, isi semua ITEM dan WIP aktif dalam daftar Daily SO, termasuk angka 0.');
   p.daily_so=dailyRows;
  }
  mapped.filter(x=>x.section==='SALES').forEach(x=>{
   const r=x.row,menu=(CG.menus||[]).find(y=>String(y.id)===x.id),name=String(ws['A'+r]?.v??'').trim(),q=opTNum(ws['B'+r]?.v),price=opTNum(ws['C'+r]?.v);
   if(!menu||menu.active!==true||String(menu.division_id)!==String(CL.division)||name!==x.name){errors.push('SALES baris '+r+': menu berubah, tidak aktif, atau bukan milik divisi ini.');return}
   if(!opTBlank(ws['B'+r]?.v)){if(q===null||!Number.isFinite(q)||q<=0)errors.push('SALES baris '+r+': Qty Terjual harus lebih dari 0.');else if(price!==null&&(!Number.isFinite(price)||price<0))errors.push('SALES baris '+r+': Harga Jual harus 0 atau lebih.');else p.sales.push({menu_id:x.id,qty:q,selling_price:price===null?null:price})}
   else if(!opTBlank(ws['C'+r]?.v))errors.push('SALES baris '+r+': Harga Jual hanya boleh diisi jika Qty Terjual terisi.');
  });
  // Template Daily SO hanya memproses stok fisik ITEM dan WIP. Modul transaksi lain tidak diimpor dari file ini.
  if(p.daily_so.length>1000||p.sales.length>200||p.stock_in.length>1000||p.opening_wip.length>500||p.stock_out.length>1000||p.production.length>200||p.supplies.length>1000||p.stock_returns.length>1000)errors.push('Jumlah baris transaksi melebihi batas impor salah satu bagian.');
  if(p.sales.length&&!c.salesOn)errors.push('Modul Penjualan Menu tidak aktif untuk divisi ini.');
  if(p.production.length&&!c.productionOn)errors.push('Modul Produksi WIP tidak aktif untuk divisi ini.');
  if(p.supplies.length&&!c.suppliesOn)errors.push('Modul SUPPLIES tidak aktif untuk divisi ini.');
  if(p.daily_so.length&&!c.dailyOn)errors.push('Modul Daily SO tidak aktif untuk divisi ini.');
  if(p.stock_out.some(x=>x.item_type==='wip')&&!c.wipOn)errors.push('Modul WIP tidak aktif untuk divisi ini.');
  errors.push(...opTPermissions(p),...opTConflictErrors(p,c));
  const counts=[
   ['Daily SO — Barang',p.daily_so.filter(x=>x.item_type==='material').length,'stok fisik akhir barang aktif'],
   ['Daily SO — WIP',p.daily_so.filter(x=>x.item_type==='wip').length,'stok fisik akhir WIP aktif']
  ];
  CL.operationalTemplateDraft={templateId:meta.TEMPLATE_ID||'',payload:p,errors:[...new Set(errors)],counts,fileName:file.name,serverError:'',busy:false};opTRenderPreview();
 }catch(e){CL.operationalTemplateDraft={templateId:'',payload:null,errors:['Gagal membaca template Daily SO: '+String(e?.message||e)],counts:[],fileName:file.name,serverError:'',busy:false};opTRenderPreview()}
}
function opTRenderPreview(){
 const d=CL.operationalTemplateDraft;if(!d)return;
 const errors=d.errors||[],summary=(d.counts||[]).map(x=>'<tr><td style="padding:7px;border-bottom:1px solid var(--line)">'+esc(x[0])+'</td><td style="padding:7px;text-align:right;border-bottom:1px solid var(--line)"><b>'+x[1]+'</b></td><td style="padding:7px;color:var(--mu);border-bottom:1px solid var(--line)">'+esc(x[2])+'</td></tr>').join('');
 const errHtml=errors.length?'<div class="cl-callout" style="border-color:#c55"><b>Belum bisa diimpor ('+errors.length+' masalah)</b><ul style="margin:8px 0 0;padding-left:20px">'+errors.slice(0,25).map(x=>'<li>'+esc(x)+'</li>').join('')+(errors.length>25?'<li>Dan '+(errors.length-25)+' masalah lainnya.</li>':'')+'</ul></div>':'<div class="cl-callout"><b>Validasi awal lolos</b><p>Belum ada data disimpan. Supabase akan memvalidasi ulang semua bagian secara atomik.</p></div>';
 const server=d.serverError?'<div class="cl-callout"><b>Impor tidak disimpan</b><p>'+esc(d.serverError)+'</p></div>':'';
 modal('<h3>Preview Import Daily SO</h3><p class="mu"><b>File:</b> '+esc(d.fileName||'File Excel')+'<br><b>Divisi:</b> '+esc(clDivision(CL.division)?.name||'Divisi')+'<br><b>Tanggal:</b> '+esc(CL.date)+'<br>Hanya data Daily SO ITEM dan WIP yang akan diimpor. Belum ada data disimpan sebelum konfirmasi.</p><div style="overflow:auto"><table style="width:100%;border-collapse:collapse"><thead><tr><th style="text-align:left;padding:7px">Bagian</th><th style="text-align:right;padding:7px">Baris</th><th style="text-align:left;padding:7px">Keterangan</th></tr></thead><tbody>'+summary+'</tbody></table></div>'+errHtml+server+'<div class="btns" style="margin-top:14px"><button type="button" class="btn s" onclick="window.__clOpenOperationalTemplate()">Kembali</button><button type="button" class="btn" '+(errors.length||d.busy||!d.payload?'disabled':'')+' onclick="window.__clConfirmOperationalImport()">'+(d.busy?'Memproses…':'Konfirmasi & Import Daily SO')+'</button></div>');
}
function opTFriendlyError(e){
 const m=String(e?.message||e||'Gagal import.'),u=m.toUpperCase(),map=[
 ['BARAPP_TEMPLATE_CLOSING_LOCKED','Tanggal closing sudah disetujui atau memerlukan rekonsiliasi. Tidak ada data disimpan.'],
 ['BARAPP_TEMPLATE_EXISTING_DAILY_SO','Daily SO tanggal ini sudah ada. Kosongkan bagian stok fisik ITEM/WIP.'],
 ['BARAPP_TEMPLATE_EXISTING_SUPPLIES','Daily SO Supplies tanggal ini sudah ada. Kosongkan stok fisik SUPPLIES.'],
 ['BARAPP_TEMPLATE_EXISTING_SALES','Sudah ada Penjualan Menu pada tanggal ini. Kosongkan bagian Qty Terjual.'],
 ['BARAPP_TEMPLATE_EXISTING_STOCK_IN','Sudah ada Barang Masuk pada tanggal ini. Kosongkan bagian Barang Masuk.'],
 ['BARAPP_TEMPLATE_EXISTING_EXPENSES','Sudah ada Pengeluaran pada tanggal ini. Kosongkan bagian Pengeluaran.'],
 ['BARAPP_TEMPLATE_EXISTING_PRODUCTION','Sudah ada Produksi WIP pada tanggal ini. Kosongkan bagian Produksi Aktual.'],
 ['BARAPP_TEMPLATE_INVALID_UNIT','Satuan tidak cocok dengan konversi Master Barang. Unduh template terbaru.'],
 ['BARAPP_TEMPLATE_TARGET_CLOSING_LOCKED','Divisi tujuan Move sudah closing final pada tanggal ini.'],
 ['BARAPP_TEMPLATE_INVALID_MOVE_TARGET','Tujuan Move tidak valid atau di luar outlet yang sama.'],
 ['BARAPP_TEMPLATE_DUPLICATE_EXPENSE_ITEM','Item dan kategori Pengeluaran sama muncul lebih dari sekali. Gabungkan kuantitas.'],
 ['BARAPP_TEMPLATE_DAILY_SO_FORBIDDEN','Akun tidak memiliki izin untuk menyimpan Daily SO.'],
 ['BARAPP_TEMPLATE_SALES_FORBIDDEN','Akun tidak memiliki izin untuk input Penjualan.'],
 ['BARAPP_TEMPLATE_PRODUCTION_FORBIDDEN','Akun tidak memiliki izin untuk input Produksi WIP.'],
 ['BARAPP_TEMPLATE_SUPPLIES_FORBIDDEN','Akun tidak memiliki izin untuk menyimpan SUPPLIES.'],
 ['BARAPP_TEMPLATE_STOCK_IN_FORBIDDEN','Akun tidak memiliki izin Barang Masuk.'],
 ['BARAPP_TEMPLATE_EXPENSES_FORBIDDEN','Akun tidak memiliki izin Pengeluaran.'],
 ['BARAPP_TEMPLATE_EMPTY_IMPORT','Tidak ada nilai transaksi yang diisi.'],
 ['BARAPP_TEMPLATE_TOO_MANY_ROWS','Jumlah baris melebihi batas impor salah satu bagian.'],
 ['BARAPP_TEMPLATE_INVALID_DATE','Tanggal target tidak valid atau berada di masa depan.'],
 ['BARAPP_TEMPLATE_INVALID_PAYLOAD','Payload template tidak valid. Unduh ulang template.'],
 ['BARAPP_TEMPLATE_INVALID_SUPPLIES_ROW','Baris SUPPLIES tidak valid. Periksa jumlah aktual.'],
 ['COGS_SO_ALREADY_SUBMITTED','Daily SO sudah tersimpan. Impor dibatalkan seluruhnya.'],
 ['COGS_SO_MUST_COUNT_ALL_ITEMS','Daftar item Daily SO tidak lengkap. Impor dibatalkan seluruhnya.'],
 ['SUPPLIES_SO_ALREADY_SUBMITTED','Daily SO SUPPLIES sudah tersimpan. Impor dibatalkan seluruhnya.']
 ];
 for(const [key,msg] of map)if(u.includes(key))return msg;
 if(/UNIQUE|DUPLICATE KEY/.test(u))return 'File ini atau payload yang sama sudah pernah berhasil diimpor. Tidak ada perubahan baru.';
 if(/42501|FORBIDDEN|ACCESS_DENIED|PERMISSION_DENIED/.test(u))return 'Akses tidak mencukupi untuk salah satu modul. Periksa izin akun dan modul divisi.';
 if(/COGS_|SUPPLIES_|INVALID_STOCK|INVALID_|ITEM_NOT_FOUND/.test(u))return 'Validasi database gagal: '+m+'. Seluruh perubahan dibatalkan.';
 return m;
}
async function opTConfirmImport(){
 const d=CL.operationalTemplateDraft;if(!d||!d.payload||d.errors?.length||CL.busy||d.busy)return;
 if(CL.period&&['approved','needs_reconciliation'].includes(CL.period.status))return toast('Tanggal closing sudah final atau terkunci.','warn');
 if(!confirm('Import data Daily SO untuk '+(clDivision(CL.division)?.name||'divisi')+' tanggal '+CL.date+'? Hanya Stock Opname yang akan disimpan.'))return;
 d.busy=true;CL.busy='operational-template-import';opTRenderPreview();
 try{
  const {data,error}=await sb().rpc('barapp_closing_import_operational_template_v2',{p_division_id:CL.division,p_target_date:CL.date,p_template_id:d.templateId,p_payload:d.payload});
  if(error)throw error;
  const targetDivision=String(CL.division),targetDate=String(CL.date),z=data?.summary||{};
  CL.operationalTemplateDraft=null;CL.busy='';CL.ready=false;CG.ready=false;INV.ready=false;
  let refreshed=false;
  try{
   await Promise.all([cgLoad(false),invLoad(false)]);
   if(!CG.ready||!INV.ready)throw new Error(CG.err||INV.err||'Data berhasil disimpan, tetapi cache operasional belum bisa dimuat ulang.');
   if(typeof OPS!=='undefined'&&String(OPS.division)===targetDivision&&String(OPS.date||opsDate())===targetDate){
    OPS.positionLoadedFor='';OPS.positionError='';OPS.positionErrorFor='';OPS.position=[];
    if(pg==='cogs_daily_so'){
     await opsLoadPosition(false,true);
     if(OPS.positionErrorFor===targetDivision+'|'+targetDate)throw new Error(OPS.positionError||'Gagal memperbarui saldo Daily SO.');
    }
   }
   if(pg==='cogs_closing'){CL.ready=false;await load(false);R();}
   else if(pg==='cogs_daily_so')R();
   refreshed=true;
  }catch(refreshError){
   if(pg==='cogs_closing'){CL.ready=false;await load(false);R();}
   else if(pg==='cogs_daily_so')R();
   console.warn('Operational import succeeded but a screen refresh failed:',refreshError);
  }
  if(refreshed)toast('Import berhasil dan data layar sudah diperbarui. Stock opname '+(z.daily_so||0)+', Barang Masuk '+(z.stock_in||0)+', Pengeluaran '+(z.stock_out||0)+', Sales '+(z.sales||0)+', Produksi WIP '+(z.production||0)+', Supplies '+(z.supplies||0)+'.','ok');
  else toast('Import berhasil disimpan, tetapi tampilan belum berhasil diperbarui. Tekan Muat saldo atau buka ulang halaman terkait.','warn');
 }catch(e){d.busy=false;CL.busy='';d.serverError=opTFriendlyError(e);opTRenderPreview()}
}
window.__clOpenOperationalTemplate=opTOpenDialog;
window.__clOpenOperationalTemplateFromDailySO=opTOpenFromDailySO;
window.__clDownloadOperationalTemplate=opTDownload;
window.__clPreviewOperationalImport=opTPreview;
window.__clConfirmOperationalImport=opTConfirmImport;

function view(){
 if(!clCanAccess())return '<div class="card empty">Approval Closing hanya tersedia untuk Developer dan Admin Divisi.</div>';
 init();
 if(CL.loading||!CG.ready||!INV.ready)return '<div class="card"><h3>Memuat Approval Closing…</h3><p class="mu">Mengambil transaksi dan status validasi dari Supabase.</p></div>';
 if(CL.error)return '<div class="card"><h3>Approval Closing</h3><p class="mu">'+esc(CL.error)+'</p><button class="btn" onclick="window.__clReload()">Muat ulang</button></div>';
 const divs=INV.divs.length?INV.divs:CG.divs,divName=divs.find(d=>String(d.id)===String(CL.division))?.name||'Divisi',approved=CL.period?.status==='approved';
 const activeModules=clModulesForDivision(CL.division);
 const ready=activeModules.every(m=>{const x=state(m);return x.saved&&x.fresh&&['confirmed','confirmed_empty'].includes(x.saved.status)})&&(!clModuleOn(CL.division,'cogs_daily_so')||count('daily_so',CL.division,CL.date)>0);
 const label=approved?'Approved':CL.period?.status==='needs_reconciliation'?'Perlu rekonsiliasi':ready?'Siap approval':'Draft';
 const cards=activeModules.map(m=>{
  const x=state(m),n=count(m.key,CL.division,CL.date),empty=n===0,tone=x.saved&&x.fresh?'good':x.saved?'bad':'warn';
  const txt=x.saved&&x.fresh?(x.saved.status==='confirmed_empty'?'Kosong dikonfirmasi':'Terkonfirmasi'):x.saved?'Data berubah':empty?'Belum ada data':'Belum dikonfirmasi';
  let act=approved?'<span class="cogs-pill">Terkunci</span>':x.saved&&x.fresh?'<button class="btn s x" disabled aria-label="Sudah dikonfirmasi">✓ Sudah dikonfirmasi</button>':m.key==='daily_so'&&empty?'<button class="btn s x" onclick="go(\'cogs_daily_so\')">Isi Daily SO</button>':'<button class="btn s x" '+(CL.busy?'disabled':'')+' onclick="window.__clConfirm(\''+m.key+'\')">'+(CL.busy===m.key?'Memproses…':x.saved&&!x.fresh?'Konfirmasi ulang':empty?'Konfirmasi kosong':'Konfirmasi data')+'</button>';
  return '<div class="card cl-module"><div class="cl-module-head"><div class="cl-status '+tone+'">'+(x.saved&&x.fresh?'✓':x.saved?'!':empty?'○':'•')+'</div><div class="cl-module-info"><b>'+esc(m.name)+'</b><small>'+esc(m.desc)+'</small><span class="cogs-pill '+(tone==='bad'?'bad':'')+'">'+esc(txt)+'</span></div></div><div class="cl-module-foot"><span class="mu">'+n+' transaksi/rekaman</span><div class="cl-actions"><button class="btn o x" onclick="go(\''+m.page+'\')">Detail</button>'+act+'</div></div></div>';
 }).join('');
 const history=CL.history.map(h=>'<tr><td><b>'+esc(h.closing_date)+'</b></td><td><span class="cogs-pill '+(h.status==='approved'?'':'bad')+'">'+esc(h.status==='approved'?'Approved':h.status==='needs_reconciliation'?'Perlu rekonsiliasi':h.status)+'</span></td><td>'+(h.approved_at?esc(new Date(h.approved_at).toLocaleString('id-ID')):'—')+'</td><td><div class="cl-actions"><button class="btn o x cl-history-detail" style="display:inline-flex!important;visibility:visible!important;opacity:1!important;align-items:center;justify-content:center;min-width:68px;min-height:34px;position:relative;z-index:2" type="button" onclick="window.__clShowHistoryDetail(\''+esc(h.closing_date)+'\')">Detail</button><button class="ibtn cl-download-row" type="button" onclick="window.__clDownloadClosingExcelForDate(\''+esc(h.closing_date)+'\')" aria-label="Unduh rekap '+esc(h.closing_date)+'" title="Unduh rekap tanggal ini" style="width:34px;height:34px;min-width:34px;flex:none"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v11"/><path d="m7 9 5 5 5-5"/><path d="M5 16v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3"/></svg></button></div></td></tr>').join('');
 return '<div class="cogs-wrap"><style>.cl-top-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap;min-width:0;max-width:100%}.cl-top-actions .btn{white-space:normal;min-width:0;max-width:100%;text-align:center;line-height:1.25;overflow-wrap:anywhere}.cl-filter{display:grid;grid-template-columns:1fr 1fr;gap:10px}.cl-filter label{min-width:0}.cl-module{padding:14px;margin-bottom:10px}.cl-module-head{display:flex;align-items:flex-start;gap:12px}.cl-status{width:34px;height:34px;display:grid;place-items:center;flex:none;border-radius:11px;font-size:18px;font-weight:800;background:var(--in);border:1px solid var(--line)}.cl-status.good{color:#167443;background:#e0f4e7;border-color:#8bc9a0}.cl-status.warn{color:#946200;background:#fff2c7;border-color:#e3c45e}.cl-status.bad{color:#bd5549;background:#fde8e5;border-color:#e5a49c}.cl-actions .btn[disabled]{opacity:.78;cursor:not-allowed;background:#e0f4e7;color:#167443;border-color:#8bc9a0}.cl-module-info{min-width:0;flex:1;display:grid;gap:5px}.cl-module-info b{font-size:15px}.cl-module-info small{color:var(--mu);line-height:1.4}.cl-module-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;border-top:1px solid var(--line);padding-top:10px;margin-top:12px}.cl-actions{display:flex;gap:6px;flex-wrap:wrap}.cl-summary{display:grid;grid-template-columns:1fr 1fr;gap:10px}.cl-summary>div{background:var(--in);border:1px solid var(--line);border-radius:14px;padding:12px}.cl-summary small{display:block;color:var(--mu)}.cl-summary b{display:block;font-size:17px;margin-top:4px}.cl-callout{border:1px solid var(--line);border-radius:14px;padding:12px;background:var(--in);margin:12px 0}.cl-callout p{margin:4px 0 0;color:var(--mu);font-size:12px}@media(max-width:520px){.cogs-top:has(>.cl-top-actions){align-items:stretch;flex-direction:column}.cl-top-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));width:100%;gap:8px;justify-content:stretch;box-sizing:border-box}.cl-top-actions .btn{display:flex;align-items:center;justify-content:center;width:100%;min-width:0;min-height:44px;padding:10px 8px;white-space:normal;overflow-wrap:anywhere;word-break:normal;flex:none}.cl-top-actions .btn:last-child{grid-column:1/-1}.cl-filter{grid-template-columns:1fr}.cl-module-foot{align-items:flex-start}.cl-actions{width:100%}.cl-actions .btn{flex:1}}</style><div class="card"><div class="cogs-top"><div><h3>Approval Closing</h3><p class="mu">Konfirmasi modul operasional yang aktif untuk divisi ini, rekonsiliasi data, lalu setujui snapshot closing harian.</p></div><div class="cl-top-actions"><button class="btn s" onclick="window.__clReload()">Muat ulang</button></div></div><div class="cl-filter"><label>Divisi<select onchange="window.__clFilter(\'division\',this.value)">'+divs.map(d=>'<option value="'+d.id+'" '+(String(d.id)===String(CL.division)?'selected':'')+'>'+esc(d.name)+'</option>').join('')+'</select></label><label>Tanggal closing<input type="date" max="'+clToday()+'" value="'+esc(CL.date)+'" onchange="window.__clFilter(\'date\',this.value)"></label></div><div class="cl-summary"><div><small>Divisi / periode</small><b>'+esc(divName)+'</b><small>'+esc(CL.date)+'</small></div><div><small>Status closing</small><b>'+esc(label)+'</b><small>'+activeModules.filter(m=>{const x=state(m);return x.saved&&x.fresh}).length+' / '+activeModules.length+' modul terkonfirmasi</small></div></div><div class="cl-callout"><b>Aturan closing</b><p>Modul kosong harus dikonfirmasi. Data yang berubah setelah konfirmasi wajib dikonfirmasi ulang. Approval memvalidasi snapshot modul aktif dan menghitung ulang saldo Daily SO bila modul itu aktif.</p></div></div><div class="card"><h3>Checklist modul</h3>'+cards+'</div><div class="card"><h3>Ringkasan sebelum approval</h3><p class="mu">Semua modul aktif harus dikonfirmasi dengan snapshot yang masih sama.</p><div class="cl-summary"><div><small>Rekaman Daily SO</small><b>'+(clModuleOn(CL.division,'cogs_daily_so')?count('daily_so',CL.division,CL.date):'Tidak digunakan')+'</b></div><div><small>Validasi</small><b>'+(approved?'Final':ready?'Siap diperiksa':'Belum lengkap')+'</b></div></div><div class="btns" style="margin-top:14px"><button class="btn s" onclick="window.__clReload()" '+(CL.busy?'disabled':'')+'>Validasi & muat ulang</button><button class="btn" onclick="window.__clApprove()" '+(!ready||approved||CL.busy?'disabled':'')+'>'+(CL.busy==='approve'?'Memproses…':approved?'Closing Approved':'Approval Closing')+'</button></div>'+(approved?'<p class="mu">Disetujui pada '+esc(new Date(CL.period.approved_at).toLocaleString('id-ID'))+'. Perubahan transaksi berikutnya harus melalui rekonsiliasi.</p>':'')+'</div><div class="card"><div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px"><h3 style="margin:0">Riwayat closing divisi</h3></div><div class="cogs-scroll"><table class="cogs-table"><thead><tr><th>Tanggal</th><th>Status</th><th>Waktu approval</th><th>Detail / Unduh</th></tr></thead><tbody>'+(history||'<tr><td colspan="4" class="mu">Belum ada riwayat closing.</td></tr>')+'</tbody></table></div></div></div>';
}
// Dashboard Operasional sengaja dibiarkan kosong untuk pembangunan ulang; notifikasi utama tetap ditampilkan oleh shell aplikasi.
window.__clShowHistoryDetail=async(date)=>{
 if(!clCanAccess())return toast('Akses ditolak.','warn');
 const h=CL.history.find(x=>String(x.closing_date)===String(date));if(!h)return toast('Riwayat closing tidak ditemukan.','warn');
 const status=h.status==='approved'?'Approved':h.status==='needs_reconciliation'?'Perlu rekonsiliasi':h.status;
 modal('<div class="cl-history-modal"><div class="cl-history-modal-head"><h3 style="margin:0">LAPORAN DAILY SO</h3><p class="mu" style="margin:6px 0 14px">Tanggal: <b>'+esc(date)+'</b> · Divisi: <b id="cl-history-division">—</b></p><p class="mu">Status closing: <b>'+esc(status)+'</b> · Waktu approval: '+(h.approved_at?esc(new Date(h.approved_at).toLocaleString('id-ID')):'—')+'</p></div><div class="cl-history-modal-table"><div id="cl-history-detail-body"><p class="mu">Memuat laporan Daily SO…</p></div></div><div class="btns cl-history-modal-actions"><button class="btn s" onclick="window.__clDownloadClosingExcelForDate(' + "'"+esc(date)+"'" + ')">Unduh Excel</button><button class="btn" onclick="closeM()">Tutup</button></div></div>');
 const host=document.getElementById('cl-history-detail-body');if(!host)return;
 try{
  if(typeof cgLoad==='function')await cgLoad(true);
  if(typeof invLoad==='function')await invLoad(true);
  const division=h.division_id||CL.division;
  const divName=(typeof opsDivName==='function'?opsDivName(division):(CL.divisions||[]).find(x=>String(x.id)===String(division))?.name)||'—';
  const dh=document.getElementById('cl-history-division');if(dh)dh.textContent=divName;
  const so=(CG.dailySO||[]).find(x=>String(x.division_id)===String(division)&&String(x.so_date)===String(date)&&x.status==='submitted');
  if(!so){host.innerHTML='<p class="mu">Tidak ditemukan laporan Daily SO tersimpan untuk divisi dan tanggal ini. Data tidak diganti dengan angka hari ini.</p>';return;}
  const lines=(CG.dailySOLines||[]).filter(x=>String(x.so_id)===String(so.id));
  const sum=(xs,fn)=>xs.reduce((a,x)=>a+Number(fn(x)||0),0);
  const money=n=>'Rp '+Number(n||0).toLocaleString('id-ID',{minimumFractionDigits:2,maximumFractionDigits:2});
  const qty=n=>Number(n||0).toLocaleString('id-ID',{maximumFractionDigits:4});
  const rows=lines.map(l=>{
   const type=l.component_type==='material'?'material':'wip',id=type==='material'?l.item_id:l.component_wip_id;
   const item=type==='material'?(typeof cgItem==='function'?cgItem(id):null):(typeof opsWip==='function'?opsWip(id):null);
   const incoming=type==='material'
    ?sum((INV.ins||[]).filter(x=>String(x.item_id)===String(id)&&String(x.division_id)===String(division)&&x.status==='posted'&&String(x.received_at)===String(date)),x=>x.qty_base)-sum((INV.rets||[]).filter(x=>String(x.item_id)===String(id)&&String(x.division_id)===String(division)&&x.status==='posted'&&String(x.returned_at)===String(date)),x=>x.qty_base)+sum((INV.stockOut||[]).filter(x=>String(x.target_item_id)===String(id)&&String(x.to_division_id)===String(division)&&x.category==='Move'&&x.status==='posted'&&String(x.out_date)===String(date)),x=>x.qty_base)
    :sum((CG.productions||[]).filter(x=>String(x.wip_id)===String(id)&&String(x.division_id)===String(division)&&x.status==='posted'&&String(x.produced_at)===String(date)),x=>x.produced_qty);
   const usedOut=sum((INV.stockOut||[]).filter(x=>String(x.item_id)===String(id)&&String(x.from_division_id)===String(division)&&x.status==='posted'&&String(x.out_date)===String(date)),x=>x.qty_base);
   const sales=sum((CG.saleLines||[]).filter(x=>x.component_type===type&&String(type==='material'?x.item_id:x.component_wip_id)===String(id)&&(CG.sales||[]).some(z=>String(z.id)===String(x.sale_id)&&String(z.division_id)===String(division)&&z.status==='posted'&&String(z.sold_at)===String(date))),x=>x.qty_base);
   const production=sum((CG.productionInputs||[]).filter(x=>x.component_type===type&&String(type==='material'?x.item_id:x.component_wip_id)===String(id)&&(CG.productions||[]).some(z=>String(z.id)===String(x.batch_id)&&String(z.division_id)===String(division)&&z.status==='posted'&&String(z.produced_at)===String(date))),x=>x.qty_base);
   let price=l.unit_cost_snapshot==null?null:Number(l.unit_cost_snapshot);
   if(price==null){if(type==='material'){const p=typeof cgPrice==='function'?cgPrice(item):null;price=p?.value??0}else{const p=typeof cgWipCost==='function'?cgWipCost(id,[]):null;price=p?.ok?p.unitCost:0}}
   const variance=Number(l.variance_qty_base||0);
   const suppliesSo=(INV.suppliesSO||[]).find(z=>String(z.division_id)===String(division)&&String(z.so_date)===String(date)&&z.status==='submitted');
   const supplyLine=(INV.suppliesSOLines||[]).find(q=>String(q.item_id)===String(id)&&String(q.so_id)===String(suppliesSo?.id));
   const suppliesUsed=supplyLine?Math.max(0,Number(supplyLine.expected_qty_base||0)-Number(supplyLine.counted_qty_base||0)):0;
   return [l.component_name_snapshot||item?.name||'Item',incoming,sales,usedOut,suppliesUsed,production,Number(l.counted_qty_base||0),Number(l.expected_qty_base||0),variance,variance*Number(price||0)];
  });
  const heads=['ITEM','BARANG MASUK','TERPAKAI SALES','TERPAKAI PENGELUARAN','SUPPLIES','TERPAKAI PRODUKSI WIP','STOK AKHIR AKTUAL','STOK SISTEM','SELISIH QTY','NILAI RP SELISIH'];
  const total=rows.reduce((a,r)=>a+Number(r[9]||0),0);
  const table='<div class="cl-so-table-wrap"><table class="cl-so-table"><thead><tr>'+heads.map((x,j)=>'<th class="'+(j===0?'cl-so-item':'')+'">'+esc(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map((v,j)=>'<td class="'+(j===0?'cl-so-item':j===8&&Number(v)!==0?(Number(v)<0?'cl-so-neg':'cl-so-pos'):'')+'">'+esc(j===9?money(v):typeof v==='number'?qty(v):v)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div><div class="cl-so-total-summary"><span>TOTAL SELISIH</span><strong>'+esc(money(total))+'</strong></div>';
  if(host.isConnected)host.innerHTML='<style>.cl-history-modal{display:flex;flex-direction:column;gap:10px;min-width:0;width:100%;box-sizing:border-box}.cl-history-modal-head{flex:0 0 auto;position:relative;z-index:2;background:#fffdfa}.cl-history-modal-table{min-width:0;width:100%;max-width:100%;overflow:hidden;position:relative;isolation:isolate}.cl-history-modal-table #cl-history-detail-body{min-width:0;max-width:100%;overflow:hidden}.cl-history-modal-actions{position:relative;z-index:3;background:#fffdfa;padding-top:8px;border-top:1px solid #d7dfda;flex:0 0 auto}.cl-so-table-wrap{display:block;width:100%;max-width:100%;overflow:auto;border:1px solid #38584b;border-radius:10px;isolation:isolate;position:relative;background:#fffdfa;max-height:52vh}.cl-so-table{border-collapse:separate;border-spacing:0;table-layout:auto;width:max-content;min-width:100%;font-size:12px;white-space:nowrap;color:#263a32;background:#fffdfa}.cl-so-table th,.cl-so-table td{box-sizing:border-box;padding:9px 10px;border:0;border-bottom:1px solid #cbd8d0;border-right:1px solid #cbd8d0;text-align:right;vertical-align:middle;background:#fffdfa!important;color:#263a32!important;line-height:1.45;position:static;opacity:1}.cl-so-table thead{position:relative;z-index:6}.cl-so-table th{position:sticky;top:0;z-index:6;background:#e6eee9!important;color:#21392f!important;font-weight:700;border-bottom:2px solid #38584b;isolation:isolate}.cl-so-table th:first-child,.cl-so-table td:first-child{text-align:left}.cl-so-table .cl-so-item{position:sticky;left:0;min-width:165px;max-width:220px;overflow:hidden;text-overflow:ellipsis;background:#fffdfa!important;color:#263a32!important;z-index:4;box-shadow:1px 0 0 #cbd8d0!important}.cl-so-table thead .cl-so-item{position:sticky;top:0;left:0;z-index:10;background:#dce9e2!important;color:#21392f!important;border-right:1px solid #aebfb5;box-shadow:1px 0 0 #aebfb5!important}.cl-so-table .cl-so-neg{color:#bd3737!important;font-weight:700}.cl-so-table .cl-so-pos{color:#167443!important;font-weight:700}.cl-so-total-summary{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-top:8px;padding:14px 16px;border:1px solid #38584b;border-top:3px solid #38584b;border-radius:10px;background:#e5eee9!important;color:#173e32!important;font-weight:800;font-size:14px;box-sizing:border-box;width:100%;min-width:0;position:relative;z-index:1}.cl-so-total-summary strong{color:#173e32!important;font-size:16px;font-weight:900;white-space:nowrap;font-variant-numeric:tabular-nums}@media(max-width:600px){.cl-so-table{font-size:11px}.cl-so-table th,.cl-so-table td{padding:8px 9px}.cl-so-table .cl-so-item{min-width:155px;max-width:180px}.cl-so-total-summary{padding:12px;font-size:13px}}@media(prefers-color-scheme:dark){.cl-so-table-wrap{background:#fffdfa}.cl-so-table,.cl-so-table td{background:#fffdfa;color:#263a32}.cl-so-table th{background:#e6eee9;color:#21392f}.cl-so-table .cl-so-item{background:#fffdfa}.cl-so-table thead .cl-so-item{background:#dce9e2}.cl-so-total-summary{background:#243a31!important;color:#f2faf5!important}.cl-so-total-summary strong{color:#f2faf5!important}}</style>'+table;
 }catch(e){if(host.isConnected)host.innerHTML='<p class="mu">Laporan tidak berhasil dimuat: '+esc(clError(e))+'</p>'}
};
window.__clOpen=()=>{if(!clCanAccess())return toast('Approval Closing hanya tersedia untuk Developer dan Admin Divisi.','warn');go('cogs_closing')};
window.__clDownloadClosingExcelForDate=async(date)=>{
 if(window.__clDownloadingSO)return;
 if(!CL.division||!date)return toast('Divisi atau tanggal closing tidak tersedia.','warn');
 window.__clDownloadingSO=true;
 try{
  if(!window.XLSX)throw new Error('Modul Excel belum siap. Tunggu sebentar lalu coba lagi.');
  if(typeof cgLoad==='function'&&!CG.ready)await cgLoad(true);
  if(typeof invLoad==='function'&&!INV.ready)await invLoad(true);
  OPS.division=CL.division;OPS.soHistoryDate=date;OPS.date=date;
  if(typeof exportDailySOExcel!=='function')throw new Error('Fungsi ekspor Excel belum tersedia.');
  await exportDailySOExcel();
 }catch(e){toast(e.message||'Gagal mengunduh rekap '+date+'.','err')}
 finally{window.__clDownloadingSO=false;}
};
window.__clDownloadClosingExcel=async()=>{
 if(window.__clDownloadingSO)return;
 if(!CL.division||!CL.date)return toast('Pilih divisi dan tanggal closing terlebih dahulu.','warn');
 window.__clDownloadingSO=true;
 try{
  if(!window.XLSX)throw new Error('Modul Excel belum siap. Tunggu sebentar lalu coba lagi.');
  if(typeof cgLoad==='function'&&!CG.ready)await cgLoad(true);
  if(typeof invLoad==='function'&&!INV.ready)await invLoad(true);
  OPS.division=CL.division;OPS.soHistoryDate=CL.date;OPS.date=CL.date;
  if(typeof exportDailySOExcel!=='function')throw new Error('Fungsi ekspor Excel Daily SO belum tersedia.');
  await exportDailySOExcel();
 }catch(e){toast(e.message||'Gagal mengunduh Excel closing.','err')}
 finally{window.__clDownloadingSO=false;}
};
window.__clDownloadSO=async()=>{if(window.__clDownloadingSO)return;window.__clDownloadingSO=true;try{if(typeof cgLoad==='function'&&!CG.ready)await cgLoad(true);if(typeof invLoad==='function'&&!INV.ready)await invLoad(true);if(!OPS.division)OPS.division=CG.divs[0]?.id||INV.divs[0]?.id||'';if(!OPS.soHistoryDate)OPS.soHistoryDate=OPS.date||opsDate();if(typeof exportDailySOExcel!=='function')throw new Error('Fungsi ekspor Daily SO belum tersedia.');await exportDailySOExcel()}catch(e){toast(e.message||'Gagal menyiapkan Excel Daily SO.','err')}finally{window.__clDownloadingSO=false;}};
window.__clConfirm=confirmModule;window.__clApprove=approve;window.__clReload=()=>{CL.ready=false;return load(true)};window.__clFilter=filter;
window.__barappRegisterViews?.({cogs_closing:view});
})();