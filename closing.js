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
function clTemplateDateValue(v){if(v instanceof Date&&!Number.isNaN(v.getTime()))return v.toISOString().slice(0,10);if(typeof v==='number'&&Number.isFinite(v)&&v>=1&&v<100000){const d=new Date(Date.UTC(1899,11,30)+Math.round(v)*86400000);if(!Number.isNaN(d.getTime()))return d.toISOString().slice(0,10)}const s=String(v??'').trim();if(/^\d{4}-\d{2}-\d{2}$/.test(s))return s;return s}
function clTemplateNumber(v){if(typeof v==='number')return Number.isFinite(v)?v:NaN;if(clTemplateBlank(v))return null;const n=Number(String(v).trim().replace(/\s/g,'').replace(',','.'));return Number.isFinite(n)?n:NaN}
function clTemplateSameSet(actual,expected){if(actual.length!==expected.length)return false;const a=new Set(actual),e=new Set(expected);return a.size===actual.length&&e.size===expected.length&&actual.every(x=>e.has(x))}
function clTemplateCatalog(){
 const div=String(CL.division),date=String(CL.date),ii=(INV.items||[]).filter(x=>String(x.division_id)===div&&x.active===true).sort((a,b)=>invAlpha(a.name,b.name));
 const materials=ii.filter(x=>!x.is_supply),supplies=ii.filter(x=>x.is_supply===true&&String(x.created_at||'0000-01-01').slice(0,10)<=date),wips=(CG.wips||[]).filter(x=>String(x.division_id)===div&&x.active===true).sort((a,b)=>invAlpha(a.name,b.name)),menus=(CG.menus||[]).filter(x=>String(x.division_id)===div&&x.active===true).sort((a,b)=>invAlpha(a.name,b.name));
 const wd=clModuleOn(div,'cogs_wip'),sales=clModuleOn(div,'cogs_sales'),production=clModuleOn(div,'cogs_production'),supply=clModuleOn(div,'supplies'),daily=clModuleOn(div,'cogs_daily_so'),row=(id,type,name,unit)=>({id:String(id),type:type,name:String(name||''),unit:String(unit||'UNIT')});
 return {
  daily:daily?materials.map(x=>row(x.id,'material',x.name,x.base_unit)).concat(wd?wips.map(x=>row(x.id,'wip',x.name,x.yield_unit)):[]):[],
  sales:sales?menus.map(x=>row(x.id,'menu',x.name,'')):[],
  incoming:materials.concat(supplies).map(x=>row(x.id,'material',x.name,x.base_unit)).concat(production?wips.map(x=>row(x.id,'wip',x.name,x.yield_unit)):[]),
  expenses:materials.concat(supplies).map(x=>row(x.id,'material',x.name,x.base_unit)).concat(wd?wips.map(x=>row(x.id,'wip',x.name,x.yield_unit)):[]),
  production:production?wips.map(x=>row(x.id,'wip',x.name,x.yield_unit)):[],
  supplies:supply?supplies.map(x=>row(x.id,'supply',x.name,x.base_unit)):[],
  divisions:(()=>{const current=clDivision(div),outlet=current&&current.outlet_id,all=[...(INV.divs||[]),...(CG.divs||[])],map=new Map();all.forEach(d=>{if(d&&d.id&&d.active!==false&&String(d.id)!==div&&(!outlet||String(d.outlet_id)===String(outlet)))map.set(String(d.id),d)});return[...map.values()].sort((a,b)=>invAlpha(a.name,b.name))})()
 };
}
function clTemplatePermissions(payload){if(isDeveloper()||!payload)return[];const out=[],req=(cond,key,label)=>{if(cond&&!hasFeature(key))out.push('Akun belum memiliki izin '+label+'.')};req(payload.daily_so?.length,'cogs.daily_so.edit','edit Daily SO');req(payload.sales?.length,'cogs.sales.manage','input Penjualan');req(payload.production?.length,'cogs.production.manage','input Produksi WIP');const invWrite=!!(payload.stock_in?.length||payload.stock_out?.length||payload.supplies?.length);req(invWrite,'inventory.view','lihat Inventory');req(invWrite,'inventory.manage','mengelola Inventory');if(payload.opening_wip?.length&&!hasFeature('inventory.inbound.manage')&&!hasFeature('cogs.production.manage'))out.push('Akun belum memiliki izin stok awal WIP.');return[...new Set(out)]}
function clTemplateWorksheet(wb,name,headers,rows,widths,hiddenCols){
 const ws=XLSX.utils.aoa_to_sheet([headers].concat(rows));
 ws['!cols']=headers.map((h,i)=>({wch:widths[i]||18,hidden:(hiddenCols||[]).includes(i)}));
 if(rows.length)ws['!autofilter']={ref:XLSX.utils.encode_range({s:{r:0,c:0},e:{r:rows.length,c:headers.length-1}})};
 ws['!freeze']={xSplit:0,ySplit:1,topLeftCell:'A2',activePane:'bottomLeft',state:'frozen'};
 for(let c=0;c<headers.length;c++){const cell=ws[XLSX.utils.encode_cell({r:0,c:c})];if(cell)cell.s={font:{bold:true,color:{rgb:'FFFFFF'}},fill:{fgColor:{rgb:'42594A'}},alignment:{vertical:'center',wrapText:true}}}
 ws['!rows']=[{hpt:30}];XLSX.utils.book_append_sheet(wb,ws,name);
}
function clOpenTemplateDialog(){
 if(!clCanAccess())return toast('Approval Closing hanya tersedia untuk Developer dan Admin Divisi.','warn');
 if(!window.XLSX)return toast('Modul Excel belum siap. Muat ulang halaman lalu coba lagi.','warn');
 if(CL.period&&['approved','needs_reconciliation'].includes(CL.period.status))return toast('Closing sudah final atau memerlukan rekonsiliasi. Impor template dikunci untuk tanggal ini.','warn');
 modal('<h3>Template Daily SO & Operasional</h3><p class="mu">Outlet/divisi: <b>'+esc(clDivision(CL.division)?.name||'Divisi')+'</b><br>Tanggal target: <b>'+esc(CL.date)+'</b></p><p class="mu">Satu workbook berisi enam sheet dengan daftar master yang sudah terisi. Isi hanya kuantitas dan kategori yang diperlukan. Upload tidak menimpa transaksi yang sudah ada.</p><div class="btns"><button class="btn" type="button" onclick="window.__clDownloadTemplate()">Unduh template Excel</button><label class="btn s" style="display:inline-flex;align-items:center;gap:8px;cursor:pointer">Pilih file untuk upload<input id="cl_template_file" type="file" accept=".xlsx,.xls" style="display:none" onchange="window.__clPreviewTemplateImport(this)"></label></div><p class="mu" style="font-size:12px">Gunakan file template asli agar ID item dan metadata tanggal tetap terbawa. Sheet yang tidak diisi dilewati; sheet yang sudah punya transaksi pada tanggal target tidak bisa diimpor ulang.</p>');
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
  wb.creator='Barapp';wb.subject='Template Approval Closing';wb.title='Template Operasional Barapp';
  const meta=wb.addWorksheet('_META');
  [
   ['FIELD','VALUE'],
   ['VERSION','BARAPP_CLOSING_TEMPLATE_V2'],
   ['TEMPLATE_ID',clTemplateId()],
   ['DIVISION_ID',String(CL.division)],
   ['DIVISION_NAME',String(clDivision(CL.division)?.name||'')],
   ['OUTLET_ID',String(clDivision(CL.division)?.outlet_id||'')],
   ['TARGET_DATE',String(CL.date)],
   ['GENERATED_AT',new Date().toISOString()],
   ['INSTRUCTIONS','Tanggal target ditampilkan pada kolom TANGGAL_TARGET di setiap sheet. Jangan ubah tanggal, nama sheet, atau kolom ID tersembunyi. Kosongkan kuantitas pada sheet yang tidak ingin diimpor. Daily SO dan Supplies harus lengkap jika digunakan.']
  ].forEach(r=>meta.addRow(r));
  meta.state='hidden';
  const makeSheet=(name,headers,rows,widths,hiddenCols=[])=>{
   const ws=wb.addWorksheet(name);
   ws.addRow(headers);rows.forEach(row=>ws.addRow(row));
   ws.views=[{state:'frozen',ySplit:1}];
   ws.autoFilter={from:'A1',to:clExcelColumnName(headers.length)+Math.max(1,rows.length+1)};
   ws.getRow(1).height=32;
   ws.getRow(1).eachCell(cell=>{
    cell.font={bold:true,color:{argb:'FFFFFFFF'}};
    cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF42594A'}};
    cell.alignment={vertical:'middle',wrapText:true};
   });
   headers.forEach((_,i)=>{
    const col=ws.getColumn(i+1);col.width=widths[i]||18;col.hidden=hiddenCols.includes(i+1);
   });
   for(let r=2;r<=rows.length+1;r++)ws.getCell(r,1).numFmt='@';
   return ws;
  };
  makeSheet('Daily SO',['TANGGAL_TARGET','ITEM','SATUAN','QTY_AKTUAL','__ITEM_ID','__ITEM_TYPE'],
   c.daily.map(x=>[String(CL.date),x.name,x.unit,'',x.id,x.type]),[17,32,14,18,38,16],[5,6]);
  makeSheet('Penjualan',['TANGGAL_TARGET','MENU','QTY_TERJUAL','HARGA_JUAL_OPSIONAL','__MENU_ID'],
   c.sales.map(x=>[String(CL.date),x.name,'','',x.id]),[17,34,18,24,38],[5]);
  makeSheet('Barang Masuk',['TANGGAL_TARGET','ITEM','SATUAN','QTY_MASUK','TOTAL_INVOICE_OPSIONAL','CATATAN','__ITEM_ID','__ITEM_TYPE'],
   c.incoming.map(x=>[String(CL.date),x.name,x.unit,'','','',x.id,x.type]),[17,32,14,16,24,36,38,16],[7,8]);
  const expenseRows=c.expenses.map(x=>[String(CL.date),x.name,x.unit,'','','','',x.id,x.type]);
  const expenseSheet=makeSheet('Pengeluaran',['TANGGAL_TARGET','ITEM','SATUAN','QTY_KELUAR','KATEGORI','DIVISI_TUJUAN','CATATAN','__ITEM_ID','__ITEM_TYPE'],
   expenseRows,[17,32,14,16,20,28,36,38,16],[8,9]);
  makeSheet('Produksi WIP',['TANGGAL_TARGET','WIP','HASIL_PER_BATCH','SATUAN_HASIL','JUMLAH_BATCH','__WIP_ID'],
   c.production.map(x=>[String(CL.date),x.name,Number((CG.wips||[]).find(w=>String(w.id)===x.id)?.yield_qty||1),x.unit,'',x.id]),[17,32,18,18,18,38],[6]);
  makeSheet('Supplies',['TANGGAL_TARGET','ITEM','SATUAN','QTY_AKTUAL','__ITEM_ID'],
   c.supplies.map(x=>[String(CL.date),x.name,x.unit,'',x.id]),[17,32,14,18,38],[5]);

  const lists=wb.addWorksheet('_LISTS');
  lists.addRow(['DIVISI_TUJUAN']);c.divisions.forEach(d=>lists.addRow([String(d.name||'').trim()]));
  lists.state='hidden';
  const destinationNames=c.divisions.map(d=>String(d.name||'').trim());
  if(destinationNames.length&&wb.definedNames&&typeof wb.definedNames.add==='function'){
   wb.definedNames.add('_LISTS!$A$2:$A$'+(destinationNames.length+1),'DivisionList');
  }
  const categories=destinationNames.length?['Waste','QC','R&D','Kalibrasi','Lainnya','Move']:['Waste','QC','R&D','Kalibrasi','Lainnya'];
  const categoryFormula='"'+categories.join(',')+'"';
  const canUseInline=destinationNames.length>0&&destinationNames.every(n=>n&&!n.includes(',')&&!n.includes('"'))&&('"'+destinationNames.join(',')+'"').length<=250;
  const divisionFormula=canUseInline?'"'+destinationNames.join(',')+'"':'=DivisionList';
  for(let row=2;row<=expenseRows.length+1;row++){
   expenseSheet.getCell(row,5).dataValidation={
    type:'list',allowBlank:true,formulae:[categoryFormula],
    showErrorMessage:true,errorStyle:'stop',errorTitle:'Kategori tidak valid',
    error:'Pilih kategori dari dropdown yang tersedia.'
   };
   if(destinationNames.length)expenseSheet.getCell(row,6).dataValidation={
    type:'list',allowBlank:true,formulae:[divisionFormula],
    showErrorMessage:true,errorStyle:'stop',errorTitle:'Tujuan divisi tidak valid',
    error:'Pilih nama divisi tujuan dari dropdown. Tujuan hanya dipakai untuk kategori Move.'
   };
  }
  const buffer=await wb.xlsx.writeBuffer();
  const blob=new Blob([buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download='Template-Operasional-'+(String(clDivision(CL.division)?.name||'Divisi').replace(/[^a-z0-9]+/gi,'-').replace(/^-|-$/g,'')||'Divisi')+'-'+CL.date+'.xlsx';
  document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
  CL.templateDraft=null;
  toast('Template diunduh: kategori dan tujuan divisi punya dropdown, tanggal target tampak di kolom pertama.','ok');
 }catch(e){
  toast('Gagal membuat template Excel: '+String(e&&e.message||e),'err');
 }
}
function clTemplateHeaderIndex(headers){const o={};(headers||[]).forEach((h,i)=>{const k=String(h??'').trim().toUpperCase();if(k)o[k]=i});return o}
function clTemplateCell(row,hi,key){return hi[key]===undefined?'':row[hi[key]]}
function clTemplateRows(wb,sheet,required,errors){
 const ws=wb.Sheets[sheet];if(!ws){errors.push(sheet+': sheet wajib tidak ditemukan.');return{headers:[],rows:[]}}
 const matrix=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:true});if(!matrix.length){errors.push(sheet+': sheet kosong atau header hilang.');return{headers:[],rows:[]}}
 const headers=matrix[0].map(h=>String(h??'').trim().toUpperCase()),hi=clTemplateHeaderIndex(headers);required.forEach(k=>{if(hi[k]===undefined)errors.push(sheet+': kolom '+k+' tidak ditemukan.')});
 const rows=[];for(let i=1;i<matrix.length;i++){const row=matrix[i]||[];if(row.every(clTemplateBlank))continue;rows.push({line:i+1,row:row,hi:hi})}if(required.includes('TANGGAL_TARGET'))rows.forEach(r=>{const target=String(clTemplateCell(r.row,r.hi,'TANGGAL_TARGET')||'').trim();if(clTemplateDateValue(clTemplateCell(r.row,r.hi,'TANGGAL_TARGET'))!==String(CL.date))errors.push(sheet+' baris '+r.line+': TANGGAL_TARGET harus '+String(CL.date)+'. Unduh ulang template jika tanggal target berubah.')});return{headers:headers,rows:rows};
}
function clTemplateCompareCatalog(sheet,rows,expected,idKey,typeKey,errors){
 const actual=[];rows.forEach(r=>{const id=String(clTemplateCell(r.row,r.hi,idKey)||'').trim(),type=typeKey?String(clTemplateCell(r.row,r.hi,typeKey)||'').trim():'';if(!id){if(!r.row.every(clTemplateBlank))errors.push(sheet+' baris '+r.line+': ID tersembunyi hilang. Gunakan file template asli.');return}actual.push(typeKey?(type+':'+id):id)});
 const wanted=expected.map(x=>typeKey?(x.type+':'+x.id):x.id);if(!clTemplateSameSet(actual,wanted))errors.push(sheet+': daftar item/menu berubah atau kolom ID rusak. Unduh template baru agar semua item aktif tetap lengkap.');
}
function clTemplateCompareMasterValues(sheet,rows,getMaster,fields,errors){
 rows.forEach(r=>{
  const master=getMaster(r);if(!master)return;
  fields.forEach(field=>{
   const actual=clTemplateCell(r.row,r.hi,field.header),expected=field.get(master);
   let matches;
   if(field.number){const n=clTemplateNumber(actual);matches=n!==null&&Number.isFinite(n)&&Number(n)===Number(expected)}
   else matches=String(actual??'').trim().toLocaleLowerCase()===String(expected??'').trim().toLocaleLowerCase();
   if(!matches)errors.push(sheet+' baris '+r.line+': '+field.label+' berubah atau tidak sesuai Master terbaru. Unduh ulang template sebelum impor.');
  });
 });
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
 const file=input&&input.files&&input.files[0];if(!file)return;if(!clCanAccess())return toast('Akses ditolak.','warn');if(!window.XLSX)return toast('Modul Excel belum siap.','warn');if(file.size>15*1024*1024)return toast('Ukuran file terlalu besar. Maksimal 15 MB.','warn');
 modal('<h3>Memeriksa workbook…</h3><p class="mu">Mengecek enam sheet, daftar master, tanggal, dan potensi duplikasi. Belum ada data yang disimpan.</p>');
 const errors=[],warnings=[];
 try{
  await Promise.all([cgLoad(false),invLoad(false)]);
  const {data:period,error:pe}=await sb().from('barapp_closing_periods').select('id,status').eq('division_id',CL.division).eq('closing_date',CL.date).maybeSingle();if(pe)throw pe;CL.period=period?Object.assign({},CL.period||{},period):null;
  const wb=XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:false}),must=['Daily SO','Penjualan','Barang Masuk','Pengeluaran','Produksi WIP','Supplies'];
  must.forEach(n=>{if(!wb.Sheets[n])errors.push('Sheet '+n+' wajib tersedia. Jangan menghapus atau mengganti nama sheet.')});if(!wb.Sheets._META)errors.push('Metadata template tidak ditemukan. Unduh template baru dari Approval Closing.');
  let meta={};if(wb.Sheets._META){const a=XLSX.utils.sheet_to_json(wb.Sheets._META,{header:1,defval:'',raw:true});a.slice(1).forEach(r=>{const k=String(r[0]||'').trim().toUpperCase();if(k)meta[k]=k==='TARGET_DATE'?clTemplateDateValue(r[1]):String(r[1]??'').trim()})}
  if(meta.VERSION!=='BARAPP_CLOSING_TEMPLATE_V2')errors.push('Versi template tidak dikenal. Unduh template terbaru.');
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(meta.TEMPLATE_ID||''))errors.push('ID template tidak valid. Unduh template terbaru.');
  if(String(meta.DIVISION_ID||'')!==String(CL.division))errors.push('Template dibuat untuk divisi berbeda. Sesuaikan pilihan divisi atau unduh ulang.');
  if(String(meta.TARGET_DATE||'')!==String(CL.date))errors.push('Tanggal pada template berbeda dari tanggal closing terpilih. Pilih tanggal yang benar atau unduh ulang template.');
  if(meta.OUTLET_ID&&String(meta.OUTLET_ID)!==String(clDivision(CL.division)?.outlet_id||''))errors.push('Template berasal dari outlet berbeda.');
  if(CL.period&&['approved','needs_reconciliation'].includes(CL.period.status))errors.push('Closing tanggal ini sudah final atau memerlukan rekonsiliasi. Impor ditolak.');
  if(!CG.ready)throw new Error(CG.err||'Data master COGS belum berhasil dimuat.');if(!INV.ready)throw new Error(INV.err||'Data master barang belum berhasil dimuat.');
  const c=clTemplateCatalog(),p={daily_so:[],sales:[],stock_in:[],opening_wip:[],stock_out:[],production:[],supplies:[]};
  const dso=clTemplateRows(wb,'Daily SO',['TANGGAL_TARGET','ITEM','SATUAN','QTY_AKTUAL','__ITEM_ID','__ITEM_TYPE'],errors);clTemplateCompareCatalog('Daily SO',dso.rows,c.daily,'__ITEM_ID','__ITEM_TYPE',errors);
  const dailyByKey=new Map(c.daily.map(x=>[x.type+':'+x.id,x]));clTemplateCompareMasterValues('Daily SO',dso.rows,r=>dailyByKey.get(String(clTemplateCell(r.row,r.hi,'__ITEM_TYPE')||'').trim()+':'+String(clTemplateCell(r.row,r.hi,'__ITEM_ID')||'').trim()),[{header:'ITEM',label:'Nama item',get:x=>x.name},{header:'SATUAN',label:'Satuan dasar',get:x=>x.unit}],errors);
  const dsoRows=[];let dsoTouched=false;dso.rows.forEach(r=>{const raw=clTemplateCell(r.row,r.hi,'QTY_AKTUAL');if(!clTemplateBlank(raw))dsoTouched=true;const q=clTemplateNumber(raw),id=String(clTemplateCell(r.row,r.hi,'__ITEM_ID')||'').trim(),type=String(clTemplateCell(r.row,r.hi,'__ITEM_TYPE')||'').trim();if(!clTemplateBlank(raw)){if(q===null||!Number.isFinite(q)||q<0)errors.push('Daily SO baris '+r.line+': QTY_AKTUAL harus angka 0 atau lebih.');else dsoRows.push({item_id:id,item_type:type,qty:q})}});
  if(dsoTouched){if(dsoRows.length!==c.daily.length)errors.push('Daily SO: jika sheet ini dipakai, isi kuantitas aktual untuk semua item dan WIP, termasuk 0.');else p.daily_so=dsoRows}
  const sale=clTemplateRows(wb,'Penjualan',['TANGGAL_TARGET','MENU','QTY_TERJUAL','HARGA_JUAL_OPSIONAL','__MENU_ID'],errors);clTemplateCompareCatalog('Penjualan',sale.rows,c.sales,'__MENU_ID',null,errors);const salesById=new Map(c.sales.map(x=>[x.id,x]));clTemplateCompareMasterValues('Penjualan',sale.rows,r=>salesById.get(String(clTemplateCell(r.row,r.hi,'__MENU_ID')||'').trim()),[{header:'MENU',label:'Nama menu',get:x=>x.name}],errors);const saleSeen=new Set();
  sale.rows.forEach(r=>{const raw=clTemplateCell(r.row,r.hi,'QTY_TERJUAL');if(clTemplateBlank(raw))return;const q=clTemplateNumber(raw),id=String(clTemplateCell(r.row,r.hi,'__MENU_ID')||'').trim(),pr=clTemplateCell(r.row,r.hi,'HARGA_JUAL_OPSIONAL'),price=clTemplateNumber(pr);if(q===null||!Number.isFinite(q)||q<0){errors.push('Penjualan baris '+r.line+': QTY_TERJUAL harus angka 0 atau lebih.');return}if(!q)return;if(!id){errors.push('Penjualan baris '+r.line+': ID menu hilang.');return}if(saleSeen.has(id)){errors.push('Penjualan: menu yang sama muncul lebih dari sekali.');return}saleSeen.add(id);if(!clTemplateBlank(pr)&&(price===null||!Number.isFinite(price)||price<0)){errors.push('Penjualan baris '+r.line+': harga jual opsional harus 0 atau lebih.');return}p.sales.push({menu_id:id,qty:q,selling_price:clTemplateBlank(pr)?null:price})});
  const inc=clTemplateRows(wb,'Barang Masuk',['TANGGAL_TARGET','ITEM','SATUAN','QTY_MASUK','TOTAL_INVOICE_OPSIONAL','CATATAN','__ITEM_ID','__ITEM_TYPE'],errors);clTemplateCompareCatalog('Barang Masuk',inc.rows,c.incoming,'__ITEM_ID','__ITEM_TYPE',errors);const incomingByKey=new Map(c.incoming.map(x=>[x.type+':'+x.id,x]));clTemplateCompareMasterValues('Barang Masuk',inc.rows,r=>incomingByKey.get(String(clTemplateCell(r.row,r.hi,'__ITEM_TYPE')||'').trim()+':'+String(clTemplateCell(r.row,r.hi,'__ITEM_ID')||'').trim()),[{header:'ITEM',label:'Nama item',get:x=>x.name}],errors);const incSeen=new Set();
  inc.rows.forEach(r=>{const raw=clTemplateCell(r.row,r.hi,'QTY_MASUK');if(clTemplateBlank(raw))return;const q=clTemplateNumber(raw),id=String(clTemplateCell(r.row,r.hi,'__ITEM_ID')||'').trim(),type=String(clTemplateCell(r.row,r.hi,'__ITEM_TYPE')||'').trim(),unit=String(clTemplateCell(r.row,r.hi,'SATUAN')||'').trim(),ir=clTemplateCell(r.row,r.hi,'TOTAL_INVOICE_OPSIONAL'),invoice=clTemplateNumber(ir),note=String(clTemplateCell(r.row,r.hi,'CATATAN')||'').trim();if(q===null||!Number.isFinite(q)||q<0){errors.push('Barang Masuk baris '+r.line+': QTY_MASUK harus angka 0 atau lebih.');return}if(!q)return;const key=type+':'+id;if(incSeen.has(key)){errors.push('Barang Masuk: item yang sama muncul lebih dari sekali.');return}incSeen.add(key);
   if(type==='material'){const item=(INV.items||[]).find(x=>String(x.id)===id&&String(x.division_id)===String(CL.division)&&x.active===true);if(!item||!Array.isArray(item.conversions)||!item.conversions.some(c=>String(c.unit||'').toLowerCase()===unit.toLowerCase()&&Number(c.factor)>0)){errors.push('Barang Masuk baris '+r.line+': satuan tidak valid.');return}if(!clTemplateBlank(ir)&&(invoice===null||!Number.isFinite(invoice)||invoice<0)){errors.push('Barang Masuk baris '+r.line+': total invoice opsional harus 0 atau lebih.');return}p.stock_in.push({item_id:id,qty:q,unit:unit,invoice_total:clTemplateBlank(ir)?null:invoice,notes:note})}
   else if(type==='wip'){const w=(CG.wips||[]).find(x=>String(x.id)===id&&String(x.division_id)===String(CL.division)&&x.active===true);if(!w||unit.toLowerCase()!==String(w.yield_unit||'').toLowerCase()){errors.push('Barang Masuk baris '+r.line+': WIP atau satuannya tidak sesuai master.');return}p.opening_wip.push({wip_id:id,qty:q,notes:note})}else errors.push('Barang Masuk baris '+r.line+': jenis item tidak dikenal.');
  });
  const exp=clTemplateRows(wb,'Pengeluaran',['TANGGAL_TARGET','ITEM','SATUAN','QTY_KELUAR','KATEGORI','DIVISI_TUJUAN','CATATAN','__ITEM_ID','__ITEM_TYPE'],errors);clTemplateCompareCatalog('Pengeluaran',exp.rows,c.expenses,'__ITEM_ID','__ITEM_TYPE',errors);const expenseByKey=new Map(c.expenses.map(x=>[x.type+':'+x.id,x]));clTemplateCompareMasterValues('Pengeluaran',exp.rows,r=>expenseByKey.get(String(clTemplateCell(r.row,r.hi,'__ITEM_TYPE')||'').trim()+':'+String(clTemplateCell(r.row,r.hi,'__ITEM_ID')||'').trim()),[{header:'ITEM',label:'Nama item',get:x=>x.name}],errors);const cats=['Waste','QC','R&D','Kalibrasi','Lainnya','Move'],expSeen=new Set();
  exp.rows.forEach(r=>{const raw=clTemplateCell(r.row,r.hi,'QTY_KELUAR');if(clTemplateBlank(raw))return;const q=clTemplateNumber(raw),id=String(clTemplateCell(r.row,r.hi,'__ITEM_ID')||'').trim(),type=String(clTemplateCell(r.row,r.hi,'__ITEM_TYPE')||'').trim(),unit=String(clTemplateCell(r.row,r.hi,'SATUAN')||'').trim(),cat=String(clTemplateCell(r.row,r.hi,'KATEGORI')||'').trim(),targetName=String(clTemplateCell(r.row,r.hi,'DIVISI_TUJUAN')||'').trim(),notes=String(clTemplateCell(r.row,r.hi,'CATATAN')||'').trim();if(q===null||!Number.isFinite(q)||q<0){errors.push('Pengeluaran baris '+r.line+': QTY_KELUAR harus angka 0 atau lebih.');return}if(!q)return;const key=type+':'+id;if(expSeen.has(key)){errors.push('Pengeluaran: item yang sama muncul lebih dari sekali.');return}expSeen.add(key);if(!cats.includes(cat)){errors.push('Pengeluaran baris '+r.line+': pilih kategori Waste, QC, R&D, Kalibrasi, Lainnya, atau Move.');return}
   let target=null;if(cat==='Move'){const matches=c.divisions.filter(d=>String(d.id)===targetName||String(d.name||'').trim().toLocaleLowerCase()===targetName.toLocaleLowerCase());if(matches.length!==1){errors.push('Pengeluaran baris '+r.line+': DIVISI_TUJUAN harus nama divisi lain yang unik untuk Move.');return}target=matches[0].id}else if(targetName){errors.push('Pengeluaran baris '+r.line+': DIVISI_TUJUAN hanya boleh diisi untuk Move.');return}
   if(type==='material'){const item=(INV.items||[]).find(x=>String(x.id)===id&&String(x.division_id)===String(CL.division)&&x.active===true);if(!item||!Array.isArray(item.conversions)||!item.conversions.some(c=>String(c.unit||'').toLowerCase()===unit.toLowerCase()&&Number(c.factor)>0)){errors.push('Pengeluaran baris '+r.line+': satuan tidak valid.');return}p.stock_out.push({item_type:'material',item_id:id,wip_id:null,qty:q,unit:unit,category:cat,target_division_id:target,notes:notes})}
   else if(type==='wip'){const w=(CG.wips||[]).find(x=>String(x.id)===id&&String(x.division_id)===String(CL.division)&&x.active===true);if(!w||unit.toLowerCase()!==String(w.yield_unit||'').toLowerCase()){errors.push('Pengeluaran baris '+r.line+': WIP atau satuannya tidak sesuai master.');return}p.stock_out.push({item_type:'wip',item_id:null,wip_id:id,qty:q,unit:unit,category:cat,target_division_id:target,notes:notes})}else errors.push('Pengeluaran baris '+r.line+': jenis item tidak dikenal.');
  });
  const prod=clTemplateRows(wb,'Produksi WIP',['TANGGAL_TARGET','WIP','HASIL_PER_BATCH','SATUAN_HASIL','JUMLAH_BATCH','__WIP_ID'],errors);clTemplateCompareCatalog('Produksi WIP',prod.rows,c.production,'__WIP_ID',null,errors);clTemplateCompareMasterValues('Produksi WIP',prod.rows,r=>(CG.wips||[]).find(w=>String(w.id)===String(clTemplateCell(r.row,r.hi,'__WIP_ID')||'').trim()&&String(w.division_id)===String(CL.division)&&w.active===true),[{header:'WIP',label:'Nama WIP',get:w=>w.name},{header:'HASIL_PER_BATCH',label:'Hasil per batch',number:true,get:w=>Number(w.yield_qty||1)},{header:'SATUAN_HASIL',label:'Satuan hasil',get:w=>w.yield_unit}],errors);const prodSeen=new Set();
  prod.rows.forEach(r=>{const raw=clTemplateCell(r.row,r.hi,'JUMLAH_BATCH');if(clTemplateBlank(raw))return;const n=clTemplateNumber(raw),id=String(clTemplateCell(r.row,r.hi,'__WIP_ID')||'').trim();if(n===null||!Number.isFinite(n)||n<0||Math.floor(n)!==n){errors.push('Produksi WIP baris '+r.line+': JUMLAH_BATCH harus bilangan bulat 0 atau lebih.');return}if(!n)return;if(prodSeen.has(id)){errors.push('Produksi WIP: WIP yang sama muncul lebih dari sekali.');return}prodSeen.add(id);p.production.push({wip_id:id,batches:n})});
  const sup=clTemplateRows(wb,'Supplies',['TANGGAL_TARGET','ITEM','SATUAN','QTY_AKTUAL','__ITEM_ID'],errors);clTemplateCompareCatalog('Supplies',sup.rows,c.supplies,'__ITEM_ID',null,errors);const supplyById=new Map(c.supplies.map(x=>[x.id,x]));clTemplateCompareMasterValues('Supplies',sup.rows,r=>supplyById.get(String(clTemplateCell(r.row,r.hi,'__ITEM_ID')||'').trim()),[{header:'ITEM',label:'Nama item',get:x=>x.name},{header:'SATUAN',label:'Satuan dasar',get:x=>x.unit}],errors);const supRows=[];let supTouched=false;
  sup.rows.forEach(r=>{const raw=clTemplateCell(r.row,r.hi,'QTY_AKTUAL');if(!clTemplateBlank(raw))supTouched=true;const q=clTemplateNumber(raw),id=String(clTemplateCell(r.row,r.hi,'__ITEM_ID')||'').trim();if(!clTemplateBlank(raw)){if(q===null||!Number.isFinite(q)||q<0)errors.push('Supplies baris '+r.line+': QTY_AKTUAL harus angka 0 atau lebih.');else supRows.push({item_id:id,qty:q,actual_qty_base:q})}});
  if(supTouched){if(supRows.length!==c.supplies.length)errors.push('Supplies: jika sheet ini dipakai, isi kuantitas aktual semua item, termasuk 0.');else p.supplies=supRows}
  if(!p.daily_so.length&&!p.sales.length&&!p.stock_in.length&&!p.opening_wip.length&&!p.stock_out.length&&!p.production.length&&!p.supplies.length)errors.push('Tidak ada kuantitas untuk diimpor. Isi minimal satu sheet.');
  const importLimits=[['Daily SO',p.daily_so.length,1000],['Penjualan',p.sales.length,200],['Barang Masuk',p.stock_in.length,1000],['Stok Awal WIP',p.opening_wip.length,500],['Pengeluaran',p.stock_out.length,1000],['Produksi WIP',p.production.length,200],['Supplies',p.supplies.length,1000]];
  importLimits.forEach(([label,count,max])=>{if(count>max)errors.push(label+': maksimal '+max+' baris transaksi per impor. Kurangi jumlah baris atau bagi menjadi beberapa impor yang tidak bertabrakan.');});
  errors.push(...clTemplatePermissions(p));
  errors.push(...clTemplateDateConflict(p));
  const counts=[['Daily SO',p.daily_so.length,'semua item yang dihitung'],['Penjualan',p.sales.length,'menu dengan kuantitas lebih dari 0'],['Barang Masuk',p.stock_in.length+p.opening_wip.length,'barang dan stok awal WIP'],['Pengeluaran',p.stock_out.length,'baris pengeluaran valid'],['Produksi WIP',p.production.length,'WIP dengan batch lebih dari 0'],['Supplies',p.supplies.length,'semua item jika sheet digunakan']];
  CL.templateDraft={templateId:meta.TEMPLATE_ID||'',payload:p,errors:[...new Set(errors)],warnings:warnings,counts:counts,fileName:file.name,serverError:'',busy:false};clRenderTemplatePreview();
 }catch(e){CL.templateDraft={templateId:'',payload:null,errors:['Gagal membaca file Excel: '+String(e?.message||e)],warnings:[],counts:[],fileName:file.name,serverError:'',busy:false};clRenderTemplatePreview()}
}
function clRenderTemplatePreview(){
 const d=CL.templateDraft;if(!d)return;const errors=d.errors||[],summary=(d.counts||[]).map(x=>'<tr><td style="padding:8px;border-bottom:1px solid var(--line)">'+esc(x[0])+'</td><td style="padding:8px;text-align:right;border-bottom:1px solid var(--line)"><b>'+x[1]+'</b></td><td style="padding:8px;border-bottom:1px solid var(--line);color:var(--mu)">'+esc(x[2])+'</td></tr>').join('');
 const errHtml=errors.length?'<div style="border:1px solid #e0a19a;background:color-mix(in srgb,#e8584f 8%,var(--cd));border-radius:12px;padding:12px;margin-top:12px"><b>Belum bisa diimpor ('+errors.length+' masalah)</b><ul style="margin:8px 0 0;padding-left:20px">'+errors.slice(0,20).map(x=>'<li style="margin:4px 0">'+esc(x)+'</li>').join('')+(errors.length>20?'<li>Dan '+(errors.length-20)+' masalah lainnya.</li>':'')+'</ul></div>':'<div style="border:1px solid #90c7a2;background:color-mix(in srgb,#32a66a 8%,var(--cd));border-radius:12px;padding:12px;margin-top:12px"><b>Validasi awal lolos</b><p class="mu" style="margin:4px 0 0">Belum ada data yang disimpan. Supabase akan memvalidasi seluruh impor kembali secara atomik.</p></div>';
 const server=d.serverError?'<div class="cl-callout"><b>Impor tidak disimpan</b><p>'+esc(d.serverError)+'</p></div>':'';
 modal('<h3>Preview impor template</h3><p class="mu"><b>File:</b> '+esc(d.fileName||'File Excel')+'<br><b>Divisi:</b> '+esc(clDivision(CL.division)?.name||'Divisi')+'<br><b>Tanggal target:</b> '+esc(CL.date)+'<br><b>Catatan:</b> sheet kosong dilewati; data tidak ditulis ke tanggal lain.</p><div style="overflow:auto"><table style="width:100%;border-collapse:collapse"><thead><tr><th style="text-align:left;padding:8px;border-bottom:1px solid var(--line)">Sheet</th><th style="text-align:right;padding:8px;border-bottom:1px solid var(--line)">Baris</th><th style="text-align:left;padding:8px;border-bottom:1px solid var(--line)">Keterangan</th></tr></thead><tbody>'+summary+'</tbody></table></div>'+errHtml+server+'<div class="btns" style="margin-top:14px"><button type="button" class="btn s" onclick="window.__clOpenTemplate()">Kembali</button><button type="button" class="btn" '+(errors.length||d.busy||!d.payload?'disabled':'')+' onclick="window.__clConfirmTemplateImport()">'+(d.busy?'Memproses impor…':'Konfirmasi & impor')+'</button></div>');
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
 if(!confirm('Impor data untuk '+(clDivision(CL.division)?.name||'divisi')+' pada '+CL.date+'? Sheet yang dipilih menambah transaksi baru. Jika salah satu sheet gagal, seluruh impor dibatalkan.'))return;
 d.busy=true;CL.busy='template-import';clRenderTemplatePreview();
 try{
  const {data,error}=await sb().rpc('barapp_closing_import_template',{p_division_id:CL.division,p_target_date:CL.date,p_template_id:d.templateId,p_payload:d.payload});if(error)throw error;
  const z=data?.summary||{};d.busy=false;CL.busy='';CL.templateDraft=null;CL.ready=false;CG.ready=false;INV.ready=false;await load(true);
  toast('Impor berhasil untuk '+CL.date+'. Daily SO '+(z.daily_so||0)+', Penjualan '+(z.sales||0)+', Barang Masuk '+((z.stock_in||0)+(z.opening_wip||0))+', Pengeluaran '+(z.stock_out||0)+', Produksi '+(z.production||0)+', Supplies '+(z.supplies||0)+'.','ok');
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
 const history=CL.history.map(h=>'<tr><td><b>'+esc(h.closing_date)+'</b></td><td><span class="cogs-pill '+(h.status==='approved'?'':'bad')+'">'+esc(h.status==='approved'?'Approved':h.status==='needs_reconciliation'?'Perlu rekonsiliasi':h.status)+'</span></td><td>'+(h.approved_at?esc(new Date(h.approved_at).toLocaleString('id-ID')):'—')+'</td><td><div class="cl-actions"><button class="btn o x" type="button" onclick="window.__clShowHistoryDetail(\''+esc(h.closing_date)+'\')">Detail</button><button class="ibtn cl-download-row" type="button" onclick="window.__clDownloadClosingExcelForDate(\''+esc(h.closing_date)+'\')" aria-label="Unduh rekap '+esc(h.closing_date)+'" title="Unduh rekap tanggal ini" style="width:34px;height:34px;min-width:34px;flex:none"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v11"/><path d="m7 9 5 5 5-5"/><path d="M5 16v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3"/></svg></button></div></td></tr>').join('');
 return '<div class="cogs-wrap"><style>.cl-top-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap}.cl-top-actions .btn{white-space:nowrap}.cl-filter{display:grid;grid-template-columns:1fr 1fr;gap:10px}.cl-filter label{min-width:0}.cl-module{padding:14px;margin-bottom:10px}.cl-module-head{display:flex;align-items:flex-start;gap:12px}.cl-status{width:34px;height:34px;display:grid;place-items:center;flex:none;border-radius:11px;font-size:18px;font-weight:800;background:var(--in);border:1px solid var(--line)}.cl-status.good{color:#167443;background:#e0f4e7;border-color:#8bc9a0}.cl-status.warn{color:#946200;background:#fff2c7;border-color:#e3c45e}.cl-status.bad{color:#bd5549;background:#fde8e5;border-color:#e5a49c}.cl-actions .btn[disabled]{opacity:.78;cursor:not-allowed;background:#e0f4e7;color:#167443;border-color:#8bc9a0}.cl-module-info{min-width:0;flex:1;display:grid;gap:5px}.cl-module-info b{font-size:15px}.cl-module-info small{color:var(--mu);line-height:1.4}.cl-module-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;border-top:1px solid var(--line);padding-top:10px;margin-top:12px}.cl-actions{display:flex;gap:6px;flex-wrap:wrap}.cl-summary{display:grid;grid-template-columns:1fr 1fr;gap:10px}.cl-summary>div{background:var(--in);border:1px solid var(--line);border-radius:14px;padding:12px}.cl-summary small{display:block;color:var(--mu)}.cl-summary b{display:block;font-size:17px;margin-top:4px}.cl-callout{border:1px solid var(--line);border-radius:14px;padding:12px;background:var(--in);margin:12px 0}.cl-callout p{margin:4px 0 0;color:var(--mu);font-size:12px}@media(max-width:520px){.cl-top-actions{width:100%;justify-content:stretch}.cl-top-actions .btn{flex:1}.cl-filter{grid-template-columns:1fr}.cl-module-foot{align-items:flex-start}.cl-actions{width:100%}.cl-actions .btn{flex:1}}</style><div class="card"><div class="cogs-top"><div><h3>Approval Closing</h3><p class="mu">Konfirmasi modul operasional yang aktif untuk divisi ini, rekonsiliasi data, lalu setujui snapshot closing harian.</p></div><div class="cl-top-actions"><button class="btn s" type="button" onclick="window.__clOpenTemplate()">Template Daily SO</button><button class="btn s" onclick="window.__clReload()">Muat ulang</button></div></div><div class="cl-filter"><label>Divisi<select onchange="window.__clFilter(\'division\',this.value)">'+divs.map(d=>'<option value="'+d.id+'" '+(String(d.id)===String(CL.division)?'selected':'')+'>'+esc(d.name)+'</option>').join('')+'</select></label><label>Tanggal closing<input type="date" max="'+clToday()+'" value="'+esc(CL.date)+'" onchange="window.__clFilter(\'date\',this.value)"></label></div><div class="cl-summary"><div><small>Divisi / periode</small><b>'+esc(divName)+'</b><small>'+esc(CL.date)+'</small></div><div><small>Status closing</small><b>'+esc(label)+'</b><small>'+activeModules.filter(m=>{const x=state(m);return x.saved&&x.fresh}).length+' / '+activeModules.length+' modul terkonfirmasi</small></div></div><div class="cl-callout"><b>Aturan closing</b><p>Modul kosong harus dikonfirmasi. Data yang berubah setelah konfirmasi wajib dikonfirmasi ulang. Approval memvalidasi snapshot modul aktif dan menghitung ulang saldo Daily SO bila modul itu aktif.</p></div></div><div class="card"><h3>Checklist modul</h3>'+cards+'</div><div class="card"><h3>Ringkasan sebelum approval</h3><p class="mu">Semua modul aktif harus dikonfirmasi dengan snapshot yang masih sama.</p><div class="cl-summary"><div><small>Rekaman Daily SO</small><b>'+(clModuleOn(CL.division,'cogs_daily_so')?count('daily_so',CL.division,CL.date):'Tidak digunakan')+'</b></div><div><small>Validasi</small><b>'+(approved?'Final':ready?'Siap diperiksa':'Belum lengkap')+'</b></div></div><div class="btns" style="margin-top:14px"><button class="btn s" onclick="window.__clReload()" '+(CL.busy?'disabled':'')+'>Validasi & muat ulang</button><button class="btn" onclick="window.__clApprove()" '+(!ready||approved||CL.busy?'disabled':'')+'>'+(CL.busy==='approve'?'Memproses…':approved?'Closing Approved':'Approval Closing')+'</button></div>'+(approved?'<p class="mu">Disetujui pada '+esc(new Date(CL.period.approved_at).toLocaleString('id-ID'))+'. Perubahan transaksi berikutnya harus melalui rekonsiliasi.</p>':'')+'</div><div class="card"><div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px"><h3 style="margin:0">Riwayat closing divisi</h3></div><div class="cogs-scroll"><table class="cogs-table"><thead><tr><th>Tanggal</th><th>Status</th><th>Waktu approval</th><th>Detail / Unduh</th></tr></thead><tbody>'+(history||'<tr><td colspan="4" class="mu">Belum ada riwayat closing.</td></tr>')+'</tbody></table></div></div></div>';
}
if(typeof V!=='undefined'&&typeof V.dash==='function'){const baseDash=V.dash;V.dash=()=>baseDash()+(clCanAccess()?'<div class="card"><h3>Approval Closing</h3><p class="mu">Periksa Daily SO, Pengeluaran, Sales, Barang Masuk, Produksi WIP, dan Suplies sebelum menutup hari.</p><button class="btn" onclick="window.__clOpen()">Buka approval closing</button></div>':'');}
window.__clShowHistoryDetail=async(date)=>{
 if(!clCanAccess())return toast('Akses ditolak.','warn');
 const h=CL.history.find(x=>String(x.closing_date)===String(date));if(!h)return toast('Riwayat closing tidak ditemukan.','warn');
 modal('<h3>Detail closing — '+esc(date)+'</h3><p class="mu">Status: <b>'+esc(h.status==='approved'?'Approved':h.status==='needs_reconciliation'?'Perlu rekonsiliasi':h.status)+'</b> · Waktu approval: '+(h.approved_at?esc(new Date(h.approved_at).toLocaleString('id-ID')):'—')+'</p><div class="card"><p class="mu">Detail per modul. Untuk workbook lengkap yang bisa disimpan, gunakan tombol Unduh Excel.</p><div id="cl-history-detail-body"><p class="mu">Memuat detail tiap modul…</p></div></div><div class="btns"><button class="btn s" onclick="window.__clDownloadClosingExcelForDate(' + "'"+esc(date)+"'" + ')">Unduh Excel</button><button class="btn" onclick="closeModal()">Tutup</button></div>');
 const host=document.getElementById('cl-history-detail-body');if(!host)return;
 try{
  const active=clModulesForDivision(CL.division);
  const snaps=await Promise.all(active.map(async m=>{const {data,error}=await sb().rpc('barapp_closing_module_snapshot',{p_division_id:CL.division,p_closing_date:date,p_module_key:m.key});if(error)throw error;return {m,data}}));
  const html=snaps.map(({m,data})=>'<section style="padding:10px 0;border-bottom:1px solid var(--line)"><h4 style="margin:0 0 8px">'+esc(m.name)+'</h4><pre style="white-space:pre-wrap;overflow-wrap:anywhere;max-height:240px;overflow:auto;background:var(--in);padding:10px;border-radius:10px;font:12px/1.5 inherit">'+esc(JSON.stringify(data??{},null,2))+'</pre></section>').join('');
  if(host.isConnected)host.innerHTML=html||'<p class="mu">Tidak ada modul aktif pada tanggal ini.</p>';
 }catch(e){if(host.isConnected)host.innerHTML='<p class="mu">Detail tidak berhasil dimuat: '+esc(clError(e))+'</p>'}
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