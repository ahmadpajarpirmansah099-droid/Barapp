/* Penghubung Supabase Barapp.
   File ini sengaja tetap memakai skrip browser klasik untuk menjaga kompatibilitas
   dengan kode lama yang masih memanggil sb(), sbCfg(), dan SBC secara langsung. */
let SBC=null;
const sbCfg=()=>{let c={};try{c=JSON.parse(localStorage.getItem(SBCFGK)||'{}')}catch(e){}return{url:String(SUPABASE_URL||c.url||'').trim().replace(/\/+$/,''),key:String(SUPABASE_ANON_KEY||c.key||'').trim()}};
function sbKeyBad(k){if(/^sb_secret_/i.test(k))return true;try{return JSON.parse(atob(k.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).role==='service_role'}catch(e){return false}}
const sbEr=(code)=>Object.assign(new Error(code),{code});
/* Wrapper untuk menjaga kompatibilitas fetch pada beberapa pratinjau browser. */
const sbFetch=(url,opts)=>{const o={...(opts||{})};const h=o.headers;if(h&&typeof h.forEach=='function'&&!Array.isArray(h)){const p={};h.forEach((val,key)=>{p[key]=val});o.headers=p}if(!o.signal)delete o.signal;return fetch(typeof url=='string'?url:String(url&&url.url||url),o)};
function sb(){if(SBC)return SBC;const c=sbCfg();if(!c.url||!c.key)throw sbEr('NOCFG');if(sbKeyBad(c.key))throw sbEr('SECRETKEY');if(!(window.supabase&&window.supabase.createClient))throw sbEr('NOLIB');SBC=window.supabase.createClient(c.url,c.key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false},global:{fetch:sbFetch}});return SBC}
