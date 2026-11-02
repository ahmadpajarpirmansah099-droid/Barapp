/* Barapp — modul Gaji / Payroll.
 * Memakai fungsi bersama dari index.html; tidak mengubah alur database.
 */
const PAY={need:true,busy:false,s:null,pp:{},allow:[],cash:[],bal:{},run:null,items:[],rep:null,urls:{}};
const payOK=()=>T.dbRole==='dev'||(T.dbRole==='hr'&&hasFeature('payroll.view'));
const payRpc=(fn,args)=>sb().rpc(fn,args||{}).then(r=>{if(r.error)throw r.error;return r.data});
const payBlk=(k,title,html,def)=>{T.acc=T.acc||{};const o=(k in T.acc)?T.acc[k]:!!def;return `<div onclick="payAcc('${k}',${!!def})" style="cursor:pointer;display:flex;align-items:center;gap:12px;padding:14px 18px;margin:0 0 12px;background:#fffaf7;border:1px solid #ecd6cf;border-radius:18px"><b style="flex:1">${title}</b><span id="pbc-${k}" style="font-size:18px;color:#8a6f68;display:inline-block;transition:transform .5s cubic-bezier(.34,1.56,.64,1);transform:rotate(${o?180:0}deg)">▾</span></div><div id="pbb-${k}" style="display:grid;grid-template-rows:${o?'1fr':'0fr'};opacity:${o?1:0};margin:-4px 0 14px;padding:0 2px"><div style="min-height:0;overflow:hidden">${html}</div></div>`};
const payAcc=(k,def)=>{T.acc=T.acc||{};const cur=(k in T.acc)?T.acc[k]:!!def;const now=!cur;T.acc[k]=now;const bd=document.getElementById('pbb-'+k),ch=document.getElementById('pbc-'+k);if(bd)accToggle(bd,now);if(ch)ch.style.transform='rotate('+(now?180:0)+'deg)'};
const payPeriods=()=>{const [y,mo]=today().split('-').map(Number),out=[],seen={};for(let k=0;k<7;k++){const [a,b]=perFor(mkd(y,mo-1-k,15));const key=a+'|'+b;if(!seen[key]){seen[key]=1;out.push([a,b])}}return out};
const payPick=val=>{if(val=='custom')return;const [a,b]=val.split('|');T.rf=a;T.rt=b;R()};
const payPickers=(f,t)=>`<button class="btn s x" onclick="rOpen('T')">📅 ${fdp(f)} s/d ${fdp(t)}</button>`;
const payDenied=()=>'<div class="card empty">Fitur Gaji hanya untuk Developer dan HR.</div>';
const payEnsure=()=>{if(PAY.need&&!PAY.busy){PAY.busy=true;setTimeout(payLoad,0)}};
const payHead=t=>'';

async function otLoad(){const oid=await outInit();if(!oid)return;const rows=await payQ('overtime_entries','*');const emps=await payQ('employees','id,outlet_id');const ok=new Set(emps.filter(e=>e.outlet_id==oid||(!e.outlet_id&&oid==D.ljId)).map(e=>String(e.id)));D.ot=rows.filter(r=>ok.has(String(r.employee_id))).map(r=>({db:r.id,e:r.employee_id,d:String(r.work_date).slice(0,10),h:+r.hours,n:r.note||''}))}
/* Periode payroll (sama dengan fungsi payroll_period_for di database) */
const mkd=(y,m,d)=>{const q=new Date(Date.UTC(y,m,1)),yy=q.getUTCFullYear(),mm=q.getUTCMonth(),dim=new Date(Date.UTC(yy,mm+1,0)).getUTCDate();return iso(Date.UTC(yy,mm,Math.min(d,dim)))};
const payNext=()=>{const [,pt]=perFor(today());return iso(U(pt)+864e5)};
function perFor(ref){const y=+ref.slice(0,4),m=+ref.slice(5,7)-1,d=+ref.slice(8,10),s=PAY.s||{},mode=s.period_mode||'calendar',cs=s.custom_start_day,ce=s.custom_end_day;
 if(mode=='day_24_23')return d>=24?[mkd(y,m,24),mkd(y,m+1,23)]:[mkd(y,m-1,24),mkd(y,m,23)];
 if(mode=='custom'&&cs&&ce){if(cs<=ce)return [mkd(y,m,cs),mkd(y,m,ce)];return d>=cs?[mkd(y,m,cs),mkd(y,m+1,ce)]:[mkd(y,m-1,cs),mkd(y,m,ce)]}
 return [mkd(y,m,1),mkd(y,m,31)]}

/* Estimasi dari absensi yang sudah diinput (angka resmi dihitung database saat Hitung & Final) */
function payEst(e,f,t){const nd=days(f,t).length,c={M:0,L:0,I:0,S:0,PH:0};let rec=0;
 D.att.forEach(a=>{if(a.e==e.id&&a.d>=f&&a.d<=t){rec++;if(c[a.s]!=null)c[a.s]++}});
 const unk=rec-(c.M+c.L+c.I+c.S+c.PH),p=PAY.pp[String(e.id)],has=!!p,sal=+(p&&p.monthly_salary)||0,meal=+(p&&p.meal_rate)||0,
 paid=c.M+c.L+c.PH+c.S,std=perFor(f),full=std[0]==f&&std[1]==t,
 earned=full?sal-Math.round(Math.max(nd-paid,0)*sal/31*100)/100:Math.round(paid*sal/31*100)/100,izin=sal-earned,codes=(PAY.s&&PAY.s.meal_codes)||['M'],md=codes.reduce((n,k)=>n+(c[k]||0),0),mt=md*meal,
 al=PAY.allow.filter(x=>String(x.employee_id)==String(e.id)&&x.active&&x.valid_from<=t&&(!x.valid_to||x.valid_to>=f)).reduce((n,x)=>n+(+x.amount),0),
 ks=PAY.cash.filter(x=>String(x.employee_id)==String(e.id)&&x.status=='open'&&x.issued_on<=t&&+x.installment>0).reduce((n,x)=>n+Math.min(+x.installment,Math.max(0,+(PAY.bal[x.id]??0))),0);
 const oth=D.ot.filter(o=>o.e==e.id&&o.d>=f&&o.d<=t).reduce((n,o)=>n+hrs(o),0),ot=Math.round(oth*(sal/31)/8*1.5*100)/100;
 return {e,c,blank:nd-rec,unk,has,sal,paid,full,earned,izin,md,mt,al,ks,oth,ot,net:earned+mt+al+ot-ks}}

function payClear(i){const e=D.emp[i];if(!e)return;cf(`Hapus gaji ${esc(e.nama)}? Gaji bulanan dan uang makan jadi 0, tunjangan dinonaktifkan.`,async()=>{const ok=await sbRun(async()=>{await payRpc('payroll_clear_employee_pay',{p_employee:e.id,p_reason:'Hapus gaji'})});if(ok){toast('Gaji dihapus (jadi 0)');PAY.need=true;await payLoad();R()}},'Ya, hapus gaji')}

async function payLoad(){PAY.need=false;PAY.busy=true;
 try{const [st,pp,al,ca]=await Promise.all([payQ('payroll_settings','*'),payQ('employee_pay_profiles','*'),payQ('employee_allowances','*'),payQ('cashadvances','*')]);
  PAY.s=st[0]||null;PAY.pp=Object.fromEntries(pp.map(x=>[String(x.employee_id),x]));PAY.allow=al;PAY.cash=ca;PAY.bal={};
  await Promise.all(ca.map(async c=>{try{PAY.bal[c.id]=await payRpc('cashadvance_balance',{p_id:c.id})}catch(e){PAY.bal[c.id]=null}}))}
 catch(e){toast(errText(e),'err')}
 PAY.busy=false;R()}

/* ===== 2. DATA GAJI: gaji + uang makan + tunjangan per NAMA ===== */
V.pay_data=()=>{if(!payOK())return payDenied();payEnsure();
 if(!D.emp.length)return payBlk('dg_list','Daftar karyawan','<div class="empty">Belum ada karyawan.</div>',true);
 const tabel=`<p class="mu" style="margin:0 0 8px">Ketuk Isi / Ubah pada nama untuk mengisi gaji, uang makan, dan tunjangan.</p><div class="tw" style="overflow-x:auto"><table style="font-size:12px"><tr><th>Nama</th><th>Gaji bulanan</th><th>Makan / hari</th><th>Tunjangan</th><th></th></tr>${D.emp.map((e,i)=>{const p=PAY.pp[String(e.id)],al=PAY.allow.filter(x=>String(x.employee_id)==String(e.id)&&x.active);return `<tr><td>${esc(e.nama)}${e.aktif?'':' <span class="mu">(nonaktif)</span>'}</td><td>${p?fmtN(p.monthly_salary):'<span class="mu">belum</span>'}</td><td>${p?fmtN(p.meal_rate):'<span class="mu">belum</span>'}</td><td>${al.length?al.length+' jenis · '+fmtN(al.reduce((n,x)=>n+(+x.amount),0)):'-'}</td><td style="white-space:nowrap"><button class="btn s x" onclick="payOpen(${i})">Isi / Ubah</button> <button class="btn s x" onclick="payClear(${i})">Hapus gaji</button></td></tr>`}).join('')}</table></div>`;
 return payBlk('dg_list','Daftar karyawan',tabel,true)};

function payOpen(i){const e=D.emp[i];if(!e)return;const p=PAY.pp[String(e.id)]||{};
 T.px={i,sal:p.monthly_salary==null?'':String(p.monthly_salary),meal:p.meal_rate==null?'':String(p.meal_rate),reason:'',
  rows:PAY.allow.filter(x=>String(x.employee_id)==String(e.id)).map(x=>{const r={id:x.id,name:x.name,kind:x.kind,amount:String(x.amount),from:x.valid_from,to:x.valid_to||'',active:!!x.active,del:false};r.orig={name:r.name,kind:r.kind,amount:+x.amount,from:r.from,to:r.to,active:r.active};return r})};
 payPaint()}
function payCollect(){const X=T.px;if(!X)return;const g=id=>document.getElementById(id);
 if(g('pg_s'))X.sal=g('pg_s').value.trim();if(g('pg_m'))X.meal=g('pg_m').value.trim();if(g('pg_r'))X.reason=g('pg_r').value;
 X.rows.forEach((r,k)=>{if(!g('ra_n_'+k))return;r.name=g('ra_n_'+k).value;r.amount=g('ra_a_'+k).value.trim();r.active=g('ra_x_'+k).checked;const d=g('ra_d_'+k);if(d)r.del=d.checked})}
function payAddRow(){payCollect();T.px.rows.push({id:null,name:'',kind:'fixed_monthly',amount:'',from:payNext(),to:'',active:true,del:false});payPaint()}
function payDropRow(k){payCollect();T.px.rows.splice(k,1);payPaint()}
function payPaint(){const X=T.px,e=D.emp[X.i];
 modal(`<h3>Data Gaji — ${esc(e.nama)}</h3><label>Gaji bulanan (Rp)<input id="pg_s" type="number" inputmode="numeric" min="0" value="${esc(X.sal)}"></label><label>Tarif uang makan per hari (Rp)<input id="pg_m" type="number" inputmode="numeric" min="0" value="${esc(X.meal)}"></label><h4>Tunjangan</h4><p class="mu">Tunjangan berlaku otomatis setiap gaji, mulai periode berikutnya. Matikan "Aktif" untuk berhenti.</p>${X.rows.map((r,k)=>`<div class="card" style="padding:10px;margin:8px 0"><label>Nama tunjangan<input id="ra_n_${k}" value="${esc(r.name)}" autocomplete="off"></label><label>Nominal per bulan (Rp)<input id="ra_a_${k}" type="number" inputmode="numeric" min="0" value="${esc(r.amount)}"></label><div class="row"><label><input type="checkbox" id="ra_x_${k}" ${r.active?'checked':''}> Aktif</label>${r.id?`<label><input type="checkbox" id="ra_d_${k}" ${r.del?'checked':''}> Hapus (nonaktifkan, riwayat tetap)</label>`:`<button class="btn s x" onclick="payDropRow(${k})">Buang baris</button>`}</div></div>`).join('')||'<p class="mu">Belum ada tunjangan.</p>'}<div class="row"><button class="btn s" onclick="payAddRow()">+ Tambah tunjangan</button></div><label>Alasan perubahan tunjangan (wajib jika mengubah / menghapus yang sudah ada)<input id="pg_r" value="${esc(X.reason)}" autocomplete="off"></label><div class="row"><button class="btn s" onclick="closeM()">Batal</button><button class="btn" onclick="paySaveAll()">Simpan semua</button></div>`)}
async function paySaveAll(){payCollect();const X=T.px,e=D.emp[X.i];
 if(X.sal===''||X.meal==='')return toast('Gaji dan tarif makan wajib diisi (isi 0 bila tidak ada)','err');
 if(+X.sal<0||+X.meal<0)return toast('Nominal tidak boleh negatif','err');
 const rows=[];let changed=false;
 for(const r of X.rows){
  if(r.id&&r.del){rows.push({id:r.id,action:'delete'});changed=true;continue}
  if(!r.id&&!r.name.trim()&&r.amount==='')continue;
  if(!r.name.trim())return toast('Nama tunjangan wajib diisi','err');
  if(r.amount===''||+r.amount<0)return toast('Nominal tunjangan "'+r.name+'" tidak valid','err');
  if(!r.from)r.from=payNext();
  if(r.kind=='period_special'&&!r.to)return toast('Tunjangan khusus "'+r.name+'" wajib tanggal sampai','err');
  if(r.kind=='fixed_monthly'&&r.to)r.to='';
  if(r.to&&r.to<r.from)return toast('Tanggal sampai tunjangan "'+r.name+'" lebih awal dari mulai','err');
  const row={name:r.name.trim(),kind:r.kind,amount:+r.amount,valid_from:r.from,valid_to:r.to||null,active:!!r.active};
  if(!r.id){rows.push({action:'add',...row});changed=true;continue}
  const o=r.orig;
  if(!o||o.name!=row.name||o.kind!=row.kind||o.amount!=row.amount||o.from!=row.valid_from||o.to!=(row.valid_to||'')||o.active!=row.active){rows.push({id:r.id,action:'update',...row});changed=true}
 }
 const pp=PAY.pp[String(e.id)]||{},salChanged=!PAY.pp[String(e.id)]||+pp.monthly_salary!==+X.sal||+pp.meal_rate!==+X.meal;
 if(!changed&&!salChanged){closeM();return toast('Tidak ada perubahan')}
 const butuhAlasan=salChanged||rows.some(r=>r.action!='delete');
 if(butuhAlasan&&!X.reason.trim())return toast('Isi alasan perubahan gaji/tunjangan','err');
 const ok=await sbRun(async()=>{await payRpc('payroll_save_employee_pay',{p_employee:e.id,p_monthly_salary:+X.sal,p_meal_rate:+X.meal,p_rows:rows,p_reason:X.reason.trim()||'Hapus tunjangan'})});
 if(ok){closeM();toast('Data gaji tersimpan: '+e.nama);payLoad()}}

/* ===== PDF (pembuat PDF sederhana, tanpa library luar) ===== */
const pdfEsc=s=>String(s==null?'':s).replace(/[^\x20-\x7E\xA0-\xFF]/g,'?').replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');
const pdfW=(s,z)=>{let w=0;for(const c of String(s))w+=/[0-9]/.test(c)?556:(c==' '||c=='.'||c==',')?278:c=='-'?333:c=='R'?722:556;return w*z/1000};
function pdfBuild(pages){const o=[];o.push('<< /Type /Catalog /Pages 2 0 R >>');
 o.push('<< /Type /Pages /Kids ['+pages.map((_,i)=>(6+2*i)+' 0 R').join(' ')+'] /Count '+pages.length+' >>');
 o.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
 o.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
 pages.forEach((ops,i)=>{const cs=ops.map(p=>{if(p.k=='l')return p.x1.toFixed(1)+' '+p.y1.toFixed(1)+' m '+p.x2.toFixed(1)+' '+p.y2.toFixed(1)+' l S';if(p.k=='r')return (p.fill?p.fill+' rg '+p.x.toFixed(1)+' '+p.y.toFixed(1)+' '+p.w.toFixed(1)+' '+p.h.toFixed(1)+' re f\n':'')+'0.55 G '+p.x.toFixed(1)+' '+p.y.toFixed(1)+' '+p.w.toFixed(1)+' '+p.h.toFixed(1)+' re S';return (p.c||'0 0 0')+' rg BT /'+(p.b?'F2':'F1')+' '+p.z+' Tf '+p.x.toFixed(1)+' '+p.y.toFixed(1)+' Td ('+pdfEsc(p.s)+') Tj ET'}).join('\n');
  o.push('<< /Length '+cs.length+' >>\nstream\n'+cs+'\nendstream');
  o.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents '+(5+2*i)+' 0 R >>')});
 let out='%PDF-1.4\n';const off=[];o.forEach((x,i)=>{off.push(out.length);out+=(i+1)+' 0 obj\n'+x+'\nendobj\n'});
 const xr=out.length;out+='xref\n0 '+(o.length+1)+'\n0000000000 65535 f \n'+off.map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size '+(o.length+1)+' /Root 1 0 R >>\nstartxref\n'+xr+'\n%%EOF';
 const u=new Uint8Array(out.length);for(let i=0;i<out.length;i++)u[i]=out.charCodeAt(i)&255;return new Blob([u],{type:'application/pdf'})}
const pdfT=(o,x,y,s,z,b)=>o.push({k:'t',x,y,s,z:z||10,b:!!b});
const pdfR=(o,xr,y,s,z,b)=>o.push({k:'t',x:xr-pdfW(s,z||10),y,s,z:z||10,b:!!b});
const pdfL=(o,y,x1,x2)=>o.push({k:'l',x1:x1||50,y1:y,x2:x2||545,y2:y});
const issTxt=a=>(a||[]).map(k=>({no_salary:'gaji belum diisi',recap_not_approved:'rekap absensi belum disetujui',blank_days:'ada absensi kosong',unknown_status:'ada kode absensi tidak dikenal'}[k]||k)).join(', ');
const pdfSt=run=>run&&run.status=='finalized'?'FINAL - periode dikunci':'DRAFT - belum difinalisasi';

const payCo=()=>({nama:(typeof TH!='undefined'&&TH.name)||'BAR APP',alamat:(PAY.s&&PAY.s.company_address)||''});
const pdfRc=(o,x,y,w,h,fill)=>o.push({k:'r',x,y,w,h,fill});
const pdfCT=(o,x,y,s,z,b,c)=>o.push({k:'t',x,y,s,z:z||10,b:!!b,c});
const pdfCTR=(o,xr,y,s,z,b,c)=>o.push({k:'t',x:xr-pdfW(s,z||10),y,s,z:z||10,b:!!b,c});
const pdfCTC=(o,xc,y,s,z,b,c)=>o.push({k:'t',x:xc-pdfW(s,z||10)/2,y,s,z:z||10,b:!!b,c});
const NAVY='0.12 0.22 0.42',LIGHT='0.86 0.9 0.96',WHITE='1 1 1';
function slipOps(it,als,run,f,t){
 const o=[],co=payCo(),st=pdfSt(run),L=50,R=545,M=297;
 const dv=(T.divs||[]).find(d=>d.id==it.division_id),emp=D.emp.find(x=>String(x.id)==String(it.employee_id));
 const izin=+it.izin_deduction||0,monthly=+it.monthly_salary||0,meal=+it.meal_total||0,ot=+it.overtime_total||0,kas=+it.kasbon_deduction||0,allow=+it.allowance_total||0;
 let y=800;
 pdfCTC(o,M,y,'SLIP GAJI',16,1);y-=20;
 pdfCTC(o,M,y,co.nama,11,1);y-=14;
 if(co.alamat){pdfCTC(o,M,y,co.alamat,9);y-=12}
 pdfCTC(o,M,y,'Periode gaji: '+fdp(f)+' s/d '+fdp(t),9);y-=12;
 pdfCTC(o,M,y,'Status: '+st,8);y-=8;
 pdfL(o,y,L,R);y-=12;
 /* Informasi karyawan */
 pdfRc(o,L,y-14,R-L,16,NAVY);pdfCT(o,L+6,y-10,'INFORMASI KARYAWAN',9,1,WHITE);y-=24;
 const info=[['Nama Karyawan',it.employee_name,'Divisi',dv?dv.name:'-'],['Jabatan',(emp&&emp.jab)||'-','Periode Gaji',fdp(f)+' - '+fdp(t)],['ID Karyawan',String(it.employee_id||'').slice(0,8).toUpperCase(),'Status',st.split(' - ')[0]]];
 info.forEach(r=>{pdfRc(o,L,y-4,100,15,NAVY);pdfCT(o,L+5,y,r[0],8,1,WHITE);pdfCT(o,L+106,y,String(r[1]),9);pdfRc(o,300,y-4,100,15,NAVY);pdfCT(o,305,y,r[2],8,1,WHITE);pdfCT(o,406,y,String(r[3]),9);y-=18});
 y-=6;
 /* Ringkasan gaji */
 pdfRc(o,L,y-14,R-L,16,NAVY);pdfCT(o,L+6,y-10,'RINGKASAN GAJI',9,1,WHITE);y-=16;
 const pend=[['Gaji Pokok',monthly],['Tunjangan Makan ('+(it.meal_days||0)+' hari)',meal]].concat(als.map(a=>[a.name+(a.kind=='period_special'?' (khusus)':''),+a.amount||0])).concat([['Lembur ('+(it.overtime_hours||0)+' jam)',ot]]);
 const pot=[['Potongan hari tidak dibayar ('+(it.unpaid_days||0)+' hari)',izin],['Kasbon / Pinjaman',kas]];
 const n=Math.max(pend.length,pot.length),th=16+n*14+16,top=y;
 pdfRc(o,L,top-th,R-L,th,null);
 pdfRc(o,L,top-16,R-L,16,LIGHT);
 pdfCT(o,L+6,top-11,'PENDAPATAN',8,1);pdfCTR(o,290,top-11,'JUMLAH',8,1);pdfCT(o,306,top-11,'POTONGAN',8,1);pdfCTR(o,R-6,top-11,'JUMLAH',8,1);
 pdfL(o,top-16,L,R);
 pdfL(o,top-th+16,L,R);
 pdfL(o,top-th,L,L);
 for(let i=0;i<n;i++){const yy=top-16-14*(i+1)+4;
  if(pend[i]){pdfCT(o,L+6,yy,pend[i][0],9);pdfCTR(o,290,yy,rupiah(pend[i][1]),9)}
  if(pot[i]){pdfCT(o,306,yy,pot[i][0],9);pdfCTR(o,R-6,yy,rupiah(pot[i][1]),9)}}
 const totPend=pend.reduce((x,r)=>x+r[1],0),totPot=pot.reduce((x,r)=>x+r[1],0);
 const yt=top-16-14*n-12;
 pdfL(o,yt+12,L,R);
 pdfCT(o,L+6,yt,'Total Pendapatan',9,1);pdfCTR(o,290,yt,rupiah(totPend),9,1);
 pdfCT(o,306,yt,'Total Potongan',9,1);pdfCTR(o,R-6,yt,rupiah(totPot),9,1);
 pdfL(o,top-th,L,R);
 y=top-th-14;
 /* Ringkasan kehadiran */
 pdfRc(o,L,y-14,R-L,16,NAVY);pdfCT(o,L+6,y-10,'RINGKASAN KEHADIRAN',9,1,WHITE);y-=16;
 const heads=['Hari Masuk','Hari Libur','PH','Sakit','Izin','Hari Dibayar','Tidak Dibayar'];
 const vals=[it.cnt_m||0,it.cnt_l||0,it.cnt_ph||0,it.cnt_s||0,it.cnt_i||0,it.paid_days||0,it.unpaid_days||0];
 const cw=(R-L)/7;
 pdfRc(o,L,y-14,R-L,14,LIGHT);
 heads.forEach((h,i)=>pdfCTC(o,L+cw*i+cw/2,y-10,h,7,1));
 y-=14;
 vals.forEach((v,i)=>pdfCTC(o,L+cw*i+cw/2,y-12,String(v),10,1));
 pdfRc(o,L,y-18,R-L,18,null);
 for(let i=1;i<7;i++)o.push({k:'l',x1:L+cw*i,y1:y+14,x2:L+cw*i,y2:y-18});
 y-=26;
 /* Total final */
 pdfRc(o,L,y-30,R-L,30,NAVY);
 pdfCT(o,L+10,y-12,'TOTAL FINAL YANG DITERIMA',11,1,WHITE);
 pdfCTR(o,R-10,y-12,rupiah(Math.abs(+it.net_pay)),13,1,WHITE);
 y-=40;
 pdfCT(o,L,y,'Dibayarkan kepada karyawan sesuai periode di atas.',8);
 if(+it.net_pay<0){y-=12;pdfCT(o,L,y,'Nilai negatif: kewajiban karyawan yang harus diselesaikan, bukan pembayaran tunai.',8)}

 return o}
function rekapPages(items,run,f,t){const pages=[],edges=[235,292,349,406,463,545],hd=['Gaji','Potongan','Makan','Tunjangan','Kasbon','Net'];let o,y;
 const head=()=>{o=[];pages.push(o);y=800;pdfT(o,50,y,((typeof TH!='undefined'&&TH.name)||'BAR APP')+' - REKAP GAJI',13,1);y-=15;pdfT(o,50,y,'Periode: '+fdp(f)+' s/d '+fdp(t)+'    Status: '+pdfSt(run),9);y-=12;pdfL(o,y);y-=14;pdfT(o,50,y,'Nama',8,1);hd.forEach((h,i)=>pdfR(o,edges[i],y,h,8,1));y-=6;pdfL(o,y);y-=12};
 head();const tot=[0,0,0,0,0,0];
 items.forEach(it=>{if(y<70)head();const v=[it.monthly_salary,it.izin_deduction,it.meal_total,it.allowance_total,it.kasbon_deduction,it.net_pay];v.forEach((x,i)=>tot[i]+=+x||0);pdfT(o,50,y,String(it.employee_name).slice(0,24),8);v.forEach((x,i)=>pdfR(o,edges[i],y,fmtN(x),8));y-=12});
 if(y<80)head();pdfL(o,y+8);y-=4;pdfT(o,50,y,'TOTAL',8,1);tot.forEach((x,i)=>pdfR(o,edges[i],y,fmtN(x),8,1));return pages}

/* ===== 3. TERIMA LAPORAN (PDF per nama) ===== */
function payBuildUrls(){Object.values(PAY.urls).forEach(u=>{try{URL.revokeObjectURL(u)}catch(e){}});PAY.urls={};const r=PAY.rep;if(!r)return;
 r.items.forEach(it=>{PAY.urls[it.id]=URL.createObjectURL(pdfBuild([slipOps(it,r.al.filter(a=>a.item_id==it.id),r.run,r.f,r.t)]))});
 PAY.urls.all=URL.createObjectURL(pdfBuild(rekapPages(r.items,r.run,r.f,r.t)))}
/* ===== Pengaturan (developer) ===== */
V.pay_set=()=>{if(!payOK())return payDenied();payEnsure();const s=PAY.s||{period_mode:'calendar',meal_codes:['M']},c=s.meal_codes||[];
 const chip=k=>`<label style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border:1px solid #ecd6cf;border-radius:12px;background:#fff;cursor:pointer;font-weight:600"><input type="checkbox" id="mc_${k}" ${c.includes(k)?'checked':''} style="width:auto;margin:0">${k}</label>`;
 const body=`<div style="display:grid;gap:14px"><label>Mode periode<select id="pm"><option value="calendar" ${s.period_mode!='day_24_23'?'selected':''}>Tanggal 1 s/d akhir bulan</option><option value="day_24_23" ${s.period_mode=='day_24_23'?'selected':''}>Tanggal 24 s/d 23</option></select></label>
 <div><div class="mu" style="margin-bottom:8px">Kode absensi yang dapat uang makan</div><div style="display:flex;gap:8px;flex-wrap:wrap">${['M','L','PH','S','I'].map(chip).join('')}</div></div>
 <label>Alamat perusahaan (dicetak di slip)<input id="co_addr" value="${esc((PAY.s&&PAY.s.company_address)||'')}" autocomplete="off"></label>
 <div><button class="btn" onclick="paySaveSet()">Simpan aturan</button></div></div>`;
 const emp=D.emp.length?`<div style="overflow-x:auto"><table style="font-size:12px"><tr><th>Nama</th><th>Jabatan</th><th>Aktif</th><th></th></tr>${D.emp.map((e,i)=>`<tr><td>${esc(e.nama)}</td><td>${esc(e.jab)||'-'}</td><td>${e.aktif?'Ya':'Tidak'}</td><td style="white-space:nowrap"><button class="btn s x" onclick="openEmp(${i})">Edit</button></td></tr>`).join('')}</table></div><div style="margin-top:10px"><button class="btn" onclick="openEmp(-1)">+ Tambah karyawan</button></div>`:`<div style="margin-bottom:10px"><button class="btn" onclick="openEmp(-1)">+ Tambah karyawan</button></div>`;
 return payBlk('set_main','Periode & Uang Makan',body,true)};
async function paySaveSet(){const m=v('pm'),codes=['M','L','PH','S','I'].filter(k=>document.getElementById('mc_'+k)&&document.getElementById('mc_'+k).checked);
 const ok=await sbRun(async()=>{const {error}=await sb().from('payroll_settings').update({period_mode:m,custom_start_day:null,custom_end_day:null,meal_codes:codes,company_address:v('co_addr').trim()||null}).eq('id',true);if(error)throw error});
 if(ok){toast('Aturan tersimpan');payLoad()}}

/* ===== Kasbon ===== */
const kasSemua=()=>{const rows=D.emp.map(e=>{const l=PAY.cash.filter(c=>String(c.employee_id)==String(e.id)&&c.status!='void'&&(PAY.bal[c.id]==null||PAY.bal[c.id]>0));return {e,n:l.length,sisa:l.reduce((t,c)=>t+(+PAY.bal[c.id]||0),0),pot:l.reduce((t,c)=>t+(+c.installment||0),0)}}).filter(r=>r.n>0);
 if(!rows.length)return '<p class="mu">Belum ada karyawan yang punya kasbon aktif.</p>';
 const tot=rows.reduce((t,r)=>t+r.sisa,0),pot=rows.reduce((t,r)=>t+r.pot,0);
 return `<div style="overflow-x:auto"><table style="font-size:12px"><tr><th>Nama</th><th>Kasbon aktif</th><th>Total sisa</th><th>Potong / periode</th></tr>${rows.map(r=>`<tr><td>${esc(r.e.nama)}</td><td>${r.n}</td><td>${rupiah(r.sisa)}</td><td>${rupiah(r.pot)}</td></tr>`).join('')}<tr><td><b>Total</b></td><td></td><td><b>${rupiah(tot)}</b></td><td><b>${rupiah(pot)}</b></td></tr></table></div>`};
V.pay_kas=()=>{if(!payOK())return payDenied();payEnsure();if(!T.outlets||!T.allDivs){setTimeout(async()=>{try{await outInit();if(!T.allDivs)T.allDivs=await payQ('divisions','id,name,code,outlet_id');R()}catch(e){}},0)}if(!D.emp.length)return '<div class="card empty">Belum ada karyawan.</div>';
 return payBlk('kas_semua','Siapa yang punya kasbon',kasSemua(),true)+payBlk('kas_baru','Tambah kasbon baru',kasSel()+kasForm(),false)};
function kasForm(){return `<label>Pokok (maks Rp 1.000.000)<input id="kp" type="number" min="1" max="1000000" inputmode="numeric"></label><label>Dipotong dalam berapa periode gaji<input id="kn2" type="number" min="1" max="60" inputmode="numeric" value="1"></label><p class="mu" style="margin:0 0 10px">Potongan per periode = pokok ÷ jumlah periode. Otomatis dipotong saat gaji dihitung sampai lunas.</p><label>Tanggal<input id="kd" type="date" value="${today()}"></label><label>Keterangan<input id="kn" autocomplete="off"></label><div style="margin-top:10px"><button class="btn" onclick="cashAdd(document.getElementById('kn1')?.value)">Simpan kasbon</button></div>`}

function kasSel(){const outs=(T.outlets||[]).filter(o=>o&&o.id);let kOut=T.kOut||'';if(!outs.some(o=>o.id==kOut))kOut=outs[0]?outs[0].id:'';const dvs=(T.allDivs||[]).filter(d=>d.outlet_id==kOut);let kDiv=T.kDiv||'';if(kDiv&&!dvs.some(d=>d.id==kDiv))kDiv='';const cands=D.emp.filter(x=>x.aktif&&x.o==kOut&&(!kDiv||x.dv==kDiv));
 return `<label>Outlet<select onchange="T.kOut=this.value;T.kDiv='';R()">${outs.map(o=>`<option value="${o.id}" ${o.id==kOut?'selected':''}>${esc(o.name)} (${esc(o.code)})</option>`).join('')}</select></label>`+
 `<label>Divisi<select onchange="T.kDiv=this.value;R()"><option value="">Semua divisi</option>${dvs.map(d=>`<option value="${d.id}" ${d.id==kDiv?'selected':''}>${esc(d.name)}</option>`).join('')}</select></label>`+
 `<label>Nama<select id="kn1">${cands.map(x=>`<option value="${x.id}">${esc(x.nama)}</option>`).join('')||'<option value="">Tidak ada karyawan</option>'}</select></label>`}

async function cashAdd(eid){const p=+v('kp'),n=+v('kn2'),d=v('kd'),note=v('kn').trim()||null;
 if(!eid)return toast('Pilih karyawan terlebih dahulu','err');
 if(!(p>0)||!Number.isInteger(p))return toast('Pokok kasbon wajib berupa nominal rupiah yang valid','err');
 if(p>1000000)return toast('Maksimal kasbon Rp 1.000.000','err');
 if(!(n>=1&&Number.isInteger(n)))return toast('Jumlah periode potongan minimal 1','err');
 if(!d)return toast('Tanggal wajib','err');
 const cicil=Math.ceil(p/n);
 const ok=await sbRun(async()=>{const {error}=await sb().from('cashadvances').insert({employee_id:eid,principal:p,installment:cicil,issued_on:d,notes:note});if(error)throw error});
 if(ok){toast('Kasbon dicatat');payLoad()}}
function cashVoid(id){const c=PAY.cash.find(x=>x.id==id);if(!c)return;const b=PAY.bal[id];
 if(b!=null&&+b!==+c.principal)return toast('Kasbon sudah ada pembayaran / potongan, tidak bisa dibatalkan','err');
 cf('Batalkan kasbon ini? Riwayat akan tetap tersimpan.',async()=>{const ok=await sbRun(async()=>{await payRpc('cashadvance_void',{p_id:id,p_reason:'Dibatalkan dari aplikasi'})});if(ok){toast('Kasbon dibatalkan');payLoad()}},'Ya, batalkan')}
function cashPay(id){const sisa=PAY.bal[id]??0;modal(`<h3>Bayar kasbon</h3><p class="mu">Sisa kasbon: ${rupiah(sisa)}</p><label>Jumlah pembayaran (Rp)<input id="cpAmt" type="number" inputmode="numeric" min="1" autocomplete="off"></label><div class="row"><button class="btn s" onclick="closeM()">Batal</button><button class="btn" onclick="cashPaySave('${id}')">Simpan pembayaran</button></div>`)}
async function cashPaySave(id){if(window.__cashPayBusy)return;const sisa=PAY.bal[id]??0,n=+v('cpAmt');if(!(n>0)||!Number.isSafeInteger(n))return toast('Jumlah harus berupa nominal rupiah yang valid','err');if(n>sisa)return toast('Melebihi sisa kasbon','err');
 const requestKey=(window.crypto&&typeof window.crypto.randomUUID==='function')?window.crypto.randomUUID():('cashpay-'+Date.now()+'-'+Math.random().toString(36).slice(2));
 window.__cashPayBusy=true;
 try{const ok=await sbRun(async()=>{await payRpc('cashadvance_register_payment',{p_id:id,p_amount:n,p_tx_date:today(),p_notes:'Pembayaran tunai',p_request_key:requestKey})});if(ok){closeM();toast('Pembayaran dicatat');payLoad()}}
 finally{window.__cashPayBusy=false}}

/* ===== Hitung & Finalisasi ===== */
V.pay_lap=()=>{if(!payOK())return payDenied();payEnsure();
 if(!PAY.lapInit){PAY.lapInit=true;setTimeout(payFind,0)}
 const [pf,pt]=payDefRange(),f=T.rf||pf,t=T.rt||pt,r=PAY.run,fin=!!r&&r.status=='finalized',calc=!!r&&r.status=='calculated';
 const rows=r?PAY.items.map(x=>({id:x.id,nm:x.employee_name,paid:x.paid_days,gaji:(+x.monthly_salary)-(+x.izin_deduction),meal:x.meal_total,allow:x.allowance_total,ot:x.overtime_total||0,kas:x.kasbon_deduction,net:x.net_pay,iss:issTxt(x.issues)})):
  D.emp.filter(e=>e.aktif).map(e=>{const q=payEst(e,f,t);return {id:null,nm:e.nama,paid:q.paid,gaji:q.earned,meal:q.mt,allow:q.al,ot:q.ot,kas:q.ks,net:q.net,iss:q.has?'':'gaji belum diisi'}});
 const tot=rows.reduce((n,x)=>n+(+x.net||0),0);
 const stat=r?`Status: <b>${r.status}</b>${fin?' (final, terkunci)':' (draft)'}`:'Belum dihitung. Angka di bawah estimasi dari absensi.';
 const aksi=`<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px"><button class="btn" onclick="payCalc()">Hitung payroll</button><button class="btn s x" onclick="payFind()">Muat ulang</button></div>`+
  (calc?`<label style="display:flex;align-items:center;gap:8px;margin-top:12px"><input type="checkbox" id="pack" style="width:auto"> Saya sudah meninjau catatan persetujuan / lainnya</label><p class="mu" style="margin:6px 0 0">Hari absensi kosong, status tidak dikenal, dan profil gaji yang belum ada tetap harus diperbaiki.</p><div style="margin-top:10px"><button class="btn d" onclick="payFinal()">Finalisasi &amp; kunci</button></div>`:'')+
  (fin&&isDeveloper()?`<label style="margin-top:12px">Alasan void<input id="pvr" autocomplete="off"></label><div style="margin-top:10px"><button class="btn d" onclick="payVoid()">Void payroll</button></div>`:'');
 const periode=`<div style="padding:4px 2px">${payPickers(f,t)}<p class="mu" style="margin:10px 0 0">${f?fdp(f)+' s/d '+fdp(t)+' · ':''}${stat}</p>${aksi}</div>`;
 const tabel=`<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:10px"><b>${rows.length} karyawan · total net ${rupiah(tot)}</b>${PAY.urls.all?`<a class="btn s" href="${PAY.urls.all}" download="Rekap_Gaji_${f}_${t}.pdf">Rekap semua (PDF)</a>`:''}</div>
 <div class="card"><div style="overflow-x:auto"><table class="rpt"><tr><th>Nama</th><th>Hari</th><th>Gaji</th><th>Makan</th><th>Tunjangan</th><th>Lembur</th><th>Kasbon</th><th>Net</th><th>Slip</th></tr>${rows.map(x=>`<tr><td class="nmc">${esc(x.nm)}${x.iss?`<span class="sub">${esc(x.iss)}</span>`:''}</td><td>${x.paid}</td><td>${fmtN(x.gaji)}</td><td>${fmtN(x.meal)}</td><td>${fmtN(x.allow)}</td><td>${fmtN(x.ot)}</td><td>${fmtN(x.kas)}</td><td class="net">${fmtN(x.net)}</td><td style="white-space:nowrap">${x.id&&PAY.urls[x.id]?`<a class="btn s x" href="${PAY.urls[x.id]}" download="Slip_${String(x.nm).replace(/[^A-Za-z0-9]+/g,'_')}_${f}_${t}.pdf">PDF</a>`:'<span class="mu">hitung dulu</span>'}</td></tr>`).join('')||'<tr><td colspan="9">Belum ada karyawan.</td></tr>'}</table></div></div>`;
 return payBlk('lap_periode','Periode & aksi',periode,true)+payBlk('lap_rincian','Rincian gaji karyawan',tabel,false)};
async function payFind(){try{const [pf,pt]=payDefRange(),f=T.rf||pf,t=T.rt||pt;const oid=await outInit();const isLJ=oid==D.ljId;const runs=await payQ('payroll_runs','*',q=>{const x=q.eq('period_start',f).eq('period_end',t).neq('status','void');return oid===null?x.is('outlet_id',null):(isLJ?x.or(`outlet_id.eq.${oid},outlet_id.is.null`).order('outlet_id',{ascending:false,nullsFirst:false}):x.eq('outlet_id',oid))});PAY.run=runs[0]||null;PAY.items=PAY.run?await payQ('payroll_items','*',q=>q.eq('run_id',PAY.run.id).order('employee_name')):[];const ids=PAY.items.map(x=>x.id);const al=ids.length?await payQ('payroll_item_allowances','*',q=>q.in('item_id',ids)):[];PAY.rep=PAY.run?{f,t,run:PAY.run,items:PAY.items,al}:null;payBuildUrls()}catch(e){toast(errText(e),'err')}R()}
async function payCalc(){const [pf,pt]=payDefRange(),f=T.rf||pf,t=T.rt||pt;const lk=(D.per||[]).find(p=>p.s==f&&p.e==t);if(lk&&lk.lock)return toast('Periode terkunci. Buka kunci dulu untuk hitung ulang','err');const ok=await sbRun(async()=>{await payRpc('payroll_calculate',{p_outlet:await outInit(),p_start:f,p_end:t})});if(ok){toast('Payroll dihitung (termasuk lembur)');payFind()}}
async function payFinal(){if(!PAY.run)return;const key=(window.crypto&&crypto.randomUUID)?crypto.randomUUID():String(Date.now())+Math.random(),ack=!!(document.getElementById('pack')&&document.getElementById('pack').checked);
 const r0=PAY.run;const ok=await sbRun(async()=>{await payRpc('payroll_finalize',{p_run:PAY.run.id,p_key:key,p_ack_issues:ack})});if(ok){await perLoad();toast('Payroll difinalisasi & dikunci');payFind()}}
async function payVoid(){if(!PAY.run)return;const r=v('pvr').trim();if(!r)return toast('Alasan void wajib diisi','err');const ok=await sbRun(async()=>{await payRpc('payroll_void',{p_run:PAY.run.id,p_reason:r})});if(ok){await perLoad();toast('Payroll di-void, periode dibuka');payFind()}}

