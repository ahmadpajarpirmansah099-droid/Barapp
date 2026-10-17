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
 return '<div class="cogs-wrap"><style>.cl-filter{display:grid;grid-template-columns:1fr 1fr;gap:10px}.cl-filter label{min-width:0}.cl-module{padding:14px;margin-bottom:10px}.cl-module-head{display:flex;align-items:flex-start;gap:12px}.cl-status{width:34px;height:34px;display:grid;place-items:center;flex:none;border-radius:11px;font-size:18px;font-weight:800;background:var(--in);border:1px solid var(--line)}.cl-status.good{color:#167443;background:#e0f4e7;border-color:#8bc9a0}.cl-status.warn{color:#946200;background:#fff2c7;border-color:#e3c45e}.cl-status.bad{color:#bd5549;background:#fde8e5;border-color:#e5a49c}.cl-actions .btn[disabled]{opacity:.78;cursor:not-allowed;background:#e0f4e7;color:#167443;border-color:#8bc9a0}.cl-module-info{min-width:0;flex:1;display:grid;gap:5px}.cl-module-info b{font-size:15px}.cl-module-info small{color:var(--mu);line-height:1.4}.cl-module-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;border-top:1px solid var(--line);padding-top:10px;margin-top:12px}.cl-actions{display:flex;gap:6px;flex-wrap:wrap}.cl-summary{display:grid;grid-template-columns:1fr 1fr;gap:10px}.cl-summary>div{background:var(--in);border:1px solid var(--line);border-radius:14px;padding:12px}.cl-summary small{display:block;color:var(--mu)}.cl-summary b{display:block;font-size:17px;margin-top:4px}.cl-callout{border:1px solid var(--line);border-radius:14px;padding:12px;background:var(--in);margin:12px 0}.cl-callout p{margin:4px 0 0;color:var(--mu);font-size:12px}@media(max-width:420px){.cl-filter{grid-template-columns:1fr}.cl-module-foot{align-items:flex-start}.cl-actions{width:100%}.cl-actions .btn{flex:1}}</style><div class="card"><div class="cogs-top"><div><h3>Approval Closing</h3><p class="mu">Konfirmasi modul operasional yang aktif untuk divisi ini, rekonsiliasi data, lalu setujui snapshot closing harian.</p></div><button class="btn s" onclick="window.__clReload()">Muat ulang</button></div><div class="cl-filter"><label>Divisi<select onchange="window.__clFilter(\'division\',this.value)">'+divs.map(d=>'<option value="'+d.id+'" '+(String(d.id)===String(CL.division)?'selected':'')+'>'+esc(d.name)+'</option>').join('')+'</select></label><label>Tanggal closing<input type="date" max="'+clToday()+'" value="'+esc(CL.date)+'" onchange="window.__clFilter(\'date\',this.value)"></label></div><div class="cl-summary"><div><small>Divisi / periode</small><b>'+esc(divName)+'</b><small>'+esc(CL.date)+'</small></div><div><small>Status closing</small><b>'+esc(label)+'</b><small>'+activeModules.filter(m=>{const x=state(m);return x.saved&&x.fresh}).length+' / '+activeModules.length+' modul terkonfirmasi</small></div></div><div class="cl-callout"><b>Aturan closing</b><p>Modul kosong harus dikonfirmasi. Data yang berubah setelah konfirmasi wajib dikonfirmasi ulang. Approval memvalidasi snapshot modul aktif dan menghitung ulang saldo Daily SO bila modul itu aktif.</p></div></div><div class="card"><h3>Checklist modul</h3>'+cards+'</div><div class="card"><h3>Ringkasan sebelum approval</h3><p class="mu">Semua modul aktif harus dikonfirmasi dengan snapshot yang masih sama.</p><div class="cl-summary"><div><small>Rekaman Daily SO</small><b>'+(clModuleOn(CL.division,'cogs_daily_so')?count('daily_so',CL.division,CL.date):'Tidak digunakan')+'</b></div><div><small>Validasi</small><b>'+(approved?'Final':ready?'Siap diperiksa':'Belum lengkap')+'</b></div></div><div class="btns" style="margin-top:14px"><button class="btn s" onclick="window.__clReload()" '+(CL.busy?'disabled':'')+'>Validasi & muat ulang</button><button class="btn" onclick="window.__clApprove()" '+(!ready||approved||CL.busy?'disabled':'')+'>'+(CL.busy==='approve'?'Memproses…':approved?'Closing Approved':'Approval Closing')+'</button></div>'+(approved?'<p class="mu">Disetujui pada '+esc(new Date(CL.period.approved_at).toLocaleString('id-ID'))+'. Perubahan transaksi berikutnya harus melalui rekonsiliasi.</p>':'')+'</div><div class="card"><div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px"><h3 style="margin:0">Riwayat closing divisi</h3></div><div class="cogs-scroll"><table class="cogs-table"><thead><tr><th>Tanggal</th><th>Status</th><th>Waktu approval</th><th>Unduh</th></tr></thead><tbody>'+(history||'<tr><td colspan="4" class="mu">Belum ada riwayat closing.</td></tr>')+'</tbody></table></div></div></div>';
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