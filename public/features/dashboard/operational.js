/* Data, pengolah, dan tampilan Dashboard Operasional. */
/* ===== DASHBOARD OPERASIONAL ===== */
const OD={from:'',to:'',division:'',loading:false,ready:false,error:'',closing:[],detail:null};
const odToday=()=>today();
const odStart=()=>{const fmt=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');if(!OD.from&&!OD.to){const now=new Date(odToday()+'T12:00:00');OD.from=fmt(new Date(now.getFullYear(),now.getMonth(),1,12));OD.to=fmt(new Date(now.getFullYear(),now.getMonth()+1,0,12));return}if(!OD.from){const d=new Date((OD.to||odToday())+'T12:00:00');OD.from=fmt(new Date(d.getFullYear(),d.getMonth(),1,12))}if(!OD.to){const d=new Date(OD.from+'T12:00:00');OD.to=fmt(new Date(d.getFullYear(),d.getMonth()+1,0,12))}};
const odN=n=>new Intl.NumberFormat('id-ID',{maximumFractionDigits:2}).format(Number(n)||0);
const odRp=n=>'Rp '+new Intl.NumberFormat('id-ID',{maximumFractionDigits:0}).format(Number(n)||0);
const odDateLabel=d=>{try{return new Date(d+'T12:00:00').toLocaleDateString('id-ID',{day:'2-digit',month:'short'})}catch(e){return d}};
const odInRange=(d)=>String(d||'')>=OD.from&&String(d||'')<=OD.to;
const odDivisionRows=()=>OD.division?CG.divs.filter(d=>String(d.id)===String(OD.division)):CG.divs.slice();
const odFilter=(rows,field)=>{const ids=new Set(odDivisionRows().map(d=>String(d.id)));return (rows||[]).filter(x=>ids.has(String(x.division_id))&&odInRange(x[field])&&(!x.status||!['cancelled','void','voided','rejected'].includes(String(x.status).toLowerCase())))};
const odStockOutFilter=(rows)=>{const ids=new Set(odDivisionRows().map(d=>String(d.id)));return (rows||[]).filter(x=>{const category=String(x.category||'').toLowerCase(),isMove=['move','transfer'].includes(category),from=String(x.from_division_id||''),to=String(x.to_division_id||'');const divisionMatch=isMove?(ids.has(from)||ids.has(to)):ids.has(from);return divisionMatch&&odInRange(x.out_date)&&(!x.status||!['cancelled','void','voided','rejected'].includes(String(x.status).toLowerCase()))})};
const odStat=(label,value,sub,icon,key)=>'<button type="button" class="card od-stat" onclick="odOpenCard(\''+key+'\')" style="text-align:left;cursor:pointer;margin:0;min-width:0;width:100%;padding:14px;color:inherit;font:inherit;display:block"><div style="display:flex;align-items:center;gap:8px;color:var(--muted,#777);font-size:12px">'+IC(icon||'chart-no-axes-combined',17)+'<span>'+label+'</span></div><div style="font-size:clamp(20px,3.5vw,27px);font-weight:800;line-height:1.2;margin:9px 0;overflow-wrap:anywhere">'+value+'</div><div style="font-size:11px;color:var(--muted,#777)">'+sub+'</div><div style="font-size:10px;color:var(--accent,#7c9866);margin-top:8px">Lihat detail →</div></button>';
function odOpenCard(key){
 if(!OD.ready)return toast('Data dashboard belum siap.','warn');
 const sales=odFilter(CG.sales,'sold_at'),prod=odFilter(CG.productions,'produced_at'),ins=odFilter(INV.ins,'received_at'),outs=odStockOutFilter(INV.stockOut),sos=odFilter(CG.dailySO,'so_date'),sup=odFilter(INV.suppliesSO,'so_date');
 const move=outs.filter(x=>['move','transfer'].includes(String(x.category||'').toLowerCase()));
 const expense=outs.filter(x=>!['move','transfer'].includes(String(x.category||'').toLowerCase()));
 const soLines=CG.dailySOLines.filter(l=>sos.some(s=>String(s.id)===String(l.so_id)));
 const variance=soLines.filter(l=>Math.abs(Number(l.variance_qty_base)||0)>0.000001);
 const rp=n=>odRp(Number(n)||0),qty=n=>odN(Number(n)||0),escv=x=>esc(x==null?'—':String(x));
 let title='',rows=[],headers=[];
 const add=(arr,head)=>{rows=arr;headers=head};
 if(key==='sales'){title='Detail omzet penjualan menu';add(sales.map(x=>[x.sold_at,x.menu_name_snapshot||CG.menus.find(m=>String(m.id)===String(x.menu_id))?.name||'Menu',qty(x.qty),rp(x.gross_sales_snapshot),rp(x.total_hpp_snapshot)]),['Tanggal','Menu','Qty','Omzet','HPP'])}
 else if(key==='hpp'){title='Detail HPP menu terjual';add(sales.map(x=>[x.sold_at,x.menu_name_snapshot||'Menu',qty(x.qty),rp(x.total_hpp_snapshot),rp(Number(x.gross_sales_snapshot||0)-Number(x.total_hpp_snapshot||0))]),['Tanggal','Menu','Qty','HPP','Margin kotor'])}
 else if(key==='incoming'){title='Detail barang masuk';add(ins.map(x=>[x.received_at,x.item_name_snapshot||cgItem(x.item_id)?.name||'Barang',suppliesDivName(x.division_id),qty(x.qty_base),rp(x.invoice_total??x.estimated_total)]),['Tanggal','Barang','Divisi','Qty dasar','Nilai'])}
 else if(key==='expense'){title='Detail pengeluaran stok';add(expense.map(x=>[x.out_date,x.category||'Lainnya',x.item_name_snapshot||cgItem(x.item_id)?.name||'Barang',suppliesDivName(x.from_division_id),qty(x.qty_base)]),['Tanggal','Kategori','Barang','Divisi asal','Qty'])}
 else if(key==='production'){title='Detail produksi WIP';add(prod.map(x=>[x.produced_at,opsWip(x.wip_id)?.name||x.wip_name_snapshot||'WIP',suppliesDivName(x.division_id),qty(x.produced_qty),rp(x.total_cost_snapshot)]),['Tanggal','WIP','Divisi','Qty produksi','Nilai'])}
 else if(key==='variance'){title='Detail selisih Daily SO';add(variance.map(l=>{const so=CG.dailySO.find(s=>String(s.id)===String(l.so_id));return [so?.so_date||'—',opsDivName(so?.division_id),l.component_name_snapshot||'Item',qty(l.variance_qty_base),rp(Math.abs(Number(l.variance_value_snapshot)||0))]}),['Tanggal','Divisi','Item','Selisih qty','Nilai selisih'])}
 else if(key==='dailyso'){title='Detail Daily SO tersimpan';add(sos.map(x=>[x.so_date,opsDivName(x.division_id),x.status||'—',qty(CG.dailySOLines.filter(l=>String(l.so_id)===String(x.id)).length)]),['Tanggal','Divisi','Status','Jumlah item'])}
 else if(key==='supplies'){title='Detail SO Supplies';add(sup.map(x=>[x.so_date,suppliesDivName(x.division_id),x.status||'—',x.id]),['Tanggal','Divisi','Status','ID rekapan'])}
 else if(key==='move'){title='Detail Move antar-divisi';add(move.map(x=>[x.out_date,x.item_name_snapshot||cgItem(x.item_id)?.name||'Barang',suppliesDivName(x.from_division_id),suppliesDivName(x.to_division_id),qty(x.qty_base),rp(x.estimated_total??x.total_value_snapshot)]),['Tanggal','Barang','Divisi asal','Divisi penerima','Qty dasar','Nilai'])}
 else if(key==='closing'){title='Detail Approval Closing';add(OD.closing.map(x=>[x.closing_date,suppliesDivName(x.division_id),x.status||'—',x.approved_at||'—']),['Tanggal','Divisi','Status','Waktu approval'])}
 OD.detail={key,title,rows:rows.map(r=>r.slice()),headers:headers.slice()};
 const byDate={};rows.forEach((r,i)=>{const date=String(r[0]||'—').slice(0,10);if(!byDate[date])byDate[date]=[];byDate[date].push(i)});
 const dates=Object.keys(byDate).sort((a,b)=>b.localeCompare(a));
 const table=dates.length?'<div style="overflow:auto;max-width:100%"><table style="width:100%;border-collapse:collapse;min-width:320px"><thead><tr><th style="text-align:left;padding:9px;border-bottom:1px solid var(--line,#ddd)">Tanggal</th><th style="text-align:left;padding:9px;border-bottom:1px solid var(--line,#ddd)">Jumlah transaksi</th><th style="text-align:center;padding:9px;border-bottom:1px solid var(--line,#ddd)">Detail</th></tr></thead><tbody>'+dates.map(d=>'<tr><td style="padding:11px 9px;border-bottom:1px solid var(--line,#ddd);font-weight:700;white-space:nowrap">'+escv(d)+'</td><td style="padding:11px 9px;border-bottom:1px solid var(--line,#ddd)">'+byDate[d].length+'</td><td style="padding:8px;text-align:center;border-bottom:1px solid var(--line,#ddd)"><button type="button" class="btn s" onclick="odOpenCardDate(\''+key+'\',\''+d+'\')">Detail</button></td></tr>').join('')+'</tbody></table></div>':'<div class="empty">Tidak ada transaksi untuk kategori ini pada rentang tanggal dan divisi yang dipilih.</div>';
 modal('<h3>'+title+'</h3><p class="mu">Mengikuti filter tanggal dan divisi dashboard. Pilih Detail pada tanggal untuk melihat seluruh transaksi hari itu.</p>'+table+'<div class="btns"><button class="btn s" onclick="closeM()">Tutup</button></div>');
}
function odOpenCardDate(key,date){
 const d=OD.detail;if(!d||d.key!==key)return toast('Detail tidak tersedia. Buka ulang card dashboard.','warn');
 const rows=d.rows.filter(r=>String(r[0]||'—').slice(0,10)===date),headers=d.headers,escv=x=>esc(x==null?'—':String(x));
 const table=rows.length?'<div style="overflow:auto;max-width:100%"><table style="width:100%;border-collapse:collapse;min-width:540px"><thead><tr>'+headers.map(h=>'<th style="text-align:left;padding:9px;border-bottom:1px solid var(--line,#ddd)">'+h+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(v=>'<td style="padding:9px;border-bottom:1px solid var(--line,#ddd)">'+escv(v)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>':'<div class="empty">Tidak ada transaksi pada tanggal ini.</div>';
 modal('<h3>'+d.title+' · '+escv(date)+'</h3><p class="mu">'+rows.length+' transaksi pada tanggal ini.</p>'+table+'<div class="btns"><button class="btn s" onclick="odOpenCard(\''+key+'\')">Kembali</button><button class="btn s" onclick="closeM()">Tutup</button></div>');
}
async function odLoad(){
 if(OD.loading)return;OD.loading=true;OD.error='';
 try{
  await Promise.all([CG.ready?Promise.resolve():cgLoad(false),INV.ready?Promise.resolve():invLoad(false)]);
  if(!CG.ready)throw new Error(CG.err||'Data operasional gagal dimuat');
  OD.ready=true;
  try{const ids=odDivisionRows().map(d=>d.id);if(ids.length){const {data,error}=await sb().from('barapp_closing_periods').select('id,division_id,closing_date,status,approved_at').in('division_id',ids).gte('closing_date',OD.from).lte('closing_date',OD.to).order('closing_date',{ascending:false}).limit(500);if(error)throw error;OD.closing=data||[]}else OD.closing=[]}catch(e){OD.closing=[]}
 }catch(e){OD.error=String(e?.message||e);OD.ready=false}
 finally{OD.loading=false;if(pg==='ops_dashboard')R()}
}
function odSet(k,val){OD[k]=val;if(k==='to'&&OD.from>OD.to)OD.from=OD.to;if(k==='from'&&OD.to<OD.from)OD.to=OD.from;OD.ready=false;R()}
function odRefresh(){OD.ready=false;OD.error='';odLoad()}
function odView(){
 odStart();
 if(!adm()&&!(T.dbRole==='guest_arrival'&&['cogs.daily_so.system','cogs.daily_so.difference','cogs.daily_so.edit'].some(hasFeature)))return '<div class="card empty">Dashboard Operasional hanya tersedia untuk akun dengan izin dashboard operasional.</div>';
 if(!OD.ready&&!OD.loading){setTimeout(()=>odLoad(),0);return '<div class="card"><h3>Dashboard Operasional</h3><p class="mu">Memuat data transaksi dari Supabase…</p></div>'}
 if(OD.loading)return '<div class="card"><h3>Dashboard Operasional</h3><p class="mu">Memuat data operasional…</p></div>';
 if(OD.error)return '<div class="card"><h3>Dashboard Operasional</h3><p>'+esc(OD.error)+'</p><button class="btn" onclick="odRefresh()">Coba lagi</button></div>';
 return '<div class="cogs-wrap"><div class="card"><h2 style="margin:0">Dashboard Operasional</h2><p class="mu">Dashboard sedang disiapkan ulang. Notifikasi tetap tersedia di bagian atas halaman.</p></div></div>';
 const divs=odDivisionRows(),sales=odFilter(CG.sales,'sold_at'),prod=odFilter(CG.productions,'produced_at'),ins=odFilter(INV.ins,'received_at'),outs=odStockOutFilter(INV.stockOut),sos=odFilter(CG.dailySO,'so_date'),sup=odFilter(INV.suppliesSO,'so_date');
 const stockInValue=ins.reduce((s,x)=>s+Number(x.invoice_total??x.estimated_total??0),0);
 const salesQty=sales.reduce((s,x)=>s+Number(x.qty||0),0),gross=sales.reduce((s,x)=>s+Number(x.gross_sales_snapshot||0),0),hpp=sales.reduce((s,x)=>s+Number(x.total_hpp_snapshot||0),0);
 const prodQty=prod.reduce((s,x)=>s+Number(x.produced_qty||0),0),prodCost=prod.reduce((s,x)=>s+Number(x.total_cost_snapshot||0),0);
 const expenseRows=outs.filter(x=>!['move','transfer'].includes(String(x.category||'').toLowerCase())),moveRows=outs.filter(x=>['move','transfer'].includes(String(x.category||'').toLowerCase()));
 const outQty=expenseRows.reduce((s,x)=>s+Number(x.qty_base||0),0),outCats={};expenseRows.forEach(x=>{const k=String(x.category||'Lainnya');if(!outCats[k])outCats[k]={name:k,qty:0,rows:0};outCats[k].qty+=Number(x.qty_base||0);outCats[k].rows++});
 const soLines=CG.dailySOLines.filter(l=>sos.some(s=>String(s.id)===String(l.so_id))),counted=soLines.filter(l=>l.counted_qty_base!=null),variance=soLines.filter(l=>Math.abs(Number(l.variance_qty_base)||0)>0.000001),varianceValue=soLines.reduce((s,l)=>s+Math.abs(Number(l.variance_value_snapshot)||0),0);
 const pending=OD.closing.filter(x=>String(x.status||'').toLowerCase()!=='approved').length,approved=OD.closing.length-pending;
 const menuMap={};sales.forEach(x=>{const k=x.menu_name_snapshot||CG.menus.find(m=>String(m.id)===String(x.menu_id))?.name||'Menu';if(!menuMap[k])menuMap[k]={name:k,qty:0,gross:0,hpp:0};menuMap[k].qty+=Number(x.qty||0);menuMap[k].gross+=Number(x.gross_sales_snapshot||0);menuMap[k].hpp+=Number(x.total_hpp_snapshot||0)});
 const topMenus=Object.values(menuMap).sort((a,b)=>b.qty-a.qty).slice(0,7);
 const catRows=Object.values(outCats).sort((a,b)=>b.qty-a.qty).slice(0,6);
 const days=[];if(OD.from<=OD.to){const d=new Date(OD.from+'T12:00:00'),end=new Date(OD.to+'T12:00:00');while(d<=end&&days.length<366){const key=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');days.push({key,label:odDateLabel(key),sales:0,prod:0,ins:0});d.setDate(d.getDate()+1)}}
 days.forEach(d=>{d.sales=sales.filter(x=>String(x.sold_at)===d.key).reduce((s,x)=>s+Number(x.gross_sales_snapshot||0),0);d.prod=prod.filter(x=>String(x.produced_at)===d.key).reduce((s,x)=>s+Number(x.total_cost_snapshot||0),0);d.ins=ins.filter(x=>String(x.received_at)===d.key).reduce((s,x)=>s+Number(x.invoice_total??x.estimated_total??0),0)});
 const maxBar=Math.max(1,...days.flatMap(d=>[d.sales,d.prod,d.ins]));
 const chart=days.length?'<div style="display:flex;align-items:flex-end;gap:clamp(3px,1vw,10px);height:180px;min-width:0;overflow-x:auto;padding:12px 2px 0;scrollbar-width:thin">'+days.map((d,i)=>'<div title="'+d.label+' · Omzet '+odRp(d.sales)+' · Produksi '+odRp(d.prod)+' · Barang masuk '+odRp(d.ins)+'" style="flex:0 0 '+(days.length>12?'24px':'auto')+';min-width:'+(days.length>12?'24px':'0')+';display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%"><div style="display:flex;align-items:flex-end;gap:2px;height:145px;width:100%;justify-content:center"><i style="display:block;width:28%;max-width:13px;border-radius:4px 4px 0 0;height:'+Math.max(d.sales?3:0,d.sales/maxBar*135)+'px;background:#4e7fc1"></i><i style="display:block;width:28%;max-width:13px;border-radius:4px 4px 0 0;height:'+Math.max(d.prod?3:0,d.prod/maxBar*135)+'px;background:#79a486"></i><i style="display:block;width:28%;max-width:13px;border-radius:4px 4px 0 0;height:'+Math.max(d.ins?3:0,d.ins/maxBar*135)+'px;background:#d5ad61"></i></div><small style="font-size:10px;margin-top:7px;white-space:nowrap;min-height:12px">'+(days.length>12?(i%3===0||i===days.length-1?d.label:''):d.label)+'</small></div>').join('')+'</div>':'<div class="empty">Tidak ada data pada rentang ini.</div>';
 const table=(headers,rows,empty)=>'<div style="overflow-x:auto"><table class="rk" style="width:100%;min-width:430px"><thead><tr>'+headers.map(h=>'<th>'+h+'</th>').join('')+'</tr></thead><tbody>'+((rows&&rows.length)?rows.join(''):'<tr><td colspan="'+headers.length+'" class="mu">'+empty+'</td></tr>')+'</tbody></table></div>';
 const menuTable=table(['Menu','Qty terjual','Omzet','HPP','Margin kotor'],topMenus.map(x=>'<tr><td>'+esc(x.name)+'</td><td>'+odN(x.qty)+'</td><td>'+odRp(x.gross)+'</td><td>'+odRp(x.hpp)+'</td><td>'+odRp(x.gross-x.hpp)+'</td></tr>'),'Belum ada penjualan menu.');
 const catTable=table(['Kategori pengeluaran','Qty dasar','Transaksi'],catRows.map(x=>'<tr><td>'+esc(x.name)+'</td><td>'+odN(x.qty)+'</td><td>'+x.rows+'</td></tr>'),'Belum ada pengeluaran.');
 const dailyTable=table(['Tanggal','Omzet menu','Produksi WIP','Barang masuk'],days.slice().reverse().map(d=>'<tr><td>'+d.label+'</td><td>'+odRp(d.sales)+'</td><td>'+odRp(d.prod)+'</td><td>'+odRp(d.ins)+'</td></tr>'),'Belum ada data harian.');
 return '<div class="cogs-wrap"><div class="card"><div class="cogs-top"><div><h2 style="margin:0">Dashboard Operasional</h2><p class="mu">Ringkasan aktivitas outlet dari transaksi yang tersimpan.</p></div><button class="btn s" onclick="odRefresh()" '+(OD.loading?'disabled':'')+'>Muat ulang</button></div><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,170px),1fr));gap:9px;margin-top:14px"><label>Dari tanggal<input type="date" value="'+OD.from+'" max="'+OD.to+'" onchange="odSet(\'from\',this.value)"></label><label>Sampai tanggal<input type="date" value="'+OD.to+'" min="'+OD.from+'" onchange="odSet(\'to\',this.value)"></label><label>Divisi<select onchange="odSet(\'division\',this.value)"><option value="">Semua divisi yang dapat diakses</option>'+CG.divs.map(d=>'<option value="'+d.id+'" '+(String(OD.division)===String(d.id)?'selected':'')+'>'+esc(d.name)+'</option>').join('')+'</select></label></div></div><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,160px),1fr));gap:10px;margin:12px 0">'+
 odStat('Omzet penjualan menu',odRp(gross),odN(salesQty)+' menu terjual','receipt-text','sales')+
 odStat('HPP menu terjual',odRp(hpp),'Margin kotor '+odRp(gross-hpp),'chart-no-axes-combined','hpp')+
 odStat('Barang masuk',odRp(stockInValue),ins.length+' transaksi masuk','truck','incoming')+
 odStat('Pengeluaran stok',odN(outQty),'Qty dasar · '+expenseRows.length+' transaksi','arrow-left-right','expense')+
 odStat('Produksi WIP',odN(prodQty),odRp(prodCost)+' nilai produksi','cooking-pot','production')+
 odStat('Selisih Daily SO',odRp(varianceValue),'Total nilai rupiah selisih','clipboard-list','variance')+
 odStat('Daily SO tersimpan',sos.length,'Tanggal/divisi sesuai filter','package-check','dailyso')+
 odStat('SO Suplies',sup.length,'Pencatatan stok guest supplies','clipboard-list','supplies')+
 odStat('Move antar-divisi',moveRows.length,'Transaksi transfer · tidak dihitung sebagai waste','arrow-left-right','move')+
 odStat('Approval Closing',OD.closing.length?approved+' disetujui': '–',OD.closing.length?pending+' menunggu approval':'Data closing tidak tersedia/di luar izin','shield-check','closing')+
 '</div><div class="card"><h3>Tren operasional</h3><p class="mu">Per hari · nilai penjualan, produksi WIP, dan barang masuk</p><div style="display:flex;flex-wrap:wrap;gap:12px;font-size:12px;margin:8px 0"><span>🟦 Omzet menu</span><span>🟩 Produksi WIP</span><span>🟨 Barang masuk</span></div>'+chart+'</div><div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));gap:12px"><div class="card" style="min-width:0"><h3>Menu terlaris</h3>'+menuTable+'</div><div class="card" style="min-width:0"><h3>Rincian pengeluaran</h3>'+catTable+'</div></div><div class="card"><h3>Rincian per hari</h3>'+dailyTable+'</div><div class="card"><h3>Ringkasan cakupan</h3><p class="mu">'+divs.length+' divisi · '+OD.from+' s.d. '+OD.to+'. Move antar-divisi dihitung terpisah dari pengeluaran agar tidak menggandakan pemakaian stok.</p></div></div>';
}
V.ops_dashboard=()=>odView();
