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

function clTemplateId(){try{if(window.crypto&&typeof window.crypto.randomUUID==='function')return window.crypto.randomUUID()}catch(e){}return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.random()*16|0;return(c==='x'?r:(r&3|8)).toString(16)})}
function clTemplateBlank(v){return v===null||v===undefined||String(v).trim()===''}
function clTemplateCategories(){
 const configured=window.__barappStockOutCategories;
 const values=Array.isArray(configured)?configured:['Move','Waste','QC','R&D','Kalibrasi','Lainnya'];
 return [...new Set(values.map(x=>String(x||'').trim()).filter(Boolean))];
}
function clTemplatePreferredUnit(item){
 // Normalize names by removing spaces/punctuation so aliases such as
 // "GINGGERALE", "GINGGER ALE", and "GINGER ALE" resolve consistently.
 const key=String(item?.name||'').toLocaleUpperCase().replace(/[^A-Z0-9]/g,'');
 const preferred={
  'SKM':'CAN',
  'SKMCOKLAT':'CAN',
  'GINGERALE':'CAN',
  'GINGGERALE':'CAN',
  'GALONAQUA':'GALON',
  'GALONVIT':'GALON',
  'ESBATUATLAS':'BALL',
  'COCONUTWATER':'BOTOL/PACK',
  'RON88':'BOTOL/PACK'
 }[key];
 const baseUnit=String(item?.base_unit||'UNIT');
 if(!preferred)return {unit:baseUnit,requested:'',missing:false};
 const conversions=Array.isArray(item?.conversions)?item.conversions:[];
 const match=conversions.find(cv=>String(cv.unit||'').trim().toLocaleLowerCase()===preferred.toLocaleLowerCase()&&Number(cv.factor)>0);
 return match?{unit:String(match.unit).trim(),requested:preferred,missing:false}:{unit:baseUnit,requested:preferred,missing:true};
}
function clTemplateDateValue(v){if(v instanceof Date&&!Number.isNaN(v.getTime()))return v.toISOString().slice(0,10);if(typeof v==='number'&&Number.isFinite(v)&&v>=1&&v<100000){const d=new Date(Date.UTC(1899,11,30)+Math.round(v)*86400000);if(!Number.isNaN(d.getTime()))return d.toISOString().slice(0,10)}const s=String(v??'').trim();if(/^\d{4}-\d{2}-\d{2}$/.test(s))return s;return s}
function clTemplateNumber(v){if(typeof v==='number')return Number.isFinite(v)?v:NaN;if(clTemplateBlank(v))return null;const n=Number(String(v).trim().replace(/\s/g,'').replace(',','.'));return Number.isFinite(n)?n:NaN}
function clTemplateSameSet(actual,expected){if(actual.length!==expected.length)return false;const a=new Set(actual),e=new Set(expected);return a.size===actual.length&&e.size===expected.length&&actual.every(x=>e.has(x))}
function clTemplateCatalog(){
 const div=String(CL.division),date=String(CL.date),ii=(INV.items||[]).filter(x=>String(x.division_id)===div&&x.active===true).sort((a,b)=>invAlpha(a.name,b.name));
 const materials=ii.filter(x=>!x.is_supply),supplies=ii.filter(x=>x.is_supply===true&&String(x.created_at||'0000-01-01').slice(0,10)<=date),wips=(CG.wips||[]).filter(x=>String(x.division_id)===div&&x.active===true).sort((a,b)=>invAlpha(a.name,b.name)),menus=(CG.menus||[]).filter(x=>String(x.division_id)===div&&x.active===true).sort((a,b)=>invAlpha(a.name,b.name));
 const wd=clModuleOn(div,'cogs_wip'),sales=clModuleOn(div,'cogs_sales'),production=clModuleOn(div,'cogs_production'),supply=clModuleOn(div,'supplies'),daily=clModuleOn(div,'cogs_daily_so'),row=(id,type,name,unit)=>({id:String(id),type:type,name:String(name||''),unit:String(unit||'UNIT')});
 const dailyUnit=item=>({unit:String(item.base_unit||'UNIT'),factor:1});
 return {
  daily:daily?materials.map(x=>Object.assign(row(x.id,'material',x.name,dailyUnit(x).unit),{unitFactor:1,unitOptions:(Array.isArray(x.conversions)?x.conversions:[]).filter(cv=>String(cv.unit||'').trim()&&Number(cv.factor)>0).map(cv=>({unit:String(cv.unit),factor:Number(cv.factor)}))})).concat(wd?wips.map(x=>row(x.id,'wip',x.name,x.yield_unit)):[]):[],
  sales:sales?menus.map(x=>row(x.id,'menu',x.name,'')):[],
  incoming:materials.concat(supplies).map(x=>row(x.id,'material',x.name,x.base_unit)).concat(production?wips.map(x=>row(x.id,'wip',x.name,x.yield_unit)):[]),
  expenses:materials.concat(supplies).map(x=>row(x.id,'material',x.name,x.base_unit)).concat(wd?wips.map(x=>row(x.id,'wip',x.name,x.yield_unit)):[]),
  production:production?wips.map(x=>row(x.id,'wip',x.name,x.yield_unit)):[],
  supplies:supply?supplies.map(x=>row(x.id,'supply',x.name,x.base_unit)):[],
  divisions:(()=>{const current=clDivision(div),outlet=current&&current.outlet_id,all=[...(INV.divs||[]),...(CG.divs||[])],map=new Map();all.forEach(d=>{if(d&&d.id&&d.active!==false&&String(d.id)!==div&&(!outlet||String(d.outlet_id)===String(outlet)))map.set(String(d.id),d)});return[...map.values()].sort((a,b)=>invAlpha(a.name,b.name))})()
 };
}
function clTemplatePermissions(payload){if(isDeveloper()||!payload)return[];const out=[],req=(cond,key,label)=>{if(cond&&!hasFeature(key))out.push('Akun belum memiliki izin '+label+'.')};req(payload.daily_so?.length,'cogs.daily_so.edit','edit Daily SO');req(payload.sales?.length,'cogs.sales.manage','input Penjualan');req(payload.production?.length,'cogs.production.manage','input Produksi WIP');const invWrite=!!(payload.stock_in?.length||payload.stock_out?.length||payload.supplies?.length);req(invWrite,'inventory.view','lihat Inventory');req(invWrite,'inventory.manage','mengelola Inventory');if(payload.opening_wip?.length&&!hasFeature('inventory.inbound.manage')&&!hasFeature('cogs.production.manage'))out.push('Akun belum memiliki izin stok awal WIP.');return[...new Set(out)]}
function clOpenTemplateDialog(){
 if(!clCanAccess())return toast('Approval Closing hanya tersedia untuk Developer dan Admin Divisi.','warn');
 if(!window.XLSX)return toast('Modul Excel belum siap. Muat ulang halaman lalu coba lagi.','warn');
 if(CL.period&&['approved','needs_reconciliation'].includes(CL.period.status))return toast('Closing sudah final atau memerlukan rekonsiliasi. Template untuk tanggal ini dikunci.','warn');
 modal('<h3>Template Daily SO</h3><p class="mu">Outlet/divisi: <b>'+esc(clDivision(CL.division)?.name||'Divisi')+'</b><br>Tanggal target: <b>'+esc(CL.date)+'</b></p><p class="mu">Satu sheet dengan layout menyerupai contoh: ITEM, WIP, SUPPLIES, dan PENGELUARAN. Daftar otomatis mengikuti master aktif. Bagian Waste Menu tidak disertakan.</p><div class="btns"><button class="btn" type="button" onclick="window.__clDownloadTemplate()">Unduh template Excel</button><label class="btn s" style="display:inline-flex;align-items:center;gap:8px;cursor:pointer">Pilih file untuk upload<input id="cl_template_file" type="file" accept=".xlsx,.xls" style="display:none" onchange="window.__clPreviewTemplateImport(this)"></label></div><p class="mu" style="font-size:12px">Isi MASUK, AKHIR, PRODUKSI, dan maksimal 25 baris PENGELUARAN. ITEM dan KATEGORI memakai dropdown; TUJUAN wajib dipilih untuk kategori Move saja. Jangan ubah tanggal, nama item, satuan, atau struktur template. Upload hanya menambah data; transaksi yang sudah ada tidak ditimpa.</p>');
}
function clEnsureExcelJS(){
 if(window.ExcelJS&&typeof window.ExcelJS.Workbook==='function')return Promise.resolve(window.ExcelJS);
 if(window.__clExcelJSLoading)return window.__clExcelJSLoading;
 window.__clExcelJSLoading=new Promise((resolve,reject)=>{
  const script=document.createElement('script');
  script.src='https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
  script.async=true;
  script.onload=()=>window.ExcelJS&&typeof window.ExcelJS.Workbook==='function'?resolve(window.ExcelJS):reject(new Error('Library dropdown Excel tidak berhasil dimuat.'));
  script.onerror=()=>reject(new Error('Gagal memuat library dropdown Excel. Periksa koneksi internet lalu coba lagi.'));
  document.head.appendChild(script);
 });
 return window.__clExcelJSLoading.finally(()=>{window.__clExcelJSLoading=null});
}
function clExcelColumnName(n){
 let out='';while(n>0){const r=(n-1)%26;out=String.fromCharCode(65+r)+out;n=Math.floor((n-1)/26)}return out;
}
async function clDownloadTemplate(){
 if(!clCanAccess())return toast('Akses ditolak.','warn');
 if(!window.XLSX)return toast('Modul Excel belum siap. Tunggu sebentar lalu coba lagi.','warn');
 if(!CL.division||!CL.date)return toast('Pilih divisi dan tanggal closing terlebih dahulu.','warn');
 if(CL.period&&['approved','needs_reconciliation'].includes(CL.period.status))return toast('Tanggal closing terkunci.','warn');
 try{
  const ExcelJS=await clEnsureExcelJS(),c=clTemplateCatalog(),wb=new ExcelJS.Workbook();
  const itemRows=c.daily.filter(x=>x.type==='material'),wipRows=c.daily.filter(x=>x.type==='wip'),supplyRows=c.supplies||[];
  const itemHeaderRow=2,itemFirstRow=3,wipHeaderRow=itemFirstRow+itemRows.length,wipFirstRow=wipHeaderRow+1;
  const suppliesHeaderRow=wipFirstRow+wipRows.length,suppliesFirstRow=suppliesHeaderRow+1;
  const expenseFirstRow=4,expenseLastRow=28;
  const lastRow=Math.max(expenseLastRow,suppliesHeaderRow+supplyRows.length);
  const ws=wb.addWorksheet('Daily SO');
  const matrix=Array.from({length:lastRow},()=>Array(10).fill(null));
  matrix[0][0]='Ini untuk Daily SO';matrix[0][6]='Ini untuk Pengeluaran';
  matrix[1][0]='DATE';matrix[1][1]='ITEM';matrix[1][2]='MASUK';matrix[1][3]='AKHIR';matrix[1][4]='UNIT';
  matrix[1][6]='ITEM';matrix[1][7]='JUMLAH';matrix[1][8]='KATEGORI';matrix[1][9]='TUJUAN';
  matrix[wipHeaderRow-1][1]='ITEM WIP';matrix[wipHeaderRow-1][2]='PRODUKSI';matrix[wipHeaderRow-1][3]='AKHIR';matrix[wipHeaderRow-1][4]='UNIT';
  matrix[suppliesHeaderRow-1][1]='ITEM SUPLIES';matrix[suppliesHeaderRow-1][2]='MASUK';matrix[suppliesHeaderRow-1][3]='AKHIR';matrix[suppliesHeaderRow-1][4]='UNIT';
  matrix[2][6]='Dropdown dari FITUR MASTER BARANG > ITEM';matrix[2][8]='Dropdown dari FITUR PENGELUARAN > KATEGORI';
  const rowMap=[],missingPreferredUnits=[];
  itemRows.forEach((x,i)=>{
   const r=itemFirstRow+i,masterItem=(INV.items||[]).find(y=>String(y.id)===String(x.id)),preference=clTemplatePreferredUnit(masterItem),defaultUnit=preference.unit;
   if(preference.missing)missingPreferredUnits.push(x.name+' → '+preference.requested);
   matrix[r-1][0]=String(CL.date);matrix[r-1][1]=x.name;matrix[r-1][2]='';matrix[r-1][3]='';matrix[r-1][4]=defaultUnit;
   const unitOptions=(Array.isArray(masterItem?.conversions)?masterItem.conversions:[]).filter(cv=>String(cv.unit||'').trim()&&Number(cv.factor)>0).map(cv=>({unit:String(cv.unit),factor:Number(cv.factor)}));
   const unitFactor=Number(unitOptions.find(cv=>cv.unit.toLowerCase()===String(defaultUnit).toLowerCase())?.factor||1);
   rowMap.push({section:'ITEM',row:r,id:x.id,type:x.type,name:x.name,unit:x.unit,unitFactor:unitFactor>0?unitFactor:1,unitOptions});
  });
  wipRows.forEach((x,i)=>{
   const r=wipFirstRow+i,w=(CG.wips||[]).find(y=>String(y.id)===String(x.id));
   matrix[r-1][0]=String(CL.date);matrix[r-1][1]=x.name;matrix[r-1][2]='';matrix[r-1][3]='';matrix[r-1][4]=x.unit;
   rowMap.push({section:'WIP',row:r,id:x.id,type:'wip',name:x.name,unit:x.unit,yieldQty:Number(w?.yield_qty||1)});
  });
  supplyRows.forEach((x,i)=>{
   const r=suppliesFirstRow+i;matrix[r-1][0]=String(CL.date);matrix[r-1][1]=x.name;matrix[r-1][2]='';matrix[r-1][3]='';matrix[r-1][4]=x.unit;
   rowMap.push({section:'SUPPLIES',row:r,id:x.id,type:'supply',name:x.name,unit:x.unit,yieldQty:null});
  });
  matrix.forEach(row=>ws.addRow(row));
  ws.views=[{state:'frozen',ySplit:1}];
  const widths=[13,31,14,14,12,3,30,12,17,24];
  widths.forEach((w,i)=>{ws.getColumn(i+1).width=w});
  ws.getRow(1).height=24;ws.getRow(2).height=25;ws.getRow(3).height=32;ws.getRow(wipHeaderRow).height=23;ws.getRow(suppliesHeaderRow).height=23;
  const thin={style:'thin',color:{argb:'FFD7DDD8'}};
  const border={top:thin,bottom:thin,left:thin,right:thin};
  for(let r=1;r<=lastRow;r++){
   if(r===1||r===itemHeaderRow||r===wipHeaderRow||r===suppliesHeaderRow)continue;
   const hasStockRow=rowMap.some(x=>x.row===r),isExpense=r>=expenseFirstRow&&r<=expenseLastRow;
   const ranges=[];if(hasStockRow)ranges.push([1,5]);if(isExpense)ranges.push([7,10]);
   ranges.forEach(([startCol,endCol])=>{for(let col=startCol;col<=endCol;col++){
    const cell=ws.getCell(r,col);cell.border=border;
    cell.alignment={vertical:'middle',wrapText:col===2||col===7||col===9||col===10};
    cell.font={name:'Arial',size:10,color:{argb:'FF26352D'}};
    cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:(r%2===0?'FFFFFFFF':(col>=6?'FFFFF9F9':'FFF8FAF8'))}};
   }});
  }
  const styleHeader=(row,startCol,endCol,color)=>{
   for(let col=startCol;col<=endCol;col++){
    const cell=ws.getCell(row,col);cell.font={name:'Arial',size:10,bold:true,color:{argb:'FFFFFFFF'}};
    cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:color}};cell.alignment={vertical:'middle',horizontal:'center',wrapText:true};cell.border=border;
   }
  };
  styleHeader(2,1,5,'FF42594A');styleHeader(2,7,10,'FFC62828');
  styleHeader(wipHeaderRow,2,5,'FF42594A');styleHeader(suppliesHeaderRow,2,5,'FF42594A');
  for(let r=expenseFirstRow;r<=expenseLastRow;r++){
   for(let col=7;col<=10;col++){
    const cell=ws.getCell(r,col);cell.border=border;
    cell.alignment={vertical:'middle',wrapText:col===6||col===9||col===10};
    cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:(r%2===0?'FFFFFFFF':'FFFFF9F9')}};
   }
  }
  for(const x of rowMap){const cell=ws.getCell(x.row,1);cell.numFmt='@';ws.getCell(x.row,3).numFmt='0.####';ws.getCell(x.row,4).numFmt='0.####';}
  for(const hintCol of [7,9]){const hint=ws.getCell(3,hintCol);hint.font={name:'Arial',size:9,italic:true,color:{argb:'FF7D8980'}};hint.alignment={vertical:'middle',wrapText:true}}
  for(let r=expenseFirstRow;r<=expenseLastRow;r++)ws.getCell(r,8).numFmt='0.####';

  const meta=wb.addWorksheet('_META');
  [
   ['FIELD','VALUE'],
   ['VERSION','BARAPP_DAILY_SO_TEMPLATE_V4'],
   ['TEMPLATE_ID',clTemplateId()],
   ['DIVISION_ID',String(CL.division)],
   ['DIVISION_NAME',String(clDivision(CL.division)?.name||'')],
   ['OUTLET_ID',String(clDivision(CL.division)?.outlet_id||'')],
   ['TARGET_DATE',String(CL.date)],
   ['GENERATED_AT',new Date().toISOString()],
   ['ITEM_HEADER_ROW',String(itemHeaderRow)],
   ['ITEM_FIRST_ROW',String(itemFirstRow)],
   ['ITEM_COUNT',String(itemRows.length)],
   ['WIP_HEADER_ROW',String(wipHeaderRow)],
   ['WIP_FIRST_ROW',String(wipFirstRow)],
   ['WIP_COUNT',String(wipRows.length)],
   ['SUPPLIES_HEADER_ROW',String(suppliesHeaderRow)],
   ['SUPPLIES_FIRST_ROW',String(suppliesFirstRow)],
   ['SUPPLIES_COUNT',String(supplyRows.length)],
   ['EXPENSE_FIRST_ROW',String(expenseFirstRow)],
   ['EXPENSE_LAST_ROW',String(expenseLastRow)],
   ['INSTRUCTIONS','Isi AKHIR untuk semua item ITEM dan WIP jika Daily SO digunakan. PRODUKSI diisi jumlah hasil dalam UNIT; jumlah harus kelipatan hasil per batch dari master. PENGELUARAN: pilih ITEM, isi JUMLAH dan KATEGORI, lalu untuk Move pilih TUJUAN dari dropdown divisi aktif dalam outlet yang sama. Jangan mengubah struktur atau master item.']
  ].forEach(r=>meta.addRow(r));
  meta.addRow([]);
  meta.addRow(['','','SECTION','ROW_NUMBER','ITEM_ID','ITEM_TYPE','ITEM_NAME','UNIT','YIELD_QTY']);
  rowMap.forEach(x=>meta.addRow(['','',x.section,String(x.row),x.id,x.type,x.name,x.unit,x.yieldQty===null?'':String(x.yieldQty)]));
  meta.state='hidden';
  const lists=wb.addWorksheet('_LISTS');
  lists.addRow(['ITEM_OPTION','ITEM_ID','ITEM_TYPE','UNIT','','CATEGORY','TARGET_OPTION','TARGET_DIVISION_ID']);
  const options=(INV.items||[]).filter(x=>String(x.division_id)===String(CL.division)&&x.active===true)
   .slice().sort((a,b)=>invAlpha(a.name,b.name))
   .map(x=>({id:String(x.id),type:'material',unit:String(x.base_unit||'UNIT'),name:String(x.name||''),display:String(x.name||''),kind:x.is_supply===true?'SUPPLIES':'ITEM'}));
  const categories=clTemplateCategories();
  const targets=(c.divisions||[]).map(d=>({id:String(d.id),name:String(d.name||'').trim()})).filter(d=>d.id&&d.name);
  const listsRowCount=Math.max(options.length,categories.length,targets.length);
  for(let i=0;i<listsRowCount;i++)lists.addRow([options[i]?.display||'',options[i]?.id||'',options[i]?.type||'',options[i]?.unit||'','',categories[i]||'',targets[i]?.name||'',targets[i]?.id||'']);
  lists.state='hidden';
  // Put dropdown sources near the top of the same worksheet, matching the
  // proven sample template: categories in J2:J7, unit choices from J9 down,
  // and expense item choices in K2 down. Keep metadata/helper columns hidden.
  const dropdownCols={unit:11,category:11,item:12,itemId:13,itemType:14,itemUnit:15,target:16,targetId:17};
  for(let col=11;col<=17;col++)ws.getColumn(col).hidden=true;
  ws.getColumn(dropdownCols.unit).width=18;
  ws.getColumn(dropdownCols.item).width=32;
  ws.getColumn(dropdownCols.target).width=28;
  categories.forEach((category,i)=>{ws.getCell(2+i,dropdownCols.category).value=category});
  const unitOptions=[],unitSeen=new Set();
  itemRows.forEach(x=>{
   const masterItem=(INV.items||[]).find(y=>String(y.id)===String(x.id));
   const conversions=Array.isArray(masterItem?.conversions)?masterItem.conversions:[];
   const candidates=conversions.length?conversions:[{unit:x.unit,factor:1}];
   candidates.forEach(cv=>{
    const unit=String(cv.unit||'').trim(),key=unit.toLocaleLowerCase();
    if(unit&&Number(cv.factor)>0&&!unitSeen.has(key)){unitSeen.add(key);unitOptions.push(unit)}
   });
  });
  if(!unitOptions.length)itemRows.forEach(x=>{const unit=String(x.unit||'').trim(),key=unit.toLowerCase();if(unit&&!unitSeen.has(key)){unitSeen.add(key);unitOptions.push(unit)}});
  const unitFirstRow=9;
  unitOptions.forEach((unit,i)=>{ws.getCell(unitFirstRow+i,dropdownCols.unit).value=unit});
  options.forEach((x,i)=>{
   const r=i+2;
   ws.getCell(r,dropdownCols.item).value=x.display;
   ws.getCell(r,dropdownCols.itemId).value=x.id;
   ws.getCell(r,dropdownCols.itemType).value=x.listType;
   ws.getCell(r,dropdownCols.itemUnit).value=x.unit;
  });
  targets.forEach((x,i)=>{
   const r=i+2;
   ws.getCell(r,dropdownCols.target).value=x.name;
   ws.getCell(r,dropdownCols.targetId).value=x.id;
  });
  const dollar=String.fromCharCode(36);
  const unitValidationFormula='='+dollar+'K'+dollar+unitFirstRow+':'+dollar+'K'+dollar+(unitFirstRow+unitOptions.length-1);
  const itemValidationFormula='='+dollar+'L'+dollar+'2:'+dollar+'L'+dollar+(options.length+1);
  const categoryValidationFormula='='+dollar+'K'+dollar+'2:'+dollar+'K'+dollar+(categories.length+1);
  const targetValidationFormula='='+dollar+'P'+dollar+'2:'+dollar+'P'+dollar+(targets.length+1);
  // Use contiguous same-sheet ranges rather than inline lists or hidden sheets;
  // this mirrors the user's working example in Google Sheets.
  const itemLastRow=itemFirstRow+itemRows.length-1;
  if(unitOptions.length&&itemRows.length)ws.dataValidations.add('E2:E'+itemLastRow,{type:'list',allowBlank:true,formulae:[unitValidationFormula],showErrorMessage:true,errorStyle:'stop',errorTitle:'Satuan tidak valid',error:'Pilih satuan dari daftar Master Barang; saat impor satuan juga harus valid untuk item ini.'});
  if(options.length)ws.dataValidations.add('G'+expenseFirstRow+':G'+expenseLastRow,{type:'list',allowBlank:true,formulae:[itemValidationFormula],showErrorMessage:true,errorStyle:'stop',errorTitle:'Item tidak dikenal',error:'Pilih item aktif dari Master Barang.'});
  if(categories.length)ws.dataValidations.add('I'+expenseFirstRow+':I'+expenseLastRow,{type:'list',allowBlank:true,formulae:[categoryValidationFormula],showErrorMessage:true,errorTitle:'Kategori tidak valid',error:'Pilih kategori dari fitur Pengeluaran Barapp.'});
  if(targets.length)ws.dataValidations.add('J'+expenseFirstRow+':J'+expenseLastRow,{type:'list',allowBlank:true,formulae:[targetValidationFormula],showErrorMessage:true,errorTitle:'Tujuan tidak valid',error:'Untuk kategori Move, pilih divisi aktif dari outlet yang sama.'});
  const buffer=await wb.xlsx.writeBuffer();
  const blob=new Blob([buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download='Template-Daily-SO-'+(String(clDivision(CL.division)?.name||'Divisi').replace(/[^a-z0-9]+/gi,'-').replace(/^-|-$/g,'')||'Divisi')+'-'+CL.date+'.xlsx';
  document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
  CL.templateDraft=null;
  if(missingPreferredUnits.length)toast('Template diunduh. Default satuan belum tersedia di Master Barang untuk: '+missingPreferredUnits.join(', ')+'. Satuan dasar dipakai dan Master Barang tidak diubah.','warn');
  else toast('Template Daily SO diunduh dengan daftar master dinamis, default satuan pilihan, dan 25 baris pengeluaran.','ok');
 }catch(e){toast('Gagal membuat template Excel: '+String(e&&e.message||e),'err')}
}
function clTemplateDateConflict(p){
 const e=[],d=String(CL.division),date=String(CL.date);
 if(p.daily_so.length&&CG.dailySO.some(x=>String(x.division_id)===d&&String(x.so_date)===date&&x.status==='submitted'))e.push('Daily SO sudah tersimpan pada tanggal ini. Sheet Daily SO tidak dapat diimpor lagi.');
 if(p.sales.length&&CG.sales.some(x=>String(x.division_id)===d&&String(x.sold_at)===date&&x.status==='posted'))e.push('Sudah ada transaksi Penjualan pada tanggal ini. Kosongkan sheet Penjualan agar tidak terduplikasi.');
 if(p.stock_in.length&&INV.ins.some(x=>String(x.division_id)===d&&String(x.received_at)===date&&x.status==='posted'))e.push('Sudah ada transaksi Barang Masuk pada tanggal ini. Kosongkan sheet Barang Masuk agar tidak menggandakan stok masuk.');
 if(p.opening_wip.length&&(INV.productionBatches||[]).some(x=>String(x.division_id)===d&&String(x.produced_at)===date&&x.status==='posted'&&x.cost_source==='opening'))e.push('Sudah ada stok awal WIP pada tanggal ini. Kosongkan baris WIP di sheet Barang Masuk.');
 if(p.stock_out.length&&INV.stockOut.some(x=>String(x.from_division_id)===d&&String(x.out_date)===date&&x.status==='posted'))e.push('Sudah ada transaksi Pengeluaran pada tanggal ini. Kosongkan sheet Pengeluaran agar tidak menggandakan stok keluar.');
 if(p.production.length&&(CG.productions||[]).some(x=>String(x.division_id)===d&&String(x.produced_at)===date&&x.status==='posted'&&x.cost_source!=='opening'))e.push('Sudah ada transaksi Produksi WIP pada tanggal ini. Kosongkan sheet Produksi WIP agar tidak menggandakan produksi.');
 if(p.supplies.length&&INV.suppliesSO.some(x=>String(x.division_id)===d&&String(x.so_date)===date&&x.status==='submitted'))e.push('Daily SO Supplies sudah tersimpan pada tanggal ini. Sheet Supplies tidak dapat diimpor lagi.');
 return e;
}
async function clPreviewTemplateImport(input){
 const file=input&&input.files&&input.files[0];if(!file)return;
 if(!clCanAccess())return toast('Akses ditolak.','warn');
 if(!window.XLSX)return toast('Modul Excel belum siap.','warn');
 if(file.size>15*1024*1024)return toast('Ukuran file terlalu besar. Maksimal 15 MB.','warn');
 modal('<h3>Memeriksa template Daily SO…</h3><p class="mu">Mengecek ITEM, WIP, SUPPLIES, 25 baris PENGELUARAN, master, tanggal, dan potensi duplikasi. Belum ada data yang disimpan.</p>');
 const errors=[],warnings=[];
 try{
  await Promise.all([cgLoad(false),invLoad(false)]);
  const {data:period,error:pe}=await sb().from('barapp_closing_periods').select('id,status').eq('division_id',CL.division).eq('closing_date',CL.date).maybeSingle();
  if(pe)throw pe;CL.period=period?Object.assign({},CL.period||{},period):null;
  const wb=XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:false}),ws=wb.Sheets['Daily SO'];
  if(!ws)errors.push('Sheet Daily SO tidak ditemukan. Gunakan template asli dari Approval Closing.');
  if(!wb.Sheets._META)errors.push('Metadata template tidak ditemukan. Unduh template baru dari Approval Closing.');
  if(!wb.Sheets._LISTS)errors.push('Daftar dropdown template tidak ditemukan. Unduh template baru dari Approval Closing.');
  let meta={};
  if(wb.Sheets._META){
   const m=XLSX.utils.sheet_to_json(wb.Sheets._META,{header:1,defval:'',raw:true});
   m.slice(1).forEach(r=>{const k=String(r[0]||'').trim().toUpperCase();if(k)meta[k]=k==='TARGET_DATE'?clTemplateDateValue(r[1]):String(r[1]??'').trim()});
  }
  const isTemplateV4=meta.VERSION==='BARAPP_DAILY_SO_TEMPLATE_V4';
  if(!isTemplateV4)errors.push('Template lama tidak didukung. Unduh template Daily SO terbaru.');
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(meta.TEMPLATE_ID||''))errors.push('ID template tidak valid. Unduh template baru.');
  if(String(meta.DIVISION_ID||'')!==String(CL.division))errors.push('Template dibuat untuk divisi berbeda. Sesuaikan pilihan divisi atau unduh ulang.');
  if(String(meta.TARGET_DATE||'')!==String(CL.date))errors.push('Tanggal pada template berbeda dari tanggal closing terpilih. Pilih tanggal yang benar atau unduh ulang.');
  if(meta.OUTLET_ID&&String(meta.OUTLET_ID)!==String(clDivision(CL.division)?.outlet_id||''))errors.push('Template berasal dari outlet berbeda.');
  if(CL.period&&['approved','needs_reconciliation'].includes(CL.period.status))errors.push('Closing tanggal ini sudah final atau memerlukan rekonsiliasi. Impor ditolak.');
  if(!CG.ready)throw new Error(CG.err||'Data master COGS belum berhasil dimuat.');
  if(!INV.ready)throw new Error(INV.err||'Data master barang belum berhasil dimuat.');
  if(!ws||!wb.Sheets._META||!wb.Sheets._LISTS)throw new Error('Struktur template tidak lengkap.');
  const matrix=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:true});
  const expectedMain=[['DATE',0],['ITEM',1],['MASUK',2],['AKHIR',3],['UNIT',4],['ITEM',6],['JUMLAH',7],['KATEGORI',8],['TUJUAN',9]];
  expectedMain.forEach(([h,i])=>{if(String(matrix[1]?.[i]??'').trim().toUpperCase()!==h)errors.push('Header kolom '+(i+1)+' harus '+h+'. Jangan ubah layout template.')});
  if(!clTemplateBlank(matrix[1]?.[5]))errors.push('Kolom F harus menjadi pemisah kosong sesuai layout template.');
  const intMeta=k=>{const n=Number(meta[k]);return Number.isInteger(n)&&n>0?n:0};
  const itemHeader=intMeta('ITEM_HEADER_ROW'),itemFirst=intMeta('ITEM_FIRST_ROW'),itemCount=Number(meta.ITEM_COUNT);
  const wipHeader=intMeta('WIP_HEADER_ROW'),wipFirst=intMeta('WIP_FIRST_ROW'),wipCount=Number(meta.WIP_COUNT);
  const supplyHeader=intMeta('SUPPLIES_HEADER_ROW'),supplyFirst=intMeta('SUPPLIES_FIRST_ROW'),supplyCount=Number(meta.SUPPLIES_COUNT);
  const expenseFirst=intMeta('EXPENSE_FIRST_ROW'),expenseLast=intMeta('EXPENSE_LAST_ROW');
  if(itemHeader!==2||itemFirst!==3||itemCount<0||wipHeader!==itemFirst+itemCount||wipFirst!==wipHeader+1||wipCount<0||supplyHeader!==wipFirst+wipCount||supplyFirst!==supplyHeader+1||supplyCount<0||expenseFirst!==4||expenseLast!==28)errors.push('Struktur baris pada template berubah. Unduh file baru.');
  const sectionHeaders=[
   [wipHeader,1,'ITEM WIP'],[wipHeader,2,'PRODUKSI'],[wipHeader,3,'AKHIR'],[wipHeader,4,'UNIT'],
   [supplyHeader,1,'ITEM SUPLIES'],[supplyHeader,2,'MASUK'],[supplyHeader,3,'AKHIR'],[supplyHeader,4,'UNIT']
  ];
  sectionHeaders.forEach(([r,c,h])=>{if(String(matrix[r-1]?.[c]??'').trim().toUpperCase()!==h)errors.push('Header '+h+' hilang atau berubah. Unduh ulang template.')});
  const metaMatrix=XLSX.utils.sheet_to_json(wb.Sheets._META,{header:1,defval:'',raw:true});
  const rowMap=metaMatrix.slice(1).filter(r=>String(r[2]||'').trim()&&/^(ITEM|WIP|SUPPLIES)$/.test(String(r[2]).trim())).map(r=>{
   const section=String(r[2]).trim(),id=String(r[4]||'').trim(),unit=String(r[7]||''),item=section==='ITEM'?(INV.items||[]).find(v=>String(v.id)===id):null;
   const unitOptions=(Array.isArray(item?.conversions)?item.conversions:[]).filter(cv=>String(cv.unit||'').trim()&&Number(cv.factor)>0).map(cv=>({unit:String(cv.unit),factor:Number(cv.factor)}));
   return {section,row:Number(r[3]),id,type:String(r[5]||'').trim(),name:String(r[6]||''),unit,yieldQty:clTemplateNumber(r[8]),unitOptions};
  });
  const c=clTemplateCatalog();
  const expectedMap={ITEM:c.daily.filter(x=>x.type==='material'),WIP:c.daily.filter(x=>x.type==='wip'),SUPPLIES:c.supplies||[]};
  for(const section of ['ITEM','WIP','SUPPLIES']){
   const actual=rowMap.filter(x=>x.section===section),wanted=expectedMap[section];
   if(actual.length!==wanted.length||!clTemplateSameSet(actual.map(x=>(x.type==='supply'?'supply':x.type)+':'+x.id),wanted.map(x=>x.type+':'+x.id)))errors.push(section+': daftar master berubah atau metadata item hilang. Unduh ulang template agar item terbaru sesuai master.');
  }
  const mappedByRow=new Map();
  rowMap.forEach(x=>{
   if(!Number.isInteger(x.row)||x.row<2||mappedByRow.has(x.section+':'+x.row))errors.push('Metadata posisi item tidak valid atau duplikat.');
   mappedByRow.set(x.section+':'+x.row,x);
   const current=expectedMap[x.section]?.find(y=>String(y.id)===x.id);
   if(!current||current.name!==x.name||current.unit!==x.unit)errors.push(x.section+' baris '+x.row+': item atau satuan tidak sesuai master terbaru. Unduh ulang template.');
   const cells=matrix[x.row-1]||[];
   const shownName=String(cells[1]??'').trim(),shownUnit=String(cells[4]??'').trim();
   if(shownName!==x.name)errors.push(x.section+' baris '+x.row+': nama item berubah atau tidak sesuai metadata.');
   if(x.section==='ITEM'){
    if(!(x.unitOptions||[]).some(cv=>cv.unit.toLowerCase()===shownUnit.toLowerCase()))errors.push('ITEM baris '+x.row+': satuan "'+shownUnit+'" tidak tersedia di Master Barang untuk item ini.');
   }else if(shownUnit!==x.unit)errors.push(x.section+' baris '+x.row+': satuan berubah atau tidak sesuai master.');
   if(clTemplateDateValue(cells[0])!==String(CL.date))errors.push(x.section+' baris '+x.row+': DATE harus '+String(CL.date)+'.');
  });
  const p={daily_so:[],sales:[],stock_in:[],opening_wip:[],stock_out:[],production:[],supplies:[]};
  let dailyTouched=false;const dailyRows=[];
  const incomingSeen=new Set();
  rowMap.filter(x=>x.section==='ITEM').forEach(x=>{
   const cells=matrix[x.row-1]||[],incomingRaw=cells[2],countedRaw=cells[3],selectedUnit=String(cells[4]||x.unit||'').trim(),selectedConversion=(x.unitOptions||[]).find(cv=>cv.unit.toLowerCase()===selectedUnit.toLowerCase());
   if(!clTemplateBlank(incomingRaw)||!clTemplateBlank(countedRaw)){
    if(!selectedConversion)errors.push('ITEM baris '+x.row+': satuan "'+selectedUnit+'" tidak tersedia di Master Barang untuk item ini. Pilih satuan yang benar dari dropdown.');
   }
   if(!clTemplateBlank(incomingRaw)){
    const q=clTemplateNumber(incomingRaw);
    if(q===null||!Number.isFinite(q)||q<0)errors.push('ITEM baris '+x.row+': MASUK harus angka 0 atau lebih.');
    else if(q>0&&selectedConversion){const key=x.id;if(incomingSeen.has(key))errors.push('ITEM: item masuk terduplikasi.');else{incomingSeen.add(key);p.stock_in.push({item_id:x.id,qty:q,unit:selectedUnit,invoice_total:null,notes:''})}}
   }
   if(!clTemplateBlank(countedRaw))dailyTouched=true;
   if(!clTemplateBlank(countedRaw)){
    const q=clTemplateNumber(countedRaw);
    if(q===null||!Number.isFinite(q)||q<0)errors.push('ITEM baris '+x.row+': AKHIR harus angka 0 atau lebih.');
    else if(selectedConversion)dailyRows.push({item_id:x.id,item_type:'material',qty:q*Number(selectedConversion.factor||1)});
   }
  });
  rowMap.filter(x=>x.section==='WIP').forEach(x=>{
   const cells=matrix[x.row-1]||[],productionRaw=cells[2],countedRaw=cells[3];
   if(!clTemplateBlank(productionRaw)){
    const qty=clTemplateNumber(productionRaw),yieldQty=Number(x.yieldQty||0);
    if(qty===null||!Number.isFinite(qty)||qty<0)errors.push('WIP baris '+x.row+': PRODUKSI harus angka 0 atau lebih.');
    else if(qty>0){
     if(!(yieldQty>0))errors.push('WIP baris '+x.row+': hasil per batch tidak valid pada master.');
     else{
      const batches=qty/yieldQty,rounded=Math.round(batches);
      if(Math.abs(batches-rounded)>1e-8)errors.push('WIP baris '+x.row+': PRODUKSI harus kelipatan '+yieldQty+' '+x.unit+' per batch.');
      else p.production.push({wip_id:x.id,batches:rounded});
     }
    }
   }
   if(!clTemplateBlank(countedRaw))dailyTouched=true;
   if(!clTemplateBlank(countedRaw)){
    const q=clTemplateNumber(countedRaw);
    if(q===null||!Number.isFinite(q)||q<0)errors.push('WIP baris '+x.row+': AKHIR harus angka 0 atau lebih.');
    else dailyRows.push({item_id:x.id,item_type:'wip',qty:q});
   }
  });
  if(dailyTouched){
   if(dailyRows.length!==rowMap.filter(x=>x.section==='ITEM'||x.section==='WIP').length)errors.push('Daily SO: jika kolom AKHIR digunakan, isi AKHIR untuk semua ITEM dan WIP, termasuk 0.');
   else p.daily_so=dailyRows;
  }
  let suppliesTouched=false;const supplyRows=[];
  rowMap.filter(x=>x.section==='SUPPLIES').forEach(x=>{
   const cells=matrix[x.row-1]||[],incomingRaw=cells[2],countedRaw=cells[3];
   if(!clTemplateBlank(incomingRaw)){
    const q=clTemplateNumber(incomingRaw);
    if(q===null||!Number.isFinite(q)||q<0)errors.push('SUPPLIES baris '+x.row+': MASUK harus angka 0 atau lebih.');
    else if(q>0){const key=x.id;if(incomingSeen.has(key))errors.push('SUPPLIES: item masuk terduplikasi.');else{incomingSeen.add(key);p.stock_in.push({item_id:x.id,qty:q,unit:x.unit,invoice_total:null,notes:''})}}
   }
   if(!clTemplateBlank(countedRaw))suppliesTouched=true;
   if(!clTemplateBlank(countedRaw)){
    const q=clTemplateNumber(countedRaw);
    if(q===null||!Number.isFinite(q)||q<0)errors.push('SUPPLIES baris '+x.row+': AKHIR harus angka 0 atau lebih.');
    else supplyRows.push({item_id:x.id,qty:q,actual_qty_base:q});
   }
  });
  if(suppliesTouched){
   if(supplyRows.length!==rowMap.filter(x=>x.section==='SUPPLIES').length)errors.push('SUPPLIES: jika kolom AKHIR digunakan, isi AKHIR untuk semua item supplies, termasuk 0.');
   else p.supplies=supplyRows;
  }
  const lists=XLSX.utils.sheet_to_json(wb.Sheets._LISTS,{header:1,defval:'',raw:true});
  const listByLabel=new Map(),listRows=[];
  for(let i=1;i<lists.length;i++){
   const label=String(lists[i]?.[0]??'').trim(),id=String(lists[i]?.[1]??'').trim(),type=String(lists[i]?.[2]??'').trim(),unit=String(lists[i]?.[3]??'').trim();
   if(label&&id&&type){const entry={label,id,type,unit};if(listByLabel.has(label))errors.push('Dropdown ITEM memiliki label duplikat: '+label+'.');else listByLabel.set(label,entry);listRows.push(entry)}
  }
  const currentOptions=(INV.items||[]).filter(x=>String(x.division_id)===String(CL.division)&&x.active===true).map(x=>({id:String(x.id),type:'material',unit:String(x.base_unit||'UNIT'),name:String(x.name||'')}));
  const metadataOptions=currentOptions.map(x=>{
   const duplicates=currentOptions.filter(y=>y.name.trim().toLocaleLowerCase()===x.name.trim().toLocaleLowerCase()).length;
   const item=(INV.items||[]).find(y=>String(y.id)===String(x.id));
   const suffix=x.type==='wip'?'WIP':item?.is_supply===true?'SUPPLIES':'ITEM';
   return {id:x.id,type:x.type,unit:x.unit,label:duplicates>1?x.name+' ['+suffix+']':x.name};
  });
  if(listRows.length!==metadataOptions.length||!clTemplateSameSet(listRows.map(x=>x.label+'|'+x.type+':'+x.id),metadataOptions.map(x=>x.label+'|'+x.type+':'+x.id)))errors.push('Dropdown ITEM sudah berbeda dari master Barapp. Unduh template terbaru.');
  const cats=clTemplateCategories(),listedCats=lists.slice(1).map(r=>String(r?.[5]??'').trim()).filter(Boolean);
  if(!clTemplateSameSet(listedCats,cats))errors.push('Daftar kategori dropdown berubah atau tidak sesuai template Barapp.');
  const listedTargets=lists.slice(1).map(r=>({name:String(r?.[6]??'').trim(),id:String(r?.[7]??'').trim()})).filter(x=>x.name&&x.id);
  const expectedTargets=(c.divisions||[]).map(d=>({name:String(d.name||'').trim(),id:String(d.id||'').trim()})).filter(x=>x.name&&x.id);
  if(listedTargets.length!==expectedTargets.length||!clTemplateSameSet(listedTargets.map(x=>x.name+'|'+x.id),expectedTargets.map(x=>x.name+'|'+x.id)))errors.push('Dropdown TUJUAN sudah berbeda dari daftar divisi aktif. Unduh template terbaru.');
  const expenseSeen=new Set();
  for(let r=expenseFirst;r<=expenseLast;r++){
   const cells=matrix[r-1]||[],label=String(cells[6]??'').trim(),rawQty=cells[7],category=String(cells[8]??'').trim(),targetName=String(cells[9]??'').trim();
   if(!label&&clTemplateBlank(rawQty)&&!category&&!targetName)continue;
   if(!label){errors.push('PENGELUARAN baris '+r+': pilih ITEM dari dropdown.');continue}
   if(clTemplateBlank(rawQty)){errors.push('PENGELUARAN baris '+r+': JUMLAH wajib diisi.');continue}
   const qty=clTemplateNumber(rawQty);
   if(qty===null||!Number.isFinite(qty)||qty<=0){errors.push('PENGELUARAN baris '+r+': JUMLAH harus angka lebih besar dari 0.');continue}
   if(!cats.includes(category)){errors.push('PENGELUARAN baris '+r+': pilih KATEGORI dari dropdown Barapp.');continue}
   const option=listByLabel.get(label);
   if(!option){errors.push('PENGELUARAN baris '+r+': ITEM tidak dikenal. Pilih dari dropdown master Barapp.');continue}
   const key=option.type+':'+option.id+':'+category;
   if(expenseSeen.has(key)){errors.push('PENGELUARAN: item dan kategori yang sama hanya boleh dicatat satu kali per template. Gabungkan kuantitas pada satu baris.');continue}
   expenseSeen.add(key);
   let target=null,notes='';
   if(category==='Move'){
    if(!targetName){errors.push('PENGELUARAN baris '+r+': TUJUAN wajib dipilih untuk kategori Move.');continue}
    const destinations=(c.divisions||[]).filter(d=>String(d.name||'').trim().toLocaleLowerCase()===targetName.toLocaleLowerCase());
    if(destinations.length!==1){errors.push('PENGELUARAN baris '+r+': TUJUAN harus dipilih dari dropdown divisi aktif dalam outlet yang sama.');continue}
    target=destinations[0].id;
   }else if(targetName){
    errors.push('PENGELUARAN baris '+r+': TUJUAN hanya boleh diisi untuk kategori Move.');continue;
   }
   if(option.type==='wip'){
    const w=(CG.wips||[]).find(x=>String(x.id)===option.id&&String(x.division_id)===String(CL.division)&&x.active===true);
    if(!w||String(w.yield_unit||'').toLowerCase()!==option.unit.toLowerCase()){errors.push('PENGELUARAN baris '+r+': WIP atau satuannya tidak sesuai master.');continue}
    p.stock_out.push({item_type:'wip',item_id:null,wip_id:option.id,qty:qty,unit:option.unit,category:category,target_division_id:target,notes:notes});
   }else{
    const item=(INV.items||[]).find(x=>String(x.id)===option.id&&String(x.division_id)===String(CL.division)&&x.active===true);
    if(!item||!Array.isArray(item.conversions)||!item.conversions.some(cv=>String(cv.unit||'').toLowerCase()===option.unit.toLowerCase()&&Number(cv.factor)>0)){errors.push('PENGELUARAN baris '+r+': item atau satuan tidak sesuai master.');continue}
    p.stock_out.push({item_type:'material',item_id:option.id,wip_id:null,qty:qty,unit:option.unit,category:category,target_division_id:target,notes:notes});
   }
  }
  if(!p.daily_so.length&&!p.stock_in.length&&!p.stock_out.length&&!p.production.length&&!p.supplies.length)errors.push('Tidak ada data untuk diimpor. Isi minimal satu nilai MASUK, AKHIR, PRODUKSI, atau PENGELUARAN.');
  const importLimits=[['Daily SO',p.daily_so.length,1000],['Barang Masuk',p.stock_in.length,1000],['Pengeluaran',p.stock_out.length,1000],['Produksi WIP',p.production.length,200],['Supplies',p.supplies.length,1000]];
  importLimits.forEach(([label,count,max])=>{if(count>max)errors.push(label+': maksimal '+max+' baris transaksi per impor.')});
  errors.push(...clTemplatePermissions(p));
  errors.push(...clTemplateDateConflict(p));
  const counts=[
   ['Daily SO',p.daily_so.length,'item yang dihitung (AKHIR)'],
   ['Barang Masuk',p.stock_in.length,'baris dengan MASUK lebih dari 0'],
   ['Produksi WIP',p.production.length,'hasil produksi yang terkonversi ke batch'],
   ['Pengeluaran',p.stock_out.length,'baris pengeluaran valid, maksimal 25'],
   ['Supplies',p.supplies.length,'item supplies yang dihitung (AKHIR)']
  ];
  CL.templateDraft={templateId:meta.TEMPLATE_ID||'',payload:p,errors:[...new Set(errors)],warnings:warnings,counts:counts,fileName:file.name,serverError:'',busy:false};clRenderTemplatePreview();
 }catch(e){CL.templateDraft={templateId:'',payload:null,errors:['Gagal membaca file Excel: '+String(e?.message||e)],warnings:[],counts:[],fileName:file.name,serverError:'',busy:false};clRenderTemplatePreview()}
}
function clRenderTemplatePreview(){
 const d=CL.templateDraft;if(!d)return;
 const errors=d.errors||[],summary=(d.counts||[]).map(x=>'<tr><td style="padding:8px;border-bottom:1px solid var(--line)">'+esc(x[0])+'</td><td style="padding:8px;text-align:right;border-bottom:1px solid var(--line)"><b>'+x[1]+'</b></td><td style="padding:8px;border-bottom:1px solid var(--line);color:var(--mu)">'+esc(x[2])+'</td></tr>').join('');
 const errHtml=errors.length?'<div style="border:1px solid #e0a19a;background:color-mix(in srgb,#e8584f 8%,var(--cd));border-radius:12px;padding:12px;margin-top:12px"><b>Belum bisa diimpor ('+errors.length+' masalah)</b><ul style="margin:8px 0 0;padding-left:20px">'+errors.slice(0,20).map(x=>'<li style="margin:4px 0">'+esc(x)+'</li>').join('')+(errors.length>20?'<li>Dan '+(errors.length-20)+' masalah lainnya.</li>':'')+'</ul></div>':'<div style="border:1px solid #90c7a2;background:color-mix(in srgb,#32a66a 8%,var(--cd));border-radius:12px;padding:12px;margin-top:12px"><b>Validasi awal lolos</b><p class="mu" style="margin:4px 0 0">Belum ada data yang disimpan. Supabase akan memvalidasi seluruh impor kembali secara atomik.</p></div>';
 const server=d.serverError?'<div class="cl-callout"><b>Impor tidak disimpan</b><p>'+esc(d.serverError)+'</p></div>':'';
 modal('<h3>Preview impor Template Daily SO</h3><p class="mu"><b>File:</b> '+esc(d.fileName||'File Excel')+'<br><b>Divisi:</b> '+esc(clDivision(CL.division)?.name||'Divisi')+'<br><b>Tanggal target:</b> '+esc(CL.date)+'<br><b>Catatan:</b> template hanya diproses jika cocok dengan outlet, tanggal, dan master aktif. Belum ada data disimpan sebelum konfirmasi.</p><div style="overflow:auto"><table style="width:100%;border-collapse:collapse"><thead><tr><th style="text-align:left;padding:8px;border-bottom:1px solid var(--line)">Bagian</th><th style="text-align:right;padding:8px;border-bottom:1px solid var(--line)">Jumlah</th><th style="text-align:left;padding:8px;border-bottom:1px solid var(--line)">Keterangan</th></tr></thead><tbody>'+summary+'</tbody></table></div>'+errHtml+server+'<div class="btns" style="margin-top:14px"><button type="button" class="btn s" onclick="window.__clOpenTemplate()">Kembali</button><button type="button" class="btn" '+(errors.length||d.busy||!d.payload?'disabled':'')+' onclick="window.__clConfirmTemplateImport()">'+(d.busy?'Memproses impor…':'Konfirmasi & impor')+'</button></div>');
}
function clTemplateFriendlyError(e){
 const m=String(e?.message||e||'Gagal mengimpor template.'),u=m.toUpperCase(),map=[
 ['BARAPP_TEMPLATE_CLOSING_LOCKED','Tanggal closing sudah disetujui atau memerlukan rekonsiliasi. Tidak ada data yang disimpan.'],
 ['BARAPP_TEMPLATE_EXISTING_DAILY_SO','Daily SO pada tanggal ini sudah ada. Kosongkan sheet Daily SO untuk melewatinya.'],
 ['BARAPP_TEMPLATE_EXISTING_SUPPLIES','Daily SO Supplies pada tanggal ini sudah ada. Kosongkan sheet Supplies untuk melewatinya.'],
 ['BARAPP_TEMPLATE_EXISTING_SALES','Sudah ada transaksi Penjualan pada tanggal ini. Kosongkan sheet Penjualan agar tidak duplikat.'],
 ['BARAPP_TEMPLATE_EXISTING_STOCK_IN','Sudah ada Barang Masuk pada tanggal ini. Kosongkan sheet Barang Masuk agar tidak duplikat.'],
 ['BARAPP_TEMPLATE_EXISTING_EXPENSES','Sudah ada Pengeluaran pada tanggal ini. Kosongkan sheet Pengeluaran agar tidak duplikat.'],
 ['BARAPP_TEMPLATE_EXISTING_PRODUCTION','Sudah ada Produksi WIP pada tanggal ini. Kosongkan sheet Produksi WIP agar tidak duplikat.'],
 ['BARAPP_TEMPLATE_EXISTING_OPENING_WIP','Sudah ada stok awal WIP pada tanggal ini. Kosongkan baris WIP di sheet Barang Masuk.'],
 ['BARAPP_TEMPLATE_INVALID_UNIT','Satuan tidak sesuai konversi Master Barang. Unduh template baru atau perbaiki satuan.'],
 ['BARAPP_TEMPLATE_TARGET_CLOSING_LOCKED','Divisi penerima Move sudah closing pada tanggal ini. Pilih divisi tujuan lain atau hapus Move.'],
 ['BARAPP_TEMPLATE_INVALID_MOVE_TARGET','Tujuan Move tidak valid atau tidak dapat diakses.'],
 ['BARAPP_TEMPLATE_DUPLICATE_EXPENSE_ITEM','Satu item hanya boleh memiliki satu baris Pengeluaran per workbook.'],
 ['BARAPP_TEMPLATE_DAILY_SO_FORBIDDEN','Akun tidak memiliki izin untuk menyimpan Daily SO.'],
 ['BARAPP_TEMPLATE_SALES_FORBIDDEN','Akun tidak memiliki izin untuk menyimpan Penjualan.'],
 ['BARAPP_TEMPLATE_PRODUCTION_FORBIDDEN','Akun tidak memiliki izin untuk menyimpan Produksi WIP.'],
 ['BARAPP_TEMPLATE_SUPPLIES_FORBIDDEN','Akun tidak memiliki izin untuk menyimpan Supplies.'],
 ['BARAPP_TEMPLATE_STOCK_IN_FORBIDDEN','Akun tidak memiliki izin Barang Masuk.'],
 ['BARAPP_TEMPLATE_EXPENSES_FORBIDDEN','Akun tidak memiliki izin Pengeluaran.'],
 ['BARAPP_TEMPLATE_EMPTY_IMPORT','Tidak ada data transaksi untuk diimpor.'],
 ['BARAPP_TEMPLATE_TOO_MANY_ROWS','Jumlah baris melebihi batas impor salah satu sheet. Kurangi jumlah baris lalu coba lagi.'],
 ['BARAPP_TEMPLATE_INVALID_DATE','Tanggal target tidak valid atau berada di masa depan.'],
 ['BARAPP_TEMPLATE_INVALID_PAYLOAD','Payload template tidak valid. Unduh ulang file template.'],
 ['BARAPP_TEMPLATE_INVALID_SUPPLIES_ROW','Jumlah Supplies atau daftar item tidak valid. Periksa semua kuantitas Supplies.'],
 ['COGS_SO_ALREADY_SUBMITTED','Daily SO sudah tersimpan. Impor dibatalkan seluruhnya.'],
 ['COGS_SO_MUST_COUNT_ALL_ITEMS','Daftar item Daily SO tidak lengkap. Impor dibatalkan seluruhnya.'],
 ['SUPPLIES_SO_ALREADY_SUBMITTED','Daily SO Supplies sudah tersimpan. Impor dibatalkan seluruhnya.']
 ];for(const pair of map)if(u.includes(pair[0]))return pair[1];
 if(/UNIQUE|DUPLICATE KEY/.test(u))return 'Template atau data untuk tanggal ini pernah berhasil diimpor. Tidak ada data baru yang disimpan.';
 if(/42501|FORBIDDEN|ACCESS_DENIED|PERMISSION_DENIED/.test(u))return 'Akses tidak mencukupi untuk salah satu sheet. Periksa izin akun dan modul divisi.';
 if(/COGS_|SUPPLIES_|INVALID_STOCK|INVALID_|ITEM_NOT_FOUND/.test(u))return 'Validasi database gagal: '+m+'. Semua perubahan dibatalkan oleh transaksi database.';return m;
}
async function clConfirmTemplateImport(){
 const d=CL.templateDraft;if(!d||!d.payload||d.errors?.length||CL.busy||d.busy)return;if(CL.period&&['approved','needs_reconciliation'].includes(CL.period.status))return toast('Tanggal closing terkunci.','warn');
 if(!confirm('Impor Template Daily SO untuk '+(clDivision(CL.division)?.name||'divisi')+' pada '+CL.date+'? Semua bagian yang terisi akan ditambahkan. Jika satu bagian gagal, seluruh impor dibatalkan.'))return;
 d.busy=true;CL.busy='template-import';clRenderTemplatePreview();
 try{
  const {data,error}=await sb().rpc('barapp_closing_import_template',{p_division_id:CL.division,p_target_date:CL.date,p_template_id:d.templateId,p_payload:d.payload});if(error)throw error;
  const z=data?.summary||{};d.busy=false;CL.busy='';CL.templateDraft=null;CL.ready=false;CG.ready=false;INV.ready=false;await load(true);
  toast('Impor Template Daily SO berhasil untuk '+CL.date+'. Daily SO '+(z.daily_so||0)+', Barang Masuk '+((z.stock_in||0)+(z.opening_wip||0))+', Pengeluaran '+(z.stock_out||0)+', Produksi WIP '+(z.production||0)+', Supplies '+(z.supplies||0)+'.','ok');
 }catch(e){d.busy=false;CL.busy='';d.serverError=clTemplateFriendlyError(e);clRenderTemplatePreview()}
}
window.__clOpenTemplate=clOpenTemplateDialog;window.__clDownloadTemplate=clDownloadTemplate;window.__clPreviewTemplateImport=clPreviewTemplateImport;window.__clConfirmTemplateImport=clConfirmTemplateImport;

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
 return '<div class="cogs-wrap"><style>.cl-top-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap}.cl-top-actions .btn{white-space:nowrap}.cl-filter{display:grid;grid-template-columns:1fr 1fr;gap:10px}.cl-filter label{min-width:0}.cl-module{padding:14px;margin-bottom:10px}.cl-module-head{display:flex;align-items:flex-start;gap:12px}.cl-status{width:34px;height:34px;display:grid;place-items:center;flex:none;border-radius:11px;font-size:18px;font-weight:800;background:var(--in);border:1px solid var(--line)}.cl-status.good{color:#167443;background:#e0f4e7;border-color:#8bc9a0}.cl-status.warn{color:#946200;background:#fff2c7;border-color:#e3c45e}.cl-status.bad{color:#bd5549;background:#fde8e5;border-color:#e5a49c}.cl-actions .btn[disabled]{opacity:.78;cursor:not-allowed;background:#e0f4e7;color:#167443;border-color:#8bc9a0}.cl-module-info{min-width:0;flex:1;display:grid;gap:5px}.cl-module-info b{font-size:15px}.cl-module-info small{color:var(--mu);line-height:1.4}.cl-module-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;border-top:1px solid var(--line);padding-top:10px;margin-top:12px}.cl-actions{display:flex;gap:6px;flex-wrap:wrap}.cl-summary{display:grid;grid-template-columns:1fr 1fr;gap:10px}.cl-summary>div{background:var(--in);border:1px solid var(--line);border-radius:14px;padding:12px}.cl-summary small{display:block;color:var(--mu)}.cl-summary b{display:block;font-size:17px;margin-top:4px}.cl-callout{border:1px solid var(--line);border-radius:14px;padding:12px;background:var(--in);margin:12px 0}.cl-callout p{margin:4px 0 0;color:var(--mu);font-size:12px}@media(max-width:520px){.cl-top-actions{width:100%;justify-content:stretch}.cl-top-actions .btn{flex:1}.cl-filter{grid-template-columns:1fr}.cl-module-foot{align-items:flex-start}.cl-actions{width:100%}.cl-actions .btn{flex:1}}</style><div class="card"><div class="cogs-top"><div><h3>Approval Closing</h3><p class="mu">Konfirmasi modul operasional yang aktif untuk divisi ini, rekonsiliasi data, lalu setujui snapshot closing harian.</p></div><div class="cl-top-actions"><button class="btn s" type="button" onclick="window.__clOpenTemplate()">Template Daily SO</button><button class="btn s" onclick="window.__clReload()">Muat ulang</button></div></div><div class="cl-filter"><label>Divisi<select onchange="window.__clFilter(\'division\',this.value)">'+divs.map(d=>'<option value="'+d.id+'" '+(String(d.id)===String(CL.division)?'selected':'')+'>'+esc(d.name)+'</option>').join('')+'</select></label><label>Tanggal closing<input type="date" max="'+clToday()+'" value="'+esc(CL.date)+'" onchange="window.__clFilter(\'date\',this.value)"></label></div><div class="cl-summary"><div><small>Divisi / periode</small><b>'+esc(divName)+'</b><small>'+esc(CL.date)+'</small></div><div><small>Status closing</small><b>'+esc(label)+'</b><small>'+activeModules.filter(m=>{const x=state(m);return x.saved&&x.fresh}).length+' / '+activeModules.length+' modul terkonfirmasi</small></div></div><div class="cl-callout"><b>Aturan closing</b><p>Modul kosong harus dikonfirmasi. Data yang berubah setelah konfirmasi wajib dikonfirmasi ulang. Approval memvalidasi snapshot modul aktif dan menghitung ulang saldo Daily SO bila modul itu aktif.</p></div></div><div class="card"><h3>Checklist modul</h3>'+cards+'</div><div class="card"><h3>Ringkasan sebelum approval</h3><p class="mu">Semua modul aktif harus dikonfirmasi dengan snapshot yang masih sama.</p><div class="cl-summary"><div><small>Rekaman Daily SO</small><b>'+(clModuleOn(CL.division,'cogs_daily_so')?count('daily_so',CL.division,CL.date):'Tidak digunakan')+'</b></div><div><small>Validasi</small><b>'+(approved?'Final':ready?'Siap diperiksa':'Belum lengkap')+'</b></div></div><div class="btns" style="margin-top:14px"><button class="btn s" onclick="window.__clReload()" '+(CL.busy?'disabled':'')+'>Validasi & muat ulang</button><button class="btn" onclick="window.__clApprove()" '+(!ready||approved||CL.busy?'disabled':'')+'>'+(CL.busy==='approve'?'Memproses…':approved?'Closing Approved':'Approval Closing')+'</button></div>'+(approved?'<p class="mu">Disetujui pada '+esc(new Date(CL.period.approved_at).toLocaleString('id-ID'))+'. Perubahan transaksi berikutnya harus melalui rekonsiliasi.</p>':'')+'</div><div class="card"><div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px"><h3 style="margin:0">Riwayat closing divisi</h3></div><div class="cogs-scroll"><table class="cogs-table"><thead><tr><th>Tanggal</th><th>Status</th><th>Waktu approval</th><th>Detail / Unduh</th></tr></thead><tbody>'+(history||'<tr><td colspan="4" class="mu">Belum ada riwayat closing.</td></tr>')+'</tbody></table></div></div></div>';
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