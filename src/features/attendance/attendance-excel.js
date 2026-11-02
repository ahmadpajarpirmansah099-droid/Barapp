/* ---------- Excel Import / Export ---------- */
function xlsxReady(){
  if(!window.XLSX){toast('Library Excel belum siap. Coba muat ulang halaman.','err');return false}
  return true
}
function xDate(v){
  if(v==null||v==='')return '';
  if(v instanceof Date)return iso(v.getTime());
  if(typeof v==='number' && window.XLSX && XLSX.SSF){
    const d=XLSX.SSF.parse_date_code(v); if(d)return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
  }
  const z=String(v).trim();
  if(/^\d{4}-\d{2}-\d{2}/.test(z))return z.slice(0,10);
  const m=z.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/); if(m)return `${m[3]}-${String(m[2]).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`;
  const d=new Date(z); return isNaN(d)?'':iso(d.getTime());
}
function xRows(ws){return XLSX.utils.sheet_to_json(ws,{defval:'',raw:true});}
function xVal(r,keys){for(const k of keys){if(r[k]!==undefined&&r[k]!==null&&String(r[k]).trim()!=='')return r[k]}const low=Object.fromEntries(Object.keys(r).map(k=>[k.toLowerCase().replace(/\s+/g,'_'),r[k]]));for(const k of keys){const q=k.toLowerCase().replace(/\s+/g,'_');if(low[q]!==undefined)return low[q]}return ''}
function xBool(v){return !(v===false||v===0||/^(false|0|no|nonaktif|inactive)$/i.test(String(v).trim()))}
function xNum(v){return v===''||v==null?'':Math.max(0,+v||0)}
function sheetRows(wb,names){for(const n of names){if(wb.Sheets[n])return xRows(wb.Sheets[n])}const want=names.map(n=>n.toLowerCase());const hit=wb.SheetNames.find(n=>want.includes(n.toLowerCase()));return hit?xRows(wb.Sheets[hit]):[]}
function excelBook(){const wb=XLSX.utils.book_new(),add=(name,rows)=>{const ws=XLSX.utils.json_to_sheet(rows||[]);XLSX.utils.book_append_sheet(wb,ws,name.slice(0,31))};return {wb,add}}
function downloadWb(wb,name){XLSX.writeFile(wb,name.endsWith('.xlsx')?name:name+'.xlsx')}
function exportExcel(kind){
  if(!guard())return; if(!xlsxReady())return;
  const {wb,add}=excelBook(),stamp=today();
  if(kind==='emp'||kind==='full')add('Karyawan',D.emp.map(e=>({ID:e.id,Nama:e.nama,Jabatan:e.jab||'',Aktif:e.aktif!==false})));
  if(kind==='att'||kind==='full')add('Absensi',D.att.map(a=>({ID:a.id,'Employee ID':a.e,Nama:name(a.e),Tanggal:a.d,Status:a.s,Catatan:a.n||''})));
  if(kind==='ot'||kind==='full')add('Lembur',D.ot.map(o=>({'Employee ID':o.e,Nama:name(o.e),Tanggal:o.d,'Jam lembur':hrs(o),Catatan:o.n||''})));
  if(kind==='full')add('Periode',D.per.map(p=>({ID:p.id,Mulai:p.s,Akhir:p.e,Locked:p.lock?'Ya':'Tidak'})));
  const label={emp:'Karyawan',att:'Absensi',ot:'Lembur',full:'FULL_DATABASE'}[kind]||'BARAPP';
  downloadWb(wb,`BARAPP_${label}_${stamp}.xlsx`);toast(`Export ${label} berhasil`)
}
function downloadExcelTemplate(){
  if(!guard()||!xlsxReady())return;
  const {wb,add}=excelBook();
  add('Karyawan',[{ID:'',Nama:'',Jabatan:'',Aktif:'Ya'}]);
  add('Absensi',[{ID:'','Employee ID':'','Nama':'',Tanggal:'YYYY-MM-DD',Status:'M/L/I/S/PH',Catatan:''}]);
  add('Lembur',[{'Employee ID':'',Nama:'',Tanggal:'YYYY-MM-DD','Jam lembur':'',Catatan:''}]);
  downloadWb(wb,`BARAPP_Template_Import.xlsx`);toast('Template Excel berhasil dibuat')
}
function openExcelImport(){if(!guard())return;modal(`<h3>Import Excel</h3><p class="mu">Upload workbook .xlsx/.xls. Sistem akan membaca sheet yang dikenali dan hanya menambahkan data yang belum ada.</p><div class="dlg">${IC('doc',32)}<p>Pilih file Excel dari HP.</p></div><div class="btns"><button class="btn" onclick="$('#excelImportInput').click();closeM()">Pilih File Excel</button><button class="btn s" onclick="closeM()">Batal</button></div>`)}
function openExcelRestore(){if(!guard())return;openExcelImport()}
function planExcel(wb){
  const plan={emp:[],att:[],ot:[],errors:[]};
  const er=sheetRows(wb,['Karyawan','Employees']);
  er.forEach((r,i)=>{const nama=String(xVal(r,['Nama','name'])).trim();if(!nama)return;if(plan.emp.some(e=>norm(e.nama)==norm(nama))||D.emp.some(e=>norm(e.nama)==norm(nama)))return;plan.emp.push({id:xVal(r,['ID','id']),nama,jab:String(xVal(r,['Jabatan','role'])).trim(),aktif:xBool(xVal(r,['Aktif','active']))})});
  const resolveEmp=r=>{const id=xVal(r,['Employee ID','employee_id','ID Karyawan']);const nama=String(xVal(r,['Nama','name'])).trim();return D.emp.find(e=>String(e.id)==String(id))||D.emp.find(e=>norm(e.nama)==norm(nama))||plan.emp.find(e=>String(e.id)==String(id))||plan.emp.find(e=>norm(e.nama)==norm(nama))};
  sheetRows(wb,['Absensi','Attendance']).forEach(r=>{const e=resolveEmp(r),d=xDate(xVal(r,['Tanggal','attendance_date','Date'])),st=normSt(xVal(r,['Status','status']));if(!e||!d||!st){plan.errors.push('Absensi: baris tidak valid');return}if(D.att.some(a=>String(a.e)==String(e.id)&&a.d==d)||plan.att.some(a=>String(a._eid)==String(e.id)&&a.d==d))return;plan.att.push({_eid:e.id,d,s:st,n:String(xVal(r,['Catatan','notes'])).trim()})});
  sheetRows(wb,['Lembur','Overtime']).forEach(r=>{const e=resolveEmp(r),d=xDate(xVal(r,['Tanggal','date'])),h=xNum(xVal(r,['Jam lembur','Jam','hours']));if(!e||!d||h===''){plan.errors.push('Lembur: baris tidak valid');return}if(D.ot.some(o=>String(o.e)==String(e.id)&&o.d==d&&+hrs(o)==+h)||plan.ot.some(o=>String(o._eid)==String(e.id)&&o.d==d&&+o.h==+h))return;plan.ot.push({_eid:e.id,d,h,n:String(xVal(r,['Catatan','notes'])).trim()})});
  return plan;
}
function planSummary(p){const total=p.emp.length+p.att.length+p.ot.length;return `<div class="dlg"><b>Data baru: ${total}</b><br>Karyawan ${p.emp.length} · Absensi ${p.att.length} · Lembur ${p.ot.length}<br><br>Baris bermasalah: ${p.errors.length}</div>`}
async function handleExcelFile(file){if(!file||!guard())return;if(!xlsxReady())return;try{const wb=XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:true});const p=planExcel(wb);T.excelPlan=p;modal(`<h3>Preview Import</h3>${planSummary(p)}<p class="mu">Data existing tidak dihapus. Duplikat dilewati.</p><div class="btns"><button class="btn" onclick="applyExcelPlan()">Import Data</button><button class="btn s" onclick="closeM()">Batal</button></div>`)}catch(e){toast('File Excel tidak bisa dibaca: '+e.message,'err')}}
async function applyExcelPlan(){if(!guard()||!T.excelPlan)return;const p=T.excelPlan;let added=0,skip=0;const ok=await sbRun(async()=>{
  const c=sb(),emap=new Map(D.emp.map(e=>[norm(e.nama),e.id]));
  for(const x of p.emp){if(emap.has(norm(x.nama))){skip++;continue}const {data,error}=await c.from('employees').insert({name:x.nama,role:x.jab||'',active:x.aktif!==false,outlet_id:await outInit()}).select(EMP_SAFE_SELECT).single();if(error)throw error;const e=mapEmp(data);D.emp.push(e);emap.set(norm(e.nama),e.id);added++}
  const attRows=[];for(const x of p.att){const direct=D.emp.find(e=>String(e.id)==String(x._eid));const pe=p.emp.find(e=>String(e.id)==String(x._eid));const eid=direct?.id||emap.get(norm(pe?.nama||''))||x._eid;if(!eid||D.att.some(a=>String(a.e)==String(eid)&&a.d==x.d)){skip++;continue}attRows.push({employee_id:eid,attendance_date:x.d,status:x.s,notes:x.n||null})}
  for(let i=0;i<attRows.length;i+=200){const {data,error}=await c.from('attendance').insert(attRows.slice(i,i+200)).select();if(error)throw error;(data||[]).forEach(r=>{D.att.push(mapAtt(r));added++})}
  const otEmp=emap; p.ot.forEach(x=>{const direct=D.emp.find(e=>String(e.id)==String(x._eid));const pe=p.emp.find(e=>String(e.id)==String(x._eid));const eid=direct?.id||otEmp.get(norm(pe?.nama||''))||x._eid;if(!eid||D.ot.some(o=>String(o.e)==String(eid)&&o.d==x.d&&+hrs(o)==+x.h))skip++;else{D.ot.push({e:eid,d:x.d,h:x.h,n:x.n});added++}});
  sv();sbCacheSave();derivePeriods();
});
if(ok){delete T.excelPlan;closeM();toast(`Import selesai: ${added} ditambahkan, ${skip} dilewati`);R()}}
function ex(k){if(!guard())return;const {f,t}=rng();if(f>t)return toast('Tanggal mulai harus sebelum tanggal akhir','err');const l=flt(f,t),ds=days(f,t),R_=[];let n='absensi';
if(k=='matrix'){n='rekap-absensi';R_.push(['Nama',...ds.map(d=>d.slice(5)),'M','L','I','S','PH','Belum ada data']);l.forEach(e=>{const c=cntR(f,t,[e]);R_.push([e.nama,...ds.map(d=>(rec(e.id,d)||{s:'BELUM ADA DATA'}).s),c.M,c.L,c.I,c.S,c.PH,c.B])})}
if(k=='emp'){n='rekap-karyawan';R_.push(['ID','Nama','Total Hari Kerja (M)','L','I','S','PH','Belum ada data','Jam lembur','Sisa PH']);l.forEach(e=>{const c=cntR(f,t,[e]);R_.push([e.id,e.nama,c.M,c.L,c.I,c.S,c.PH,c.B,otH(e,f,t),e.sph||0])})}
if(k=='det'){n='detail-absensi';R_.push(['ID','Nama','Tanggal','Status','Catatan']);l.forEach(e=>ds.forEach(d=>{const a=rec(e.id,d);a&&R_.push([e.id,e.nama,d,a.s,a.n])}))}
if(k=='blank'){n='belum-ada-data';R_.push(['ID','Nama','Tanggal']);l.forEach(e=>ds.forEach(d=>rec(e.id,d)||R_.push([e.id,e.nama,d])))}
if(k=='ot'){n='lembur';R_.push(['Tanggal','Nama','Jam lembur','Catatan']);D.ot.filter(o=>o.d>=f&&o.d<=t&&(!F.e||o.e==F.e)).sort((a,b)=>a.d<b.d?-1:1).forEach(o=>R_.push([o.d,name(o.e),hrs(o),o.n||'']))}
if(R_.length<2)return toast('Tidak ada data untuk diekspor','warn');dl(n+'-'+f+'_'+t,R_)}
let DL=null;try{window.claude&&claude.use('downloads').then(x=>DL=x).catch(()=>{})}catch(e){}
async function dl(n,rows){const t='\ufeff'+rows.map(r=>r.map(c=>'"'+String(c??'').replace(/"/g,'""')+'"').join(',')).join('\r\n');
if(DL){try{await DL.save({filename:n+'.csv',data:new Blob([t],{type:'text/csv'})});return}catch(e){if(e&&e.code=='declined')return}}
modal(`<h3>${esc(n)}.csv</h3><p class="mu">Unduhan langsung tidak tersedia di sini. Salin teks CSV ini.</p><textarea readonly rows="10" onfocus="this.select()">${esc(t)}</textarea><br><br><button class="btn s" onclick="closeM()">Tutup</button>`)}
