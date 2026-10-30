/* Pengendali navigasi, sidebar, ikon menu, dan menu pengaturan Barapp. */
/* Desktop sidebar collapse preference; independent from account permissions. */
let BARAPP_DESKTOP_SIDEBAR_COLLAPSED=false;
try{BARAPP_DESKTOP_SIDEBAR_COLLAPSED=localStorage.getItem('barapp.desktopSidebarCollapsed')==='1'}catch(e){}
const desktopSidebarIcon=()=>'<svg class="ic" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/><path d="'+(BARAPP_DESKTOP_SIDEBAR_COLLAPSED?'m13 8 4 4-4 4':'m15 8-4 4 4 4')+'"/></svg>';
function toggleDesktopSidebar(){BARAPP_DESKTOP_SIDEBAR_COLLAPSED=!BARAPP_DESKTOP_SIDEBAR_COLLAPSED;try{localStorage.setItem('barapp.desktopSidebarCollapsed',BARAPP_DESKTOP_SIDEBAR_COLLAPSED?'1':'0')}catch(e){}R()}
const go=p=>{if(p==='div'||p==='divdet'){toast('Fitur Divisi & Admin sudah dinonaktifkan. Pengaturan akses dilakukan melalui backend.','warn');return}if((T.dbRole==='guest_arrival'||pg==='guest_arrival')&&p!==pg&&typeof window.guestArrivalHandleNavigation==='function'&&!window.guestArrivalHandleNavigation(p))return;if(p!=pg)T.cq='';pg=p;T.pagePreference=p;try{if(D.me&&PAGES[pg])localStorage.setItem(pageStorageKey(),pg)}catch(e){}R()},tsd=()=>$('#sdw').classList.toggle('open');

const guestArrivalIcon=(size=18)=>'<svg viewBox="0 0 64 64" width="'+size+'" height="'+size+'" fill="none" stroke="#173F31" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="23" cy="13" r="5.5"/><circle cx="43" cy="13" r="5.5"/><path d="M12 35c0-6 5-10 11-10s10 4 10 10M35 36c0-7 3-11 8-11s9 4 9 11v9"/><path d="M20 42v-3a4 4 0 0 1 8 0v3" stroke-width="2.8"/><rect x="16" y="42" width="17" height="14" rx="2" fill="#E8755D" stroke-width="2.8"/></svg>';
const cogsDashboardDesktopIcon=(size=18)=>'<svg viewBox="0 0 64 64" width="'+size+'" height="'+size+'" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M26 5H38V12Q42 13 45 15L51 9 58 16 52 22Q55 26 56 30H62V42H56Q55 46 52 50L58 56 51 63 45 57Q42 59 38 60V63H26V60Q22 59 19 57L13 63 6 56 12 50Q9 46 8 42H2V30H8Q9 26 12 22L6 16 13 9 19 15Q22 13 26 12Z" stroke="#173F31" stroke-width="5.5"/><path d="M21 22V30M26 22V30M31 22V30M21 30C21 34 24 36 26 36S31 34 31 30M26 36V49" stroke="#173F31" stroke-width="5.2"/><path d="M38 22C44 22 47 27 47 32S44 39 38 39V22Z" fill="#E8755D" stroke="#173F31" stroke-width="4.5"/><path d="M38 39V49" stroke="#173F31" stroke-width="5.2"/></svg>';
const guestArrivalDesktopIcon=(size=20)=>'<svg viewBox="10 5 44 54" width="'+size+'" height="'+size+'" fill="none" stroke="#173F31" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="23" cy="13" r="5.5"/><circle cx="43" cy="13" r="5.5"/><path d="M12 35c0-6 5-10 11-10s10 4 10 10M35 36c0-7 3-11 8-11s9 4 9 11v9"/><path d="M20 42v-3a4 4 0 0 1 8 0v3" stroke-width="3.8"/><rect x="16" y="42" width="17" height="14" rx="2" fill="#E8755D" stroke-width="3.8"/></svg>';
function featureMenuIcon(m,lk){
 if(lk||!m.page)return IC('lock',30);
 if(m.name==='Guest Arrival')return guestArrivalIcon(50);
 const common='viewBox="0 0 64 64" width="60" height="60" fill="none" stroke-linecap="round" stroke-linejoin="round"';
 const icons={
  'Absensi':`<svg ${common}><rect x="9" y="13" width="46" height="42" rx="7" stroke="#173F31" stroke-width="3.2"/><path d="M9 25h46M21 7v12M43 7v12" stroke="#173F31" stroke-width="3.2"/><path d="m22 39 6 6 13-13" stroke="#E8755D" stroke-width="3.5"/><circle cx="46" cy="45" r="10" fill="#E8755D"/><path d="m42 45 3 3 5-6" stroke="#FFFDF8" stroke-width="2.2"/></svg>`,
  'Dashboard':`<svg ${common}><path d="M7 55h50" stroke="#173F31" stroke-width="2.6"/><path d="M11 54V37h8v17M27 54V27h8v27M43 54V17h8v37" stroke="#173F31" stroke-width="3"/><path d="m8 23 15-12 13 8 17-13" stroke="#173F31" stroke-width="2.6"/><circle cx="8" cy="23" r="3.2" fill="#E8755D" stroke="#E8755D"/><circle cx="23" cy="11" r="3.2" fill="#FFFDF8" stroke="#E8755D" stroke-width="2.5"/><circle cx="36" cy="19" r="3.2" fill="#FFFDF8" stroke="#173F31" stroke-width="2.5"/><circle cx="53" cy="6" r="3.2" fill="#FFFDF8" stroke="#173F31" stroke-width="2.5"/><path d="M11 39h8v15h-8zM27 29h8v25h-8z" fill="#E8755D" fill-opacity=".85" stroke="#173F31" stroke-width="1.5"/></svg>`,
  'Dashboard COGS':`<svg ${common}><rect x="8" y="8" width="19" height="19" rx="4" stroke="#173F31" stroke-width="3.2"/><rect x="37" y="8" width="19" height="19" rx="4" fill="#E8755D" stroke="#E8755D" stroke-width="2"/><rect x="8" y="37" width="19" height="19" rx="4" stroke="#173F31" stroke-width="3.2"/><rect x="37" y="37" width="19" height="19" rx="4" stroke="#173F31" stroke-width="3.2"/></svg>`,
  'Master Barang':`<svg ${common}><path d="m8 21 24-13 24 13-24 14z" fill="#E8755D" fill-opacity=".9" stroke="#173F31" stroke-width="3"/><path d="M8 21v25l24 13 24-13V21M32 35v24M20 15l24 13" stroke="#173F31" stroke-width="3"/><path d="m20 15 24 13" stroke="#FFFDF8" stroke-width="2"/></svg>`,
  'Gaji':`<svg ${common}><circle cx="27" cy="17" r="10" stroke="#173F31" stroke-width="3.2"/><path d="M7 54v-4c0-9 8-15 20-15s20 6 20 15v4" stroke="#173F31" stroke-width="3.2"/><path d="M44 10c6 2 9 7 8 12-.5 4-3 7-6 8" stroke="#173F31" stroke-width="2.6"/><circle cx="48" cy="29" r="8" fill="#E8755D"/><path d="M47 25v8m-3-6h5" stroke="#FFFDF8" stroke-width="1.7"/></svg>`,
  'Approval':`<svg ${common}><path d="M14 9h25l9 9v20" stroke="#173F31" stroke-width="3.2"/><path d="M39 9v10h9" stroke="#173F31" stroke-width="3.2"/><rect x="8" y="9" width="35" height="44" rx="5" stroke="#173F31" stroke-width="3.2"/><path d="m15 23 3 3 5-6M27 24h9M15 34l3 3 5-6M27 35h6" stroke="#173F31" stroke-width="2.4"/><circle cx="44" cy="43" r="13" fill="#FFFDF8" stroke="#E8755D" stroke-width="3.5"/><path d="m38 43 4 4 8-9" stroke="#E8755D" stroke-width="3.2"/></svg>`,
  'Daily SO':`<svg ${common}><rect x="12" y="11" width="40" height="45" rx="6" stroke="#173F31" stroke-width="3.2"/><path d="M23 7h18a4 4 0 0 1 4 4v4H19v-4a4 4 0 0 1 4-4" stroke="#173F31" stroke-width="2.8"/><path d="M22 27h20M22 36h20M22 45h14" stroke="#173F31" stroke-width="2.8"/><path d="M25 8h14" stroke="#E8755D" stroke-width="5"/><circle cx="32" cy="8" r="6" fill="#E8755D"/></svg>`,
  'Divisi & Admin':`<svg ${common}><circle cx="25" cy="17" r="10" stroke="#173F31" stroke-width="3.2"/><path d="M6 54v-4c0-9 8-15 19-15 6 0 11 2 14 5" stroke="#173F31" stroke-width="3.2"/><path d="m48 34 2.5 3.4 4-.1 1.5 4-2.8 3 1 4-4 1.7-3.2-2.5-3.7 1.2-2-3.8-3.4-1.4.5-4.3 3.5-1.7 1.3-3.7z" fill="#E8755D" stroke="#E8755D" stroke-width="1.8"/><circle cx="48" cy="42" r="4" stroke="#FFFDF8" stroke-width="2.2"/></svg>`,
  'Guest Arrival':`<svg ${common}><rect x="8" y="8" width="19" height="19" rx="4" stroke="#173F31" stroke-width="3.2"/><rect x="37" y="8" width="19" height="19" rx="4" fill="#E8755D" stroke="#E8755D" stroke-width="2"/><rect x="8" y="37" width="19" height="19" rx="4" stroke="#173F31" stroke-width="3.2"/><rect x="37" y="37" width="19" height="19" rx="4" stroke="#173F31" stroke-width="3.2"/></svg>`
 };
 return icons[m.name]||IC(m.ic,30);
}
function openMods(){modal(`<h3 class="mods-title">Fitur</h3><div class="grid mods-feature-grid" style="grid-template-columns:repeat(3,minmax(0,1fr));gap:10px">${MODS.filter(m=>!!m.page&&!['supplies','pengeluaran','masuk','cogs_materials','cogs_wip','cogs_menu','cogs_sales'].includes(m.page)).map((m,i)=>{const featurePerms={guest_arrival:['feature.guest_arrival.access'],cogs_closing:['feature.approval.access'],cogs_materials:['feature.master_bahan.access'],barang:['inventory.view','inventory.manage'],masuk:['inventory.view','inventory.inbound.view','inventory.manage','inventory.inbound.manage'],supplies:['inventory.manage','inventory.supplies.manage'],pengeluaran:['inventory.manage','inventory.outbound.manage'],pay_data:['payroll.view'],cogs_wip:['cogs.wip.view','cogs.wip.manage'],cogs_menu:['cogs.menu.view','cogs.menu.manage'],cogs_sales:['cogs.sales.view','cogs.sales.manage'],cogs_production:['cogs.production.view','cogs.production.manage'],cogs_daily_so:['cogs.daily_so.system','cogs.daily_so.difference','cogs.daily_so.edit']};const req=featurePerms[m.page]||[];const lk=!!m.page&&(!allowed().includes(m.page)||(m.dev&&!isDeveloper())||(m.perm&&!hasFeature(m.perm))||(m.cogs&&!cogsPageOK(m.page))||(req.length&&!req.some(hasFeature))||(m.page==='guest_arrival'&&!hasFeature('feature.guest_arrival.access'))||(m.page==='cogs_closing'&&!hasFeature('feature.approval.access'))||(m.page==='cogs_materials'&&!hasFeature('feature.master_bahan.access')));const dis=!m.page;return `<button class="btn ${m.page?'s':'o'} mods-feature-card ${dis?'mods-feature-disabled':lk?'mods-feature-locked':''}" style="--feature-accent:${['#E8755D','#315D4A','#D68B48','#548A78','#D97867','#6D8D76'][i%6]}" ${dis?'disabled':lk?'onclick="lockTip()"':`onclick="closeM();go('${m.page}')"`}><div class="mods-feature-icon">${featureMenuIcon(m,lk)}</div><span class="mods-feature-label">${esc(m.name)}</span>${lk?' <small>· dibatasi</small>':''}</button>`}).join('')}</div><br><button class="btn s" onclick="closeM()">Tutup</button>`)}
const lockTip=()=>toast('Fitur ini dibatasi untuk akun kamu','warn');

const cmn=()=>{
 document.querySelectorAll('.mn.open').forEach(x=>x.classList.remove('open'));
 const d=document.querySelector('.settings-dd.portal-open');
 if(d){
  d.classList.remove('portal-open');
  d.removeAttribute('style');
  const holder=document.querySelector('.side .hd-sidebar-actions .settings-mn');
  if(holder)holder.appendChild(d);
 }
};
function omn(b,e){
 e.stopPropagation();
 const m=b.parentElement;
 const portal=document.querySelector('.settings-dd.portal-open');
 const isOpen=m.classList.contains('open')||!!portal;
 cmn();
 if(isOpen)return;
 if(m.classList.contains('settings-mn')&&m.closest('.side')){
  const d=m.querySelector('.settings-dd');
  if(d){
   const group=b.closest('.hd-sidebar-actions');
   const side=b.closest('.side');
   const gr=group.getBoundingClientRect();
   const sr=side.getBoundingClientRect();
   const margin=8, width=Math.min(330,window.innerWidth-margin*2);
   const left=Math.max(margin,Math.min(sr.left+8,window.innerWidth-width-margin));
   const bottom=Math.max(8,window.innerHeight-gr.top+8);
   d.classList.add('portal-open');
   document.body.appendChild(d);
   const set=(k,v)=>d.style.setProperty(k,v,'important');
   set('position','fixed');set('left',left+'px');set('right','auto');set('top','auto');set('bottom',bottom+'px');
   set('transform','translateY(8px) scale(.96)');set('transform-origin','bottom left');
   set('width',width+'px');set('min-width','0');set('max-width',width+'px');
   set('max-height',Math.max(120,Math.min(window.innerHeight*.70,gr.top-16))+'px');
   set('overflow','auto');set('z-index','10050');set('display','block');

   // Five-leaf surprise burst, anchored around the newly opened settings card.
   document.querySelector('.barapp-leaf-burst')?.remove();
   const burst=document.createElement('div');
   burst.className='barapp-leaf-burst';
   burst.setAttribute('aria-hidden','true');
   const card=d.getBoundingClientRect();
   const leaves=[
    {x:card.left+8,y:card.top+24,dx:-18,dy:-40,rot:-55},
    {x:card.right-20,y:card.top+38,dx:20,dy:-34,rot:70},
    {x:card.left+22,y:card.top+card.height*.48,dx:-24,dy:-12,rot:-75},
    {x:card.right-18,y:card.top+card.height*.58,dx:24,dy:-20,rot:95},
    {x:card.left+card.width*.52,y:card.top+card.height-12,dx:8,dy:24,rot:125}
   ];
   leaves.forEach((leaf,index)=>{
    const el=document.createElement('span');
    el.className='barapp-surprise-leaf';
    el.style.left=leaf.x+'px';
    el.style.top=leaf.y+'px';
    el.style.setProperty('--leaf-x',leaf.dx+'px');
    el.style.setProperty('--leaf-y',leaf.dy+'px');
    el.style.setProperty('--leaf-rot',leaf.rot+'deg');
    el.style.animationDelay=(index*.045)+'s';
    burst.appendChild(el);
   });
   document.body.appendChild(burst);
   setTimeout(()=>burst.remove(),1600);
   return;
  }
 }
 m.classList.add('open');
}
