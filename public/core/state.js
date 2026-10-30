const K='absensi_bar_v1',STAFF_SESSION_KEY='barapp_staff_session_v1',ST={M:'Masuk',L:'Libur',I:'Izin',S:'Sakit',PH:'Public Holiday'},SC={M:'#6E9B57',L:'#A39A88',I:'#E2A85C',S:'#D47A5B',PH:'#6FA0C8'},SK=Object.keys(ST);
/* Roles are assigned only to explicitly approved Supabase Auth emails. */
const normEmail=email=>String(email||'').normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g,'').trim().toLowerCase();
const dbRoleCode=async()=>{const r=await sb().rpc('app_role').then(x=>x.data).catch(()=>null);if(r==='guest_arrival'){const email=await sb().auth.getSession().then(x=>x.data.session?.user?.email||'').catch(()=> '');return ['admin@div.service','admin@mnk.service'].includes(normEmail(email))?'G':null}return r=='dev'?'D':(['div_admin','hr','legacy_admin','report_viewer'].includes(r))?'A':null};
let D={emp:[],per:[],att:[],ot:[],pin:'',cur:'',me:null},pg='dash',F={f:'',t:'',q:'',e:''},T={};
try{Object.assign(D,JSON.parse(localStorage.getItem(K)||'{}'))}catch(e){}
try{const persisted=JSON.parse(localStorage.getItem(K)||'{}');if(persisted&&persisted.me&&persisted.me.r==='K'){delete persisted.me;localStorage.setItem(K,JSON.stringify(persisted))}}catch(e){}
try{const staffSession=JSON.parse(sessionStorage.getItem(STAFF_SESSION_KEY)||'null');if(staffSession&&staffSession.r==='K'&&staffSession.tok)D.me=staffSession;else if(D.me&&D.me.r==='K')D.me=null}catch(e){if(D.me&&D.me.r==='K')D.me=null}
/* ===== DATA LOKAL LAMA (legacy): karyawan & absensi dari versi localStorage. TIDAK dihapus; hanya disimpan apa adanya.
   Sumber data karyawan & absensi sekarang = Supabase (lihat modul SUPABASE di bawah). ===== */
const LEG={emp:Array.isArray(D.emp)?D.emp:[],att:Array.isArray(D.att)?D.att:[]};D.emp=[];D.att=[];
