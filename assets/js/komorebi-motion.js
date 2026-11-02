/* Extracted from index.html inline script 3. Preserve original execution order. */
(()=>{
 const reduce=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
 if(reduce)return;
 const targets='button,.btn,.task,.start,.fab,.nvb,.ibtn,.sb button,.fb,.pc,summary,a.nm,td.c';
 document.addEventListener('pointerdown',e=>{
   const el=e.target.closest(targets); if(!el||el.disabled||el.closest('.kom-ripple-host')===null&&el.matches('input,select,textarea'))return;
   const r=el.getBoundingClientRect(); const span=document.createElement('span');
   span.className='kom-ripple';span.style.left=(e.clientX-r.left)+'px';span.style.top=(e.clientY-r.top)+'px';
   el.classList.add('kom-ripple-host');el.appendChild(span);setTimeout(()=>{span.remove();if(!el.querySelector('.kom-ripple'))el.classList.remove('kom-ripple-host')},620);
 },{passive:true});
 let komLastK=null;const animateCards=()=>{const k=(typeof pg!=='undefined'?pg:'')+'|'+(typeof D!=='undefined'?D.cur:'');const fresh=k!==komLastK;komLastK=k;const cards=document.querySelectorAll('#app.in main .card:not([data-kom-ready])');cards.forEach((c,i)=>{c.dataset.komReady='1';if(fresh){c.classList.add('kom-arrive');c.style.animationDelay=Math.min(i*30,180)+'ms'}});};
 const app=document.getElementById('app'); if(app){new MutationObserver(()=>requestAnimationFrame(animateCards)).observe(app,{childList:true,subtree:true});animateCards();}
})();
