/* ===== GLOBAL AUTO-LOGOUT SETELAH 2 JAM TANPA AKTIVITAS ===== */
const IDLE_MS=2*60*60*1000;
const idleLimitMs=()=>IDLE_MS;
const idleSet=(force=false)=>{try{if(force||Date.now()-(+localStorage.getItem('bar_last')||0)>=1000)localStorage.setItem('bar_last',String(Date.now()))}catch(e){}};
const idleCheck=()=>{if(!D||!D.me)return;let t=0;try{t=+localStorage.getItem('bar_last')||0}catch(e){}
 if(!t){idleSet(true);return}
 if(Date.now()-t>=idleLimitMs()){toast('Sesi berakhir karena tidak aktif. Silakan login kembali.','warn');void out(true)}};
['pointerdown','keydown','touchstart','scroll','input','change','wheel'].forEach(ev=>document.addEventListener(ev,()=>{if(D&&D.me)idleSet()},{passive:true}));
let idlePointerAt=0;
document.addEventListener('pointermove',()=>{const now=Date.now();if(now-idlePointerAt>=1000){idlePointerAt=now;if(D&&D.me)idleSet()}},{passive:true});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)idleCheck()});
setInterval(idleCheck,15000);
