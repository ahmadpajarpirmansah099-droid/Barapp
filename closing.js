/* ===== DAILY CLOSING APPROVAL: six operational modules ===== */
(function(){
const clToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta'}).format(new Date());
const CL={division:'',date:clToday(),period:null,modules:[],history:[],snapshots:{},loading:false,ready:false,error:'',busy:'',importPlan:null,importing:false};
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

/* ===== Approval Closing: six-sheet Excel import ===== */
const CL_IMPORT_SHEETS=['Daily SO','Sales','Barang Masuk','Pengeluaran','Produksi WIP','Suplies'];
const clNormExcel=s=>String(s==null?'':s).trim().toLowerCase().replace(/[^a-z0-9]/g,'');
const clBlankExcel=v=>v===null||v===undefined||String(v).trim()==='';
const clExcelNumber=v=>{
 if(clBlankExcel(v))return {blank:true,valid:true,value:null};
 if(typeof v==='number')return {blank:false,valid:Number.isFinite(v),value:Number(v)};
 let s=String(v).trim().replace(/\s/g,'');if(s.includes(',')&&!s.includes('.'))s=s.replace(',','.');
 const n=Number(s);return {blank:false,valid:Number.isFinite(n),value:n};
};
const clExcelGet=(row,names)=>{
 const map={};Object.keys(row||{}).forEach(k=>map[clNormExcel(k)]=row[k]);
 for(const n of names){const k=clNormExcel(n);if(Object.prototype.hasOwnProperty.call(map,k))return map[k]}return '';
};
const clExcelUUID=()=>String(window.crypto&&window.crypto.randomUUID?window.crypto.randomUUID():'');
const clExcelUUIDValid=v=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v||'').trim());
const clExcelActive=x=>x&&x.active!==false;
const clExcelDivisionRows=arr=>(arr||[]).filter(x=>String(x.division_id)===String(CL.division)&&clExcelActive(x));
function clExcelMasterLists(){
 const items=clExcelDivisionRows(INV.items),materials=items.filter(x=>x.is_supply!==true),supplies=items.filter(x=>x.is_supply===true);
 const wips=clExcelDivisionRows(CG.wips),menus=clExcelDivisionRows(CG.menus);
 const curr=clDivision(CL.division);
 const divs=(INV.divs.length?INV.divs:CG.divs).filter(x=>x.active!==false&&curr&&String(x.outlet_id)===String(curr.outlet_id));
 return {items,materials,supplies,wips,menus,divs};
}
function clExcelAddSheet(wb,name,headers,rows){
 const ws=XLSX.utils.aoa_to_sheet([headers].concat(rows||[]));
 ws['!cols']=headers.map(h=>({wch:Math.min(36,Math.max(String(h).length+3,14))}));
 XLSX.utils.book_append_sheet(wb,ws,name);
}
function clExcelMakeTemplate(){
 if(!clCanAccess())return toast('Akses Approval Closing ditolak.','warn');
 if(!window.XLSX)return toast('Library Excel belum siap. Muat ulang halaman lalu coba lagi.','err');
 if(!CL.division||!clDivision(CL.division))return toast('Pilih divisi yang valid terlebih dahulu.','warn');
 try{
  const m=clExcelMasterLists(),templateId=clExcelUUID();
  if(!clExcelUUIDValid(templateId))throw new Error('Browser tidak menyediakan ID template yang aman. Buka Barapp lewat HTTPS lalu coba lagi.');
  const wb=XLSX.utils.book_new();
  clExcelAddSheet(wb,'Daily SO',['ID Item','Jenis Item','Nama Item','Satuan Dasar','Jumlah Fisik','Catatan'],
   m.materials.map(x=>[x.id,'material',x.name,x.base_unit||'UNIT','','']).concat(m.wips.map(x=>[x.id,'wip',x.name,x.yield_unit||'UNIT','',''])));
  clExcelAddSheet(wb,'Sales',['ID Menu','Nama Menu','Qty Terjual','Harga Jual','Catatan'],m.menus.map(x=>[x.id,x.name,'',x.selling_price??x.price??'','']));
  clExcelAddSheet(wb,'Barang Masuk',['ID Item','Nama Item','Qty Masuk','Satuan','Total Faktur','Catatan'],m.items.map(x=>[x.id,x.name,'',x.base_unit||'UNIT','','']));
  clExcelAddSheet(wb,'Pengeluaran',['Jenis Item','ID Item/WIP','Nama Item','Qty','Satuan','Kategori','ID Divisi Tujuan','Nama Divisi Tujuan','Catatan'],
   m.items.map(x=>['material',x.id,x.name,'',x.base_unit||'UNIT','Waste','','','']).concat(m.wips.map(x=>['wip',x.id,x.name,'',x.yield_unit||'UNIT','Waste','','',''])));
  clExcelAddSheet(wb,'Produksi WIP',['Jenis Transaksi','ID WIP','Nama WIP','Qty (unit atau batch)','Catatan'],
   m.wips.flatMap(x=>[['Saldo Awal',x.id,x.name,'',''],['Produksi',x.id,x.name,'','']]));
  clExcelAddSheet(wb,'Suplies',['ID Item','Nama Item','Jumlah Akhir Aktual','Catatan'],m.supplies.map(x=>[x.id,x.name,'','']));
  const meta=XLSX.utils.aoa_to_sheet([['key','value'],['template_id',templateId],['version','1'],['division_id',CL.division],['division_name',(clDivision(CL.division)||{}).name||''],['generated_at',new Date().toISOString()]]);
  XLSX.utils.book_append_sheet(wb,meta,'Meta');
  wb.Workbook=wb.Workbook||{};wb.Workbook.Sheets=wb.SheetNames.map(n=>({name:n,Hidden:n==='Meta'?1:0}));
  XLSX.writeFile(wb,'BARAPP_Approval_Closing_Template_6_Sheet.xlsx');
  toast('Template Excel 6 sheet berhasil diunduh. Isi qty sesuai master dan satuan di header.','ok');
 }catch(e){toast('Gagal membuat template Excel: '+String(e&&e.message||e),'err')}
}
function clExcelReadSheet(wb,name){const ws=wb.Sheets[name];return ws?XLSX.utils.sheet_to_json(ws,{defval:'',raw:true}):[]}
function clExcelHasAny(rows,keys){return rows.some(r=>keys.some(k=>!clBlankExcel(clExcelGet(r,[k]))))}
function clExcelTemplateId(wb){
 if(!wb.Sheets.Meta)return '';
 const rows=XLSX.utils.sheet_to_json(wb.Sheets.Meta,{header:1,defval:'',raw:true});
 for(const r of rows)if(clNormExcel(r[0])==='templateid')return String(r[1]||'').trim();
 return '';
}
function clExcelParseWorkbook(wb,fileName){
 const errors=[],payload={daily_so:[],sales:[],stock_in:[],opening_wip:[],stock_out:[],production:[],supplies:[]};
 const m=clExcelMasterLists(),division=String(CL.division||''),date=String(CL.date||''),templateId=clExcelTemplateId(wb);
 if(!clExcelUUIDValid(templateId))errors.push('File bukan template Barapp yang valid: Meta/template_id tidak ditemukan atau rusak.');
 if(CL_IMPORT_SHEETS.some(n=>!wb.Sheets[n]))errors.push('Workbook harus memiliki enam sheet: Daily SO, Sales, Barang Masuk, Pengeluaran, Produksi WIP, dan Suplies.');
 const metaRows=wb.Sheets.Meta?XLSX.utils.sheet_to_json(wb.Sheets.Meta,{header:1,defval:'',raw:true}):[];
 const vr=metaRows.find(r=>clNormExcel(r[0])==='version');
 if(!vr||String(vr[1])!=='1')errors.push('Versi template tidak didukung. Unduh template terbaru dari Approval Closing.');
 if(!date||!/^\d{4}-\d{2}-\d{2}$/.test(date)||date>clToday())errors.push('Tanggal closing tidak valid atau berada di masa depan.');
 if(!division||!clDivision(division))errors.push('Divisi tidak valid. Muat ulang Approval Closing dan pilih divisi yang benar.');
 const rd=clExcelReadSheet(wb,'Daily SO'),rs=clExcelReadSheet(wb,'Sales'),ri=clExcelReadSheet(wb,'Barang Masuk'),ro=clExcelReadSheet(wb,'Pengeluaran'),rp=clExcelReadSheet(wb,'Produksi WIP'),ru=clExcelReadSheet(wb,'Suplies');
 const kd=['Jumlah Fisik','qty','qty_base'],ks=['Qty Terjual','qty'],ki=['Qty Masuk','qty'],ko=['Qty','qty'],kp=['Qty (unit atau batch)','Qty','qty'],ku=['Jumlah Akhir Aktual','qty'];
 const dailyOn=clExcelHasAny(rd,kd),supplyOn=clExcelHasAny(ru,ku);
 const sd=new Set(),ss=new Set(),si=new Set(),so=new Set(),sopen=new Set(),sprod=new Set(),su=new Set();
 const name=(r,keys,fallback)=>String(clExcelGet(r,keys)||fallback||'').trim();
 const note=rows=>rows.map(r=>String(clExcelGet(r,['Catatan','notes'])||'').trim()).find(Boolean)||null;
 if(dailyOn){
  if(!rd.length)errors.push('Daily SO tidak memiliki baris master. Muat ulang template setelah Master Barang/WIP diisi.');
  rd.forEach((r,i)=>{const id=name(r,['ID Item','item_id']),type=clNormExcel(clExcelGet(r,['Jenis Item','Jenis','item_type'])),n=clExcelNumber(clExcelGet(r,kd));
   if(!clExcelUUIDValid(id)||!['material','wip'].includes(type)||n.blank||!n.valid||n.value<0){errors.push('Daily SO baris '+(i+2)+': ID, jenis material/wip, dan jumlah fisik ≥ 0 wajib diisi.');return}
   const k=type+':'+id;if(sd.has(k)){errors.push('Daily SO: item ganda ('+name(r,['Nama Item'],id)+').');return}sd.add(k);payload.daily_so.push({item_id:id,item_type:type,qty:n.value});
  });
  payload.daily_so_notes=note(rd);
 }
 if(dailyOn&&!clModuleOn(division,'cogs_daily_so'))errors.push('Sheet Daily SO berisi data, tetapi modul Daily SO tidak aktif.');
 rs.forEach((r,i)=>{const qty=clExcelNumber(clExcelGet(r,ks)),price=clExcelNumber(clExcelGet(r,['Harga Jual','selling_price','price'])),n=name(r,['Catatan','notes']),id=name(r,['ID Menu','menu_id']);
  if(qty.blank&&price.blank&&!n)return;
  if(!clExcelUUIDValid(id)||qty.blank||!qty.valid||qty.value<=0||(!price.blank&&(!price.valid||price.value<0))){errors.push('Sales baris '+(i+2)+': ID menu valid, qty > 0, dan harga jual kosong atau ≥ 0 wajib valid.');return}
  if(ss.has(id)){errors.push('Sales: menu ganda ('+name(r,['Nama Menu'],id)+').');return}ss.add(id);payload.sales.push({menu_id:id,qty:qty.value,selling_price:price.blank?null:price.value});
 });
 payload.sales_notes=note(rs);
 if(payload.sales.length&&!clModuleOn(division,'cogs_sales'))errors.push('Sheet Sales berisi data, tetapi modul Sales tidak aktif.');
 ri.forEach((r,i)=>{const qty=clExcelNumber(clExcelGet(r,ki)),inv=clExcelNumber(clExcelGet(r,['Total Faktur','invoice_total'])),n=name(r,['Catatan','notes']),id=name(r,['ID Item','item_id']),unit=name(r,['Satuan','unit']);
  if(qty.blank&&inv.blank&&!n)return;
  if(!clExcelUUIDValid(id)||qty.blank||!qty.valid||qty.value<=0||!unit||(!inv.blank&&(!inv.valid||inv.value<0))){errors.push('Barang Masuk baris '+(i+2)+': ID item, qty > 0, satuan dan total faktur harus valid.');return}
  if(si.has(id)){errors.push('Barang Masuk: item ganda ('+name(r,['Nama Item'],id)+').');return}si.add(id);payload.stock_in.push({item_id:id,qty:qty.value,unit,invoice_total:inv.blank?null:inv.value,notes:n||null});
 });
 ro.forEach((r,i)=>{const qty=clExcelNumber(clExcelGet(r,ko)),n=name(r,['Catatan','notes']),type=clNormExcel(clExcelGet(r,['Jenis Item','Jenis','item_type'])),id=name(r,['ID Item/WIP','ID Item','item_id','wip_id']),unit=name(r,['Satuan','unit']),cat=name(r,['Kategori','category']),target=name(r,['ID Divisi Tujuan','target_division_id']);
  if(qty.blank&&!n&&!target)return;
  if(!['material','wip'].includes(type)||!clExcelUUIDValid(id)||qty.blank||!qty.valid||qty.value<=0||!unit||!['Move','Waste','QC','R&D','Kalibrasi','Lainnya'].includes(cat)){errors.push('Pengeluaran baris '+(i+2)+': jenis, ID, qty > 0, satuan, dan kategori tidak valid.');return}
  if(cat==='Move'?!clExcelUUIDValid(target):!!target){errors.push('Pengeluaran baris '+(i+2)+': Move wajib memiliki ID divisi tujuan; kategori lain tidak boleh memiliki tujuan.');return}
  const k=type+':'+id+':'+cat;if(so.has(k)){errors.push('Pengeluaran: item dan kategori ganda ('+id+').');return}so.add(k);
  payload.stock_out.push({item_type:type,item_id:type==='material'?id:null,wip_id:type==='wip'?id:null,qty:qty.value,unit,category:cat,target_division_id:target||null,notes:n||null});
 });
 rp.forEach((r,i)=>{const qty=clExcelNumber(clExcelGet(r,kp)),id=name(r,['ID WIP','wip_id','item_id']),kind=clNormExcel(clExcelGet(r,['Jenis Transaksi','Jenis','type'])),n=name(r,['Catatan','notes']);
  if(qty.blank)return;
  if(!clExcelUUIDValid(id)||!qty.valid||qty.value<=0||!['saldoawal','produksi'].includes(kind)){errors.push('Produksi WIP baris '+(i+2)+': jenis transaksi, ID WIP dan qty > 0 wajib valid.');return}
  if(kind==='saldoawal'){if(sopen.has(id)){errors.push('Produksi WIP: WIP Saldo Awal ganda ('+id+').');return}sopen.add(id);payload.opening_wip.push({wip_id:id,qty:qty.value,notes:n||null})}
  else{if(!Number.isInteger(qty.value)){errors.push('Produksi WIP baris '+(i+2)+': jumlah batch harus bilangan bulat.');return}if(sprod.has(id)){errors.push('Produksi WIP: WIP Produksi ganda ('+id+').');return}sprod.add(id);payload.production.push({wip_id:id,batches:qty.value})}
 });
 payload.production_notes=note(rp);
 if((payload.opening_wip.length||payload.production.length)&&!clModuleOn(division,'cogs_production'))errors.push('Sheet Produksi WIP berisi data, tetapi modul Produksi WIP tidak aktif.');
 if(supplyOn){
  if(!ru.length)errors.push('Suplies tidak memiliki baris master. Muat ulang template setelah Master Suplies diisi.');
  ru.forEach((r,i)=>{const id=name(r,['ID Item','item_id']),n=clExcelNumber(clExcelGet(r,ku));
   if(!clExcelUUIDValid(id)||n.blank||!n.valid||n.value<0){errors.push('Suplies baris '+(i+2)+': ID item dan jumlah akhir aktual ≥ 0 wajib diisi.');return}
   if(su.has(id)){errors.push('Suplies: item ganda ('+name(r,['Nama Item'],id)+').');return}su.add(id);payload.supplies.push({item_id:id,qty:n.value});
  });
  payload.supplies_notes=note(ru);
 }
 if(supplyOn&&!clModuleOn(division,'supplies'))errors.push('Sheet Suplies berisi data, tetapi modul Suplies tidak aktif.');
 if(dailyOn&&!m.materials.length&&!m.wips.length)errors.push('Tidak ada item aktif untuk Daily SO di divisi ini.');
 if(supplyOn&&!m.supplies.length)errors.push('Tidak ada item aktif yang ditandai sebagai Suplies di divisi ini.');
 const total=payload.daily_so.length+payload.sales.length+payload.stock_in.length+payload.opening_wip.length+payload.stock_out.length+payload.production.length+payload.supplies.length;
 if(!total)errors.push('Tidak ada data transaksi. Isi minimal satu sheet; Daily SO dan Suplies harus lengkap jika diisi.');
 if(payload.daily_so.length&&count('daily_so',division,date)>0)errors.push('Daily SO sudah tersimpan pada tanggal ini. Batalkan rekaman lama melalui alur resmi sebelum impor.');
 if(payload.sales.length&&CG.sales.some(x=>String(x.division_id)===division&&String(x.sold_at)===date&&x.status==='posted'))errors.push('Sudah ada transaksi Sales pada tanggal ini; sheet Sales tidak bisa diimpor ulang.');
 if(payload.stock_in.length&&INV.ins.some(x=>String(x.division_id)===division&&String(x.received_at)===date&&x.status==='posted'))errors.push('Sudah ada transaksi Barang Masuk pada tanggal ini; sheet ini tidak bisa ditumpuk.');
 if(payload.stock_out.length&&INV.stockOut.some(x=>String(x.from_division_id)===division&&String(x.out_date)===date&&x.status==='posted'))errors.push('Sudah ada Pengeluaran pada tanggal ini; sheet ini tidak bisa ditumpuk.');
 if(payload.production.length&&CG.productions.some(x=>String(x.division_id)===division&&String(x.produced_at)===date&&x.status==='posted'&&x.cost_source!=='opening'))errors.push('Sudah ada Produksi WIP pada tanggal ini; sheet Produksi tidak bisa ditumpuk.');
 if(payload.opening_wip.length&&CG.productions.some(x=>String(x.division_id)===division&&String(x.produced_at)===date&&x.status==='posted'&&x.cost_source==='opening'))errors.push('Sudah ada Saldo Awal WIP pada tanggal ini; sheet Saldo Awal tidak bisa ditumpuk.');
 if(payload.supplies.length&&INV.suppliesSO.some(x=>String(x.division_id)===division&&String(x.so_date)===date&&x.status==='submitted'))errors.push('Daily SO Suplies sudah tersimpan pada tanggal ini.');
 if(CL.period&&['approved','needs_reconciliation'].includes(CL.period.status))errors.push('Closing periode ini terkunci atau menunggu rekonsiliasi. Gunakan alur rekonsiliasi resmi.');
 const sheets=[['Daily SO',payload.daily_so,rd,['Nama Item','Nama']],['Sales',payload.sales,rs,['Nama Menu','Nama']],['Barang Masuk',payload.stock_in,ri,['Nama Item','Nama']],['Pengeluaran',payload.stock_out,ro,['Nama Item','Nama']],['Produksi WIP',payload.opening_wip.concat(payload.production),rp,['Nama WIP','Nama']],['Suplies',payload.supplies,ru,['Nama Item','Nama']]];
 const previews=sheets.map(s=>({name:s[0],count:s[1].length,sample:s[2].filter(r=>!clBlankExcel(clExcelGet(r,['Nama Item','Nama Menu','Nama WIP']))).slice(0,3).map(r=>String(clExcelGet(r,s[3])||''))}));
 return {templateId,payload,errors,previews,fileName:fileName||'Excel',divisionId:division,targetDate:date};
}
function clExcelPreviewHtml(plan){
 const rows=plan.previews.map(s=>'<tr><td>'+esc(s.name)+'</td><td style="text-align:right">'+s.count+'</td><td>'+esc(s.sample.join(', ')||'—')+'</td></tr>').join('');
 const err=plan.errors.length?'<div class="cl-callout" style="border-color:#bd5549"><b>Perlu diperbaiki ('+plan.errors.length+')</b><ul style="margin:8px 0 0;padding-left:20px">'+plan.errors.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul></div>':'<div class="cl-callout"><b>Validasi awal lolos</b><p>Database tetap memvalidasi hak akses, master data, satuan, saldo, duplikasi, dan status closing sebelum menyimpan.</p></div>';
 const total=plan.payload.daily_so.length+plan.payload.sales.length+plan.payload.stock_in.length+plan.payload.opening_wip.length+plan.payload.stock_out.length+plan.payload.production.length+plan.payload.supplies.length;
 return '<h3>Preview Import Excel</h3><p class="mu">File: '+esc(plan.fileName)+'<br>Divisi: '+esc((clDivision(plan.divisionId)||{}).name||'—')+' · Tanggal: '+esc(plan.targetDate)+'</p><div class="cogs-scroll"><table class="cogs-table"><thead><tr><th>Sheet</th><th>Baris siap impor</th><th>Contoh data</th></tr></thead><tbody>'+rows+'</tbody></table></div>'+err+'<p class="mu">Total '+total+' baris. Seluruh sheet dikirim dalam satu transaksi database; jika validasi gagal, semua perubahan dibatalkan.</p><div class="btns"><button class="btn" '+(plan.errors.length||!total||CL.importing?'disabled':'')+' onclick="window.__clApplyExcelImport()">'+(CL.importing?'Memproses…':'Import '+total+' baris')+'</button><button class="btn s" onclick="closeM();window.__clCancelExcelImport()">Batal</button></div>';
}
function clRenderExcelPreview(){if(CL.importPlan)modal(clExcelPreviewHtml(CL.importPlan))}
function clPickExcelFile(){
 if(!clCanAccess())return toast('Akses Approval Closing ditolak.','warn');
 if(CL.period&&['approved','needs_reconciliation'].includes(CL.period.status))return toast('Periode closing terkunci. Gunakan alur rekonsiliasi resmi.','warn');
 const el=document.getElementById('clExcelInput');if(el)el.click();
}
async function clReadExcelImport(file){
 if(!file)return;
 if(!clCanAccess())return toast('Akses Approval Closing ditolak.','warn');
 if(CL.period&&['approved','needs_reconciliation'].includes(CL.period.status))return toast('Periode closing terkunci. Gunakan alur rekonsiliasi resmi.','warn');
 if(!window.XLSX)return toast('Library Excel belum siap. Muat ulang halaman lalu coba lagi.','err');
 if(!/\.(xlsx|xls)$/i.test(String(file.name||'')))return toast('Pilih file .xlsx atau .xls.','err');
 if(file.size>10*1024*1024)return toast('Ukuran file maksimal 10 MB.','err');
 try{const wb=XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:true});const plan=clExcelParseWorkbook(wb,file.name);CL.importPlan=plan;const el=document.getElementById('clExcelInput');if(el)el.value='';clRenderExcelPreview()}
 catch(e){CL.importPlan=null;toast('File Excel tidak dapat dibaca: '+String(e&&e.message||e),'err')}
}
function clImportErr(e){
 const m=String(e&&e.message||e||'');
 if(/barapp_closing_template_imports_template_id_key|duplicate key value.*template_id/i.test(m))return 'Template ini sudah pernah digunakan. Unduh template baru untuk impor berikutnya.';
 if(/barapp_closing_template_imports_payload_key|duplicate key value.*payload/i.test(m))return 'Isi transaksi yang sama sudah pernah diimpor untuk divisi dan tanggal ini.';
 if(/BARAPP_TEMPLATE_CLOSING_LOCKED|CLOSING_ALREADY_APPROVED|needs_reconciliation/i.test(m))return 'Closing periode ini terkunci. Gunakan alur rekonsiliasi resmi.';
 if(/BARAPP_TEMPLATE_EXISTING_DAILY_SO/i.test(m))return 'Daily SO sudah tersimpan untuk tanggal ini.';
 if(/BARAPP_TEMPLATE_EXISTING_SUPPLIES/i.test(m))return 'Daily SO Suplies sudah tersimpan untuk tanggal ini.';
 if(/BARAPP_TEMPLATE_EXISTING_SALES/i.test(m))return 'Sales sudah memiliki transaksi pada tanggal ini.';
 if(/BARAPP_TEMPLATE_EXISTING_STOCK_IN/i.test(m))return 'Barang Masuk sudah memiliki transaksi pada tanggal ini.';
 if(/BARAPP_TEMPLATE_EXISTING_EXPENSES/i.test(m))return 'Pengeluaran sudah memiliki transaksi pada tanggal ini.';
 if(/BARAPP_TEMPLATE_EXISTING_PRODUCTION/i.test(m))return 'Produksi WIP sudah memiliki transaksi pada tanggal ini.';
 if(/BARAPP_TEMPLATE_EXISTING_OPENING_WIP/i.test(m))return 'Saldo Awal WIP sudah memiliki transaksi pada tanggal ini.';
 if(/BARAPP_TEMPLATE_INVALID_UNIT/i.test(m))return 'Ada satuan yang tidak cocok dengan Master Barang/WIP.';
 if(/BARAPP_TEMPLATE_INVALID_DAILY_SO|COGS_SO_MUST_COUNT_ALL_ITEMS/i.test(m))return 'Daily SO harus memuat seluruh bahan dan WIP aktif, masing-masing satu kali.';
 if(/BARAPP_TEMPLATE_DUPLICATE/i.test(m))return 'Ada item/menu ganda di salah satu sheet. Periksa workbook lalu coba lagi.';
 if(/FORBIDDEN|42501|ACCESS_DENIED/i.test(m))return 'Akses impor ditolak oleh aturan hak akses database.';
 if(/BARAPP_TEMPLATE_INVALID_PAYLOAD|BARAPP_TEMPLATE_INVALID_SHEET_DATA|BARAPP_TEMPLATE_EMPTY_IMPORT/i.test(m))return 'Struktur workbook tidak valid atau tidak ada transaksi yang bisa diimpor.';
 return opsErr(e);
}
async function clApplyExcelImport(){
 if(!clCanAccess()||!CL.importPlan||CL.importing)return;
 const p=CL.importPlan;if(p.errors.length)return toast('Perbaiki kesalahan pada preview sebelum impor.','warn');
 if(String(CL.division)!==String(p.divisionId)||String(CL.date)!==String(p.targetDate))return toast('Divisi atau tanggal berubah. Baca ulang file dari halaman Approval Closing.','warn');
 if(CL.period&&['approved','needs_reconciliation'].includes(CL.period.status))return toast('Closing periode ini terkunci.','warn');
 if(!confirm('Impor '+p.fileName+' untuk '+p.targetDate+'? Semua sheet diproses secara atomik. Jika validasi database gagal, semua perubahan dibatalkan.'))return;
 CL.importing=true;
 try{
  const {data,error}=await sb().rpc('barapp_closing_import_template',{p_division_id:p.divisionId,p_target_date:p.targetDate,p_template_id:p.templateId,p_payload:p.payload});
  if(error)throw error;
  const s=data&&data.summary||{},n=['daily_so','sales','stock_in','opening_wip','stock_out','production','supplies'].reduce((a,k)=>a+(Number(s[k])||0),0);
  CL.importPlan=null;closeM();CL.ready=false;CL.period=null;await load(false);
  toast('Impor berhasil: '+n+' baris diproses. Periksa setiap modul dan konfirmasi ulang sebelum approval.','ok');
 }catch(e){toast(clImportErr(e),'err')}
 finally{CL.importing=false;if(pg==='cogs_closing')R()}
}
window.__clDownloadExcelTemplate=clExcelMakeTemplate;
window.__clPickExcelFile=clPickExcelFile;
window.__clReadExcelImport=clReadExcelImport;
window.__clApplyExcelImport=clApplyExcelImport;
window.__clCancelExcelImport=()=>{CL.importPlan=null};

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
 const history=CL.history.map(h=>'<tr><td><b>'+esc(h.closing_date)+'</b></td><td><span class="cogs-pill '+(h.status==='approved'?'':'bad')+'">'+esc(h.status==='approved'?'Approved':h.status==='needs_reconciliation'?'Perlu rekonsiliasi':h.status)+'</span></td><td>'+(h.approved_at?esc(new Date(h.approved_at).toLocaleString('id-ID')):'—')+'</td><td><button class="ibtn cl-download-row" type="button" onclick="window.__clDownloadClosingExcelForDate(\''+esc(h.closing_date)+'\')" aria-label="Unduh rekap '+esc(h.closing_date)+'" title="Unduh rekap tanggal ini" style="width:34px;height:34px;min-width:34px;flex:none"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v11"/><path d="m7 9 5 5 5-5"/><path d="M5 16v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3"/></svg></button></td></tr>').join('');
 return '<div class="cogs-wrap"><style>.cl-filter{display:grid;grid-template-columns:1fr 1fr;gap:10px}.cl-filter label{min-width:0}.cl-module{padding:14px;margin-bottom:10px}.cl-module-head{display:flex;align-items:flex-start;gap:12px}.cl-status{width:34px;height:34px;display:grid;place-items:center;flex:none;border-radius:11px;font-size:18px;font-weight:800;background:var(--in);border:1px solid var(--line)}.cl-status.good{color:#167443;background:#e0f4e7;border-color:#8bc9a0}.cl-status.warn{color:#946200;background:#fff2c7;border-color:#e3c45e}.cl-status.bad{color:#bd5549;background:#fde8e5;border-color:#e5a49c}.cl-actions .btn[disabled]{opacity:.78;cursor:not-allowed;background:#e0f4e7;color:#167443;border-color:#8bc9a0}.cl-module-info{min-width:0;flex:1;display:grid;gap:5px}.cl-module-info b{font-size:15px}.cl-module-info small{color:var(--mu);line-height:1.4}.cl-module-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;border-top:1px solid var(--line);padding-top:10px;margin-top:12px}.cl-actions{display:flex;gap:6px;flex-wrap:wrap}.cl-summary{display:grid;grid-template-columns:1fr 1fr;gap:10px}.cl-summary>div{background:var(--in);border:1px solid var(--line);border-radius:14px;padding:12px}.cl-summary small{display:block;color:var(--mu)}.cl-summary b{display:block;font-size:17px;margin-top:4px}.cl-callout{border:1px solid var(--line);border-radius:14px;padding:12px;background:var(--in);margin:12px 0}.cl-callout p{margin:4px 0 0;color:var(--mu);font-size:12px}@media(max-width:420px){.cl-filter{grid-template-columns:1fr}.cl-module-foot{align-items:flex-start}.cl-actions{width:100%}.cl-actions .btn{flex:1}}</style><div class="card"><div class="cogs-top"><div><h3>Approval Closing</h3><p class="mu">Konfirmasi modul operasional yang aktif untuk divisi ini, rekonsiliasi data, lalu setujui snapshot closing harian.</p></div><div class="btns"><button class="btn s" onclick="window.__clDownloadExcelTemplate()">Template Excel · 6 sheet</button><button class="btn s" onclick="window.__clPickExcelFile()">Import Excel</button><button class="btn s" onclick="window.__clReload()">Muat ulang</button></div></div><input id="clExcelInput" type="file" accept=".xlsx,.xls" hidden onchange="window.__clReadExcelImport(this.files&&this.files[0])"><div class="cl-filter"><label>Divisi<select onchange="window.__clFilter(\'division\',this.value)">'+divs.map(d=>'<option value="'+d.id+'" '+(String(d.id)===String(CL.division)?'selected':'')+'>'+esc(d.name)+'</option>').join('')+'</select></label><label>Tanggal closing<input type="date" max="'+clToday()+'" value="'+esc(CL.date)+'" onchange="window.__clFilter(\'date\',this.value)"></label></div><div class="cl-summary"><div><small>Divisi / periode</small><b>'+esc(divName)+'</b><small>'+esc(CL.date)+'</small></div><div><small>Status closing</small><b>'+esc(label)+'</b><small>'+activeModules.filter(m=>{const x=state(m);return x.saved&&x.fresh}).length+' / '+activeModules.length+' modul terkonfirmasi</small></div></div><div class="cl-callout"><b>Aturan closing</b><p>Modul kosong harus dikonfirmasi. Data yang berubah setelah konfirmasi wajib dikonfirmasi ulang. Approval memvalidasi snapshot modul aktif dan menghitung ulang saldo Daily SO bila modul itu aktif.</p></div></div><div class="card"><h3>Checklist modul</h3>'+cards+'</div><div class="card"><h3>Ringkasan sebelum approval</h3><p class="mu">Semua modul aktif harus dikonfirmasi dengan snapshot yang masih sama.</p><div class="cl-summary"><div><small>Rekaman Daily SO</small><b>'+(clModuleOn(CL.division,'cogs_daily_so')?count('daily_so',CL.division,CL.date):'Tidak digunakan')+'</b></div><div><small>Validasi</small><b>'+(approved?'Final':ready?'Siap diperiksa':'Belum lengkap')+'</b></div></div><div class="btns" style="margin-top:14px"><button class="btn s" onclick="window.__clReload()" '+(CL.busy?'disabled':'')+'>Validasi & muat ulang</button><button class="btn" onclick="window.__clApprove()" '+(!ready||approved||CL.busy?'disabled':'')+'>'+(CL.busy==='approve'?'Memproses…':approved?'Closing Approved':'Approval Closing')+'</button></div>'+(approved?'<p class="mu">Disetujui pada '+esc(new Date(CL.period.approved_at).toLocaleString('id-ID'))+'. Perubahan transaksi berikutnya harus melalui rekonsiliasi.</p>':'')+'</div><div class="card"><div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px"><h3 style="margin:0">Riwayat closing divisi</h3></div><div class="cogs-scroll"><table class="cogs-table"><thead><tr><th>Tanggal</th><th>Status</th><th>Waktu approval</th><th>Unduh</th></tr></thead><tbody>'+(history||'<tr><td colspan="4" class="mu">Belum ada riwayat closing.</td></tr>')+'</tbody></table></div></div></div>';
}
if(typeof V!=='undefined'&&typeof V.dash==='function'){const baseDash=V.dash;V.dash=()=>baseDash()+(clCanAccess()?'<div class="card"><h3>Approval Closing</h3><p class="mu">Periksa Daily SO, Pengeluaran, Sales, Barang Masuk, Produksi WIP, dan Suplies sebelum menutup hari.</p><button class="btn" onclick="window.__clOpen()">Buka approval closing</button></div>':'');}
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