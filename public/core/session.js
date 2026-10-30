/* ---------- Login ---------- */
/* ---------- Login ---------- */
async function initAuth(){
  try{
    const c=sb();
    const {data,error}=await c.auth.getSession();
    if(error)throw error;
    const applySession=async session=>{
      if(!session){if(D.me&&(D.me.r=='A'||D.me.r=='D')){D.me=null;sv()}R();return}
      const email=session.user.email||'',role=await dbRoleCode();
      if(!role){
        D.me=null;sv();R();
        toast('Akun ('+(email||'tanpa email')+') belum diberi akses aplikasi. Hubungi developer.','err');
        setTimeout(()=>c.auth.signOut().catch(()=>{}),0);
        return;
      }
      if(!D.me||D.me.uid!==session.user.id||D.me.r!==role){resetAcc();T.pagePreference='';pg='dash';T.pgInit=0;}
      D.me={r:role,uid:session.user.id,email};sv();
      if(role==='G'){
        resetAcc();D.per=[];D.pin='';D.cur='';sv();idleSet();
        T.dbRole='guest_arrival';T.perms=[];pg='guest_arrival';T.pagePreference='guest_arrival';T.pgInit=1;if(typeof window.guestArrivalResetSession==='function')window.guestArrivalResetSession();
        try{const {data,error}=await sb().from('user_permissions').select('permission');if(!error)T.perms=(data||[]).map(x=>x.permission)}catch(e){}
        SB.state='ok';SB.msg='';SB.loaded=true;SB.loading=false;pg='guest_arrival';T.pagePreference='guest_arrival';
        try{sessionStorage.setItem('bar_pg','guest_arrival');localStorage.setItem('bar_pg_last','guest_arrival');localStorage.setItem(pageStorageKey(),'guest_arrival')}catch(e){}
        R();if(guestArrivalAllowedPages().some(k=>k!=='guest_arrival')){await Promise.all([sbLoad(),loadSharedSettings(true)]);R()}return;
      }
      let savedPageBeforeLoad='';try{savedPageBeforeLoad=localStorage.getItem(pageStorageKey())||''}catch(e){}T.pagePreference=savedPageBeforeLoad;
      await Promise.all([sbLoad(),loadSharedSettings(true)]);
      try{const savedPage=savedPageBeforeLoad||localStorage.getItem(pageStorageKey());T.pagePreference=savedPage&&PAGES[savedPage]?savedPage:'dash';pg=T.pagePreference}catch(e){T.pagePreference='dash';pg='dash'}
      T.pgInit=1;
      R();
    };
    await applySession(data.session);
    c.auth.onAuthStateChange((event,session)=>{
      if(event=='SIGNED_IN'){if(session&&D.me&&D.me.uid===session.user.id&&(D.me.r=='A'||D.me.r=='D'||D.me.r=='G'))return;setTimeout(()=>applySession(session),0)}
      else if(event=='SIGNED_OUT'){if(D.me&&(D.me.r=='A'||D.me.r=='D'||D.me.r=='G')){D.me=null;sv()}R()}
    });
  }catch(e){
    console.warn('Supabase Auth:',e);
    if(D.me&&(D.me.r=='A'||D.me.r=='D'||D.me.r=='G')){D.me=null;sv()}
    R();
  }
}
function logoWaveMove(e,el){
  if(!el||!e||(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches))return;
  const r=el.getBoundingClientRect();if(!r.width)return;
  const px=Math.max(0,Math.min(1,(e.clientX-r.left)/r.width));
  const py=Math.max(-.5,Math.min(.5,(e.clientY-r.top)/r.height-.5));
  el.querySelectorAll('.bw-letter>span').forEach(letter=>{
    const outer=letter.parentElement;
    const cx=(outer.offsetLeft+outer.offsetWidth/2)/r.width;
    const dx=cx-px;
    const power=Math.max(0,1-Math.abs(dx)/.42);
    const lift=16*power*(1-Math.min(1,Math.abs(py)*.7));
    const shift=Math.sign(dx)*5*power;
    const turn=(Math.sign(dx)*11-py*9)*power;
    letter.style.transform='translate3d('+shift.toFixed(1)+'px,'+(-lift).toFixed(1)+'px,0) rotate('+turn.toFixed(1)+'deg) scale('+(1+power*.08).toFixed(3)+')';
  });
}
function logoWaveReset(el){
  if(!el)return;
  el.querySelectorAll('.bw-letter>span').forEach(letter=>{letter.style.transform=''});
}

function login(){
  const lg=`<div class="lg-top"><button class="btn x s" onclick="setLang(LANG=='id'?'en':'id')">${IC('globe',14)}${LANG=='id'?'English':'Indonesia'}</button></div>`;
  const st=`<div class="lg-st"><span class="dot ${SB.state}"></span><span>${sbLabel()}${SB.state=='err'?' - '+esc(SB.msg):''}</span>${SB.state=='err'?`<span class="lg-ac"><a class="nm" onclick="sbLoad()">${L('Coba lagi','Retry')}</a> · <a class="nm" onclick="openSb()">${L('Atur sambungan','Connection settings')}</a></span>`:''}</div>${SB.state=='loading'?'<div class="prog" style="margin-bottom:16px"><i></i></div>':''}`;
  const cloud='<svg viewBox="0 0 100 50"><path fill="currentColor" d="M 20,40 Q 10,40 10,30 Q 10,20 25,20 Q 30,10 45,15 Q 60,8 70,20 Q 85,15 90,30 Q 95,40 80,40 Z"/></svg>';
  const scene=`<div class="scene" aria-hidden="true"><div class="cloud c1">${cloud}</div><div class="cloud c2">${cloud}</div>
    <svg class="hill" viewBox="0 0 1200 400" preserveAspectRatio="none"><path d="M0,220 Q300,120 600,200 Q900,280 1200,160 L1200,400 L0,400 Z" fill="currentColor"/><path d="M0,280 Q400,200 800,290 Q1000,250 1200,300 L1200,400 L0,400 Z" fill="rgba(63,94,77,.22)"/></svg>
    <div class="cot"><svg viewBox="0 0 200 200"><path class="sway" d="M 30,160 L 50,110 L 70,160 Z" fill="#3F5E4D"/><path class="sway" style="animation-delay:-2s" d="M 140,170 L 165,115 L 190,170 Z" fill="#3F5E4D"/><rect x="70" y="120" width="60" height="45" fill="#5C4033" rx="3"/><polygon points="60,120 100,85 140,120" fill="#D47A5B"/><rect x="92" y="138" width="16" height="27" fill="#E2A85C" rx="2"/><circle cx="82" cy="132" r="6" fill="#FDFBF7"/><circle cx="118" cy="132" r="6" fill="#FDFBF7"/><rect x="115" y="90" width="8" height="18" fill="#5C4033"/><circle class="smoke" cx="119" cy="80" r="4" fill="#E8C5C8"/><circle class="smoke" style="animation-delay:1.2s" cx="122" cy="70" r="6" fill="#E8C5C8"/></svg></div></div>`;
  return `<section class="lgs">${scene}
    <div class="lgc">
      ${lg}
      <p class="sub">${esc(TH.sub)} · ${L('Pilih cara masuk ke aplikasi.','Choose how to enter the application.')}</p>
      ${st}
      <div class="lgf">
        <div class="fld"><label for="lu">${L('Email Admin','Admin Email')}</label><div class="iw">${IC('mail',16)}<input id="lu" type="email" autocomplete="username" placeholder="nama@domain.com"></div></div>
        <div class="fld"><label for="lp">Password</label><div class="iw">${IC('key',16)}<input id="lp" type="password" autocomplete="current-password" placeholder="••••••••" onkeydown="if(event.key=='Enter')lgA()"></div></div>
        <div class="btns">
          <button class="btn" onclick="lgA()">${IC('sparkles',16)}Login Admin</button>
        </div>
      </div>
      <div class="lg-ft">${esc(TH.name)} · ${esc(TH.sub)}</div>
    </div>
  </section>`;
}

async function lgA(){
  const email=v('lu').trim();
  const password=v('lp');

  if(!email)
    return toast('Email Admin wajib diisi','err');

  if(!password)
    return toast('Password wajib diisi','err');

  try{
    const {data,error}=await sb().auth.signInWithPassword({
      email,
      password
    });

    if(error)throw error;

    if(!data.session)
      throw new Error('Login Admin gagal');

    const role=await dbRoleCode();
    if(!role){
      await sb().auth.signOut();
      throw new Error('Email '+(data.session.user.email||email)+' belum terdaftar sebagai developer atau admin aplikasi.');
    }
    D.me={r:role,uid:data.session.user.id,email:data.session.user.email||email};
    idleSet(true);
    sv();
    await Promise.all([sbLoad(),loadSharedSettings(true)]);
    R();

  }catch(e){
    const m=String(e.message||e);

    if(/invalid login credentials/i.test(m))
      return toast('Email atau password Admin salah','err');

    toast('Login Admin gagal: '+m,'err');
  }
}

async function out(force=false){
  if((T.dbRole==='guest_arrival'||pg==='guest_arrival')&&!force){modal('<h3>Konfirmasi</h3><p>Yakin ingin keluar?</p><div class="btns"><button class="btn d" onclick="out(true);closeM()">Ya</button><button class="btn s" onclick="closeM()">Tidak</button></div>');return}
  try{sessionStorage.removeItem('bar_pg')}catch(e){}
  try{localStorage.removeItem('bar_last')}catch(e){}
  try{await sb().auth.signOut()}catch(e){console.warn('Auth signOut:',e)}
  resetAcc();D.me=null;sv();R();
}
