/* Pengendali dan tampilan Dashboard COGS. */
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
V.cogs_dashboard=()=>{
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
