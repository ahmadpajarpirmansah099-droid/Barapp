/* Guest Arrival & Waiting List — Barapp module */
const GA = {
  tab: 'queue', ready: false, loading: false, error: '',
  queue: [], pending: [], seated: [], history: [],
  historyDate: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date()),
  lastOperationalDate: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date()),
  search: '',
  fromDate: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date()).slice(0, 7) + '-01',
  toDate: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date()),
  dashboard: null, busy: '', form: null, edit: null, detail: null, showSeated: false, seat: null, tableMove: null,
  reservationsMonth: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date()).slice(0, 7),
  reservationsDate: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date()),
  reservations: [], reservationFormOpen: false,
  cancelId: null, cancelReason: '', showPending: false, serverOffsetMs: 0, context: null
};
const gaToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
const gaEscape = (v) => typeof esc === 'function' ? esc(String(v ?? '')) : String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const gaHumanError = (e) => String((e && (e.message || e.details || e.hint)) || e || 'Terjadi kesalahan yang tidak diketahui.');
const gaRpc = async (name, params) => {
  if (!window.supabase || typeof sb !== 'function') throw new Error('Sambungan Supabase belum siap. Muat ulang halaman dan coba lagi.');
  const { data, error } = await sb().rpc(name, params);
  if (error) throw error;
  return data;
};
const gaOutletParams = async () => {
  if (typeof isDeveloper !== 'function' || !isDeveloper()) return { p_outlet_id: null };
  const outletId = typeof outInit === 'function' ? await outInit() : (D && D.outId);
  if (!outletId || outletId === 'ALL') throw new Error('Pilih outlet aktif pada header Barapp terlebih dahulu.');
  return { p_outlet_id: String(outletId) };
};
const gaUuid = () => {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
};
const gaStatusClass = (s) => s === 'Selesai' ? 'done' : s === 'Duduk' ? 'seated' : s === 'Batalkan' ? 'cancelled' : 'waiting';
const gaPhoneDigits = (value) => String(value || '').replace(/\D/g, '');
const gaPhoneValid = (value) => /^[\d\s()+.-]+$/.test(String(value || '').trim()) && /^08\d{8,11}$/.test(gaPhoneDigits(value));
const gaPhoneHref = (value) => gaPhoneValid(value) ? 'https://wa.me/62' + gaPhoneDigits(value).slice(1) : '';
const gaPhoneMarkup = (value) => {
  if (!value) return '<span class="ga-muted">—</span>';
  const shown = gaEscape(value), href = gaPhoneHref(value);
  return href
    ? '<a class="ga-wa" href="' + href + '" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">' + shown + ' ↗</a>'
    : '<span>' + shown + '</span><span class="ga-muted"> · nomor tidak valid</span>';
};
const gaFormatDateTime = (value) => {
  if (!value) return '—';
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return '—';
  return new Intl.DateTimeFormat('id-ID', { timeZone:'Asia/Jakarta', day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }).format(d);
};
const gaFormatDate = (value) => {
  if (!value) return '—';
  const d = new Date(value + 'T12:00:00+07:00');
  if (!Number.isFinite(d.getTime())) return value;
  return new Intl.DateTimeFormat('id-ID', { timeZone:'Asia/Jakarta', day:'2-digit', month:'short', year:'numeric' }).format(d);
};
const gaDuration = (seconds) => {
  let n = Math.max(0, Math.floor(Number(seconds) || 0));
  const days = Math.floor(n / 86400); n %= 86400;
  const hours = Math.floor(n / 3600); n %= 3600;
  const minutes = Math.floor(n / 60); const secs = n % 60;
  if (days) return days + 'h ' + hours + 'j ' + minutes + 'm';
  if (hours) return hours + 'j ' + minutes + 'm';
  if (minutes) return minutes + 'm ' + secs + 'dtk';
  return secs + ' dtk';
};
const GA_SITTING_LIMIT_SECONDS = 9000;
const gaSittingRemaining = (g) => {
  const seated = Date.parse(g && g.seated_at || '');
  if (!Number.isFinite(seated)) return GA_SITTING_LIMIT_SECONDS;
  return GA_SITTING_LIMIT_SECONDS - Math.floor((Date.now() + GA.serverOffsetMs - seated) / 1000);
};
const gaSittingCountdown = (g) => {
  const remainingRaw = gaSittingRemaining(g);
  const remaining = Math.max(0, remainingRaw);
  const hh = String(Math.floor(remaining / 3600)).padStart(2, '0');
  const mm = String(Math.floor((remaining % 3600) / 60)).padStart(2, '0');
  const ss = String(remaining % 60).padStart(2, '0');
  return remainingRaw < 0 ? '00:00:00 · Melebihi waktu' : hh + ':' + mm + ':' + ss;
};
const gaWaitSeconds = (g) => {
  if (g.status !== 'Menunggu') return Math.max(0, Number(g.waiting_seconds) || 0);
  const arrived = new Date(g.arrived_at).getTime();
  return Number.isFinite(arrived) ? Math.max(0, Math.floor((Date.now() + GA.serverOffsetMs - arrived) / 1000)) : 0;
};
const gaStatusBadge = (s) => '<span class="ga-status ' + gaStatusClass(s) + '">' + gaEscape(s) + '</span>';
const gaToast = (message, kind) => { if (typeof toast === 'function') toast(message, kind || ''); };
const gaCaptureServerTime = (rows) => {
  const row = (rows || []).find(x => x.server_now);
  if (row) {
    const serverMs = new Date(row.server_now).getTime();
    if (Number.isFinite(serverMs)) GA.serverOffsetMs = serverMs - Date.now();
  }
};
const gaRefreshLists = async (outletParams) => {
  const scopedParams = outletParams || await gaOutletParams();
  const [queue, pending, seated] = await Promise.all([
    gaRpc('guest_arrival_list', { p_scope:'today', p_date:GA.historyDate, ...scopedParams }),
    gaRpc('guest_arrival_list', { p_scope:'pending', p_date:GA.historyDate, ...scopedParams }),
    gaRpc('guest_arrival_seated_list', scopedParams)
  ]);
  GA.queue = Array.isArray(queue) ? queue : [];
  GA.pending = Array.isArray(pending) ? pending : [];
  GA.seated = Array.isArray(seated) ? seated : [];
  gaCaptureServerTime(GA.queue.concat(GA.pending, GA.seated));
};
async function guestArrivalRefresh(silent) {
  // Users granted the Guest Arrival feature may have roles such as div_admin.
  // Do not skip fetching data based only on role name; Supabase RPCs enforce actual access.
  if (GA.loading) return;
  GA.loading = true; GA.error = '';
  if (!silent) R();
  try {
    const outletParams = await gaOutletParams();
    GA.context = await gaRpc('guest_arrival_context', outletParams);
    if (GA.tab === 'queue') await gaRefreshLists(outletParams);
    else if (GA.tab === 'history') {
      const rows = await gaRpc('guest_arrival_list', { p_scope:'history', p_date:GA.historyDate, ...outletParams });
      GA.history = Array.isArray(rows) ? rows : [];
      gaCaptureServerTime(GA.history);
    } else if (GA.tab === 'reservations') {
      const rows = await gaRpc('guest_reservation_list', { p_month: GA.reservationsMonth + '-01', ...outletParams });
      GA.reservations = Array.isArray(rows) ? rows : [];
    } else if (GA.tab === 'dashboard') {
      if (GA.fromDate > GA.toDate) throw new Error('Tanggal mulai harus sebelum atau sama dengan tanggal akhir.');
      GA.dashboard = await gaRpc('guest_arrival_dashboard', { p_from:GA.fromDate, p_to:GA.toDate, ...outletParams });
    }
    GA.ready = true;
  } catch (e) {
    GA.error = gaHumanError(e);
    if (typeof console !== 'undefined') console.error('Guest Arrival:', e);
  } finally {
    GA.loading = false;
    if (GA.reloadAfterCurrent) {
      GA.reloadAfterCurrent = false;
      GA.ready = false;
      GA.error = '';
      GA.queue = []; GA.pending = []; GA.seated = []; GA.history = []; GA.dashboard = null; GA.showSeated = false;
      if (pg === 'guest_arrival') setTimeout(() => guestArrivalRefresh(true), 0);
    }
    R();
    if (GA.showPending && document.querySelector('#m .ov')) guestArrivalRenderPendingModal();
    else if (!document.querySelector('#m .ov')) GA.showPending = false;
  }
}
function guestArrivalOutletChanged() {
  GA.context = null;
  GA.ready = false;
  GA.error = '';
  GA.search = '';
  GA.queue = []; GA.pending = []; GA.seated = []; GA.history = []; GA.dashboard = null; GA.showSeated = false;
  if (GA.loading) {
    GA.reloadAfterCurrent = true;
    if (pg === 'guest_arrival') R();
    return;
  }
  if (pg === 'guest_arrival') void guestArrivalRefresh(true);
}
function guestArrivalSetTab(tab) {
  if (!['queue','dashboard','history','reservations'].includes(tab)) return;
  GA.tab = tab; GA.showSeated = false; GA.ready = false; GA.error = ''; GA.search = '';
  R(); guestArrivalRefresh();
}
function guestArrivalRender() {
  if (!GA.ready && !GA.loading) setTimeout(() => guestArrivalRefresh(), 0);
  const tabs = [['queue','Antrean Hari Ini'],['dashboard','Dashboard'],['history','Riwayat']];
  return '<style>' + gaCss + '</style><section class="ga-wrap' + (GA.showSeated ? ' ga-wrap-seated' : GA.tab==='dashboard' ? ' ga-wrap-dashboard' : GA.tab==='queue' ? ' ga-wrap-queue' : GA.tab==='history' ? ' ga-wrap-history' : '') + '">' +
    '<div class="ga-heading"><h2>Guest Arrival &amp; Waiting List</h2><div class="ga-heading-meta">' + (GA.context && GA.context.outlet_code ? '<span class="ga-outlet-pill" title="' + gaEscape(GA.context.outlet_name || GA.context.outlet_code) + '">' + gaEscape(GA.context.outlet_code) + '</span>' : '') + '<span class="ga-date-pill">' + gaEscape(gaFormatDate(gaToday())) + ' WIB</span></div></div>' +
    '<div class="ga-tabs" role="tablist">' + tabs.map(([key,title]) => '<button type="button" class="ga-tab ' + (GA.tab===key?'active':'') + '" aria-selected="' + (GA.tab===key?'true':'false') + '" onclick="guestArrivalSetTab(\'' + key + '\')">' + title + '</button>').join('') + '</div>' +
    (GA.tab==='queue' && !GA.showSeated ? '<div class="ga-queue-shortcuts"><button type="button" class="ga-btn secondary ga-seated-shortcut" onclick="guestArrivalToggleSeatedView()"><span class="ga-seated-shortcut-icon" aria-hidden="true">▦</span><span>Tamu yang Telah Duduk (' + GA.seated.length + ')</span></button><button type="button" class="ga-btn secondary ga-reservations-shortcut" onclick="guestArrivalSetTab(\'reservations\')"><span class="ga-seated-shortcut-icon" aria-hidden="true">▦</span><span>Reservasi</span></button></div>' : '') +
    (GA.error ? '<div class="ga-error" role="alert"><strong>Data belum berhasil dimuat.</strong><span>' + gaEscape(GA.error) + '</span><button type="button" class="ga-btn secondary" onclick="guestArrivalRefresh()">Coba lagi</button></div>' : '') +
    (GA.loading ? '<div class="ga-load"><span class="ga-spinner"></span><span>Memuat data dari server…</span></div>' : GA.tab==='queue' ? (GA.showSeated ? guestArrivalSeatedMarkup() : guestArrivalQueueMarkup()) : GA.tab==='history' ? guestArrivalHistoryMarkup() : GA.tab==='reservations' ? guestArrivalReservationsMarkup() : guestArrivalDashboardMarkup()) +
    '</section>';
}
const gaCss = String.raw`
.ga-wrap{max-width:1050px;margin:0 auto;padding:clamp(10px,2.5vw,22px);color:var(--tx,#26332a);font-family:var(--fn,'Plus Jakarta Sans',system-ui,sans-serif)}
.ga-heading{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:2px 0 18px}
.ga-heading h2{font-size:clamp(20px,3vw,28px);line-height:1.2;margin:4px 0 7px}
.ga-eyebrow{font-size:10px;letter-spacing:.14em;font-weight:800;color:var(--ac,#6e9b57)}
.ga-muted{color:var(--mu,#758078);font-size:12px}
.ga-date-pill{border:1px solid var(--br,#d5ddd1);border-radius:999px;padding:7px 10px;font-size:11px;white-space:nowrap;background:var(--cd,#fff)}
.ga-tabs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;padding:5px;background:var(--tint,rgba(100,140,95,.13));border-radius:14px;margin:0 0 16px}
.ga-tab{border:0;border-radius:10px;padding:11px 5px;background:transparent;font-weight:700;font-size:12px;color:var(--tx,#26332a);min-width:0}
.ga-tab.active{background:var(--cd,#fff);box-shadow:0 2px 8px rgba(0,0,0,.08);color:var(--ac,#527c48)}
.ga-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:0 0 14px}
.ga-sitting-chip{display:inline-flex;align-items:center;gap:6px;padding:8px 11px;border:1.5px solid #b4533f;border-radius:11px;background:#fff0e8;color:#873a2d;font-size:12px;font-weight:800;font-variant-numeric:tabular-nums}.ga-sitting-chip strong{font-size:14px;letter-spacing:.04em}.ga-sitting-chip.expired{background:#fde2df;border-color:#bd3434;color:#a32020}.ga-seated-filter-wrap>.ga-field{grid-column:1/-1}.ga-seated-back{width:100%;justify-content:flex-start;margin:0 0 12px;font-weight:800}.ga-move-table-panel{margin:14px 0;padding:14px;border:2px solid #b4533f;border-radius:15px;background:#f9e8e2;color:#873a2d}.ga-move-table-panel label{display:block;margin-bottom:8px;font-size:13px;font-weight:900;letter-spacing:.03em}.ga-move-table-panel input{width:100%;min-height:54px;padding:13px 14px;border:2px solid #b4533f;border-radius:12px;background:#fffdfb;color:#452a25;font:800 17px/1.3 var(--fn,'Plus Jakarta Sans',sans-serif);box-sizing:border-box}.ga-move-table-panel input:focus{outline:3px solid rgba(180,83,63,.22);outline-offset:2px}.ga-queue-shortcuts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:0 0 14px}.ga-seated-shortcut,.ga-reservations-shortcut{width:100%;justify-content:flex-start;gap:10px;margin:0;min-height:48px;padding:12px 15px;background:#f8e7e1;border-color:#dfb5ab;color:#8b3f34;font-weight:850;text-align:left}
.ga-seated-shortcut.active{background:var(--ac,#b4533f);border-color:var(--ac,#b4533f);color:var(--onac,#fff)}
.ga-seated-shortcut-icon{display:grid;place-items:center;flex:none;width:26px;height:26px;border:1.5px solid currentColor;border-radius:8px;font-size:17px;line-height:1}
.ga-table-chip{display:inline-flex;align-items:center;padding:5px 8px;border-radius:9px;background:#f8e7e1;color:#8b3f34;font-size:12px;font-weight:850}
.ga-seating-highlight{margin:14px 0;padding:14px;border:2px solid #b4533f;border-radius:15px;background:#f9e8e2;color:#873a2d}
.ga-seating-highlight label{display:block;margin-bottom:8px;font-size:13px;font-weight:900;letter-spacing:.03em}
.ga-seating-highlight input{width:100%;min-height:54px;padding:13px 14px;border:2px solid #b4533f;border-radius:12px;background:#fffdfb;color:#452a25;font:800 17px/1.3 var(--fn,'Plus Jakarta Sans',sans-serif);box-sizing:border-box}
.ga-seating-highlight input:focus{outline:3px solid rgba(180,83,63,.22);outline-offset:2px}
.ga-table-value{display:inline-flex;padding:7px 10px;border-radius:9px;background:#f8e7e1;color:#8b3f34;font-size:15px;font-weight:900}
.ga-btn{display:inline-flex;justify-content:center;align-items:center;gap:7px;min-height:43px;padding:10px 13px;border:1px solid var(--line,var(--br,#cbd6c8));border-radius:12px;background:var(--cd,#fff);color:var(--tx,#26332a);font-weight:750;font-size:13px;text-decoration:none;cursor:pointer}
.ga-btn:disabled{opacity:.58;cursor:wait}
.ga-btn.primary{background:var(--ac,#6e9b57);color:var(--onac,#fff);border-color:var(--ac,#6e9b57)}
.ga-btn.secondary{background:var(--cd,#fff)}
.ga-btn.danger{background:#fff0ee;border-color:#e7b4ac;color:#a6372b}
.ga-btn.small{min-height:34px;padding:7px 10px;font-size:11px;border-radius:10px}
.ga-btn.wide{width:100%}
.ga-btn-row{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.ga-section-title{display:flex;justify-content:space-between;align-items:center;gap:10px;margin:18px 0 10px}
.ga-section-title h3{font-size:16px}
.ga-count{font-size:11px;color:var(--mu,#758078)}
.ga-card-list{display:grid;gap:10px}
.ga-card{border:1px solid var(--br,#d7dfd3);border-radius:15px;padding:13px;background:var(--cd,#fff);box-shadow:0 2px 7px rgba(30,50,35,.04);min-width:0}.ga-card-reservation{background:#edf4e9;border:1.5px solid #9db79a;box-shadow:0 3px 0 rgba(91,125,88,.16)}.ga-card-reservation .ga-rsv-linked-code{background:#dcead7;border-color:#9db79a;color:#385b3c}.ga-card-reservation .ga-status{border-color:#b4cdb0}
.ga-card-top{display:flex;justify-content:space-between;align-items:flex-start;gap:10px}
.ga-queue-code{font-size:18px;font-weight:850;letter-spacing:.01em;line-height:1.2}.ga-rsv-linked-code{display:inline-flex;align-items:center;margin-top:4px;padding:3px 7px;border:1px solid #dfb5ab;border-radius:7px;background:#fff0e8;color:#873a2d;font-size:10px;font-weight:800;letter-spacing:.02em;line-height:1.3}
.ga-name{font-size:15px;font-weight:800;overflow-wrap:anywhere;margin:5px 0}
.ga-card-meta{display:flex;flex-wrap:wrap;gap:6px 12px;font-size:12px;margin-top:9px;align-items:center}
.ga-wait{display:inline-flex;align-items:center;gap:5px;padding:5px 8px;background:var(--tint,rgba(100,140,95,.13));border-radius:9px;font-variant-numeric:tabular-nums;font-size:12px;font-weight:800}
.ga-status{display:inline-flex;align-items:center;padding:5px 8px;border-radius:999px;font-size:10px;font-weight:800;white-space:nowrap}
.ga-status.waiting{background:#fff3d5;color:#825b00}
.ga-status.seated{background:#f8e5df;color:#8b3f34}
.ga-status.done{background:#e3f3e3;color:#28623a}
.ga-status.cancelled{background:#fbe6e3;color:#a6372b}
.ga-card-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:13px}
.ga-card-actions .ga-btn{min-width:0}
.ga-empty{padding:28px 12px;text-align:center;border:1px dashed var(--br,#ccd7c9);border-radius:14px;color:var(--mu,#758078);background:var(--cd,#fff)}
.ga-empty strong{display:block;color:var(--tx,#26332a);font-size:14px;margin-bottom:5px}
.ga-error{display:grid;gap:7px;border:1px solid #e3ada6;background:#fff4f2;color:#7f2f27;border-radius:12px;padding:12px;margin:10px 0}
.ga-load{display:flex;align-items:center;justify-content:center;gap:10px;padding:24px;font-size:12px;color:var(--mu,#758078)}
.ga-spinner{width:17px;height:17px;border:2px solid var(--br,#ccd7c9);border-top-color:var(--ac,#6e9b57);border-radius:50%;animation:gaSpin .8s linear infinite}
@keyframes gaSpin{to{transform:rotate(360deg)}}
.ga-filters{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;margin:10px 0 14px}
.ga-field{display:grid;gap:6px;min-width:0;font-size:12px;font-weight:700}
.ga-field input,.ga-field select,.ga-field textarea{box-sizing:border-box;width:100%;min-height:42px;padding:10px 11px;border:1px solid var(--br,#cbd6c8);border-radius:10px;background:var(--in,var(--cd,#fff));color:var(--tx,#26332a);font:inherit;font-weight:500;outline-offset:2px}
.ga-field textarea{min-height:75px;resize:vertical}
.ga-field input:focus,.ga-field select:focus,.ga-field textarea:focus{outline:2px solid var(--ac,#6e9b57);border-color:transparent}
.ga-field .ga-muted{font-weight:500}
.ga-stat-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;margin:12px 0}
.ga-stat{padding:12px;border:1px solid var(--br,#d7dfd3);border-radius:13px;background:var(--cd,#fff);min-width:0}
.ga-stat label{display:block;font-size:11px;color:var(--mu,#758078);line-height:1.35}
.ga-stat strong{display:block;font-size:clamp(20px,3.5vw,26px);line-height:1.25;margin-top:7px;overflow-wrap:anywhere}
.ga-stat .ga-unit{font-size:11px;font-weight:600}
.ga-report-card{border:1px solid var(--br,#d7dfd3);border-radius:14px;background:var(--cd,#fff);padding:13px;margin-top:12px}
.ga-month-list{display:grid;gap:8px}
.ga-month{display:flex;justify-content:space-between;gap:12px;padding:10px;border-radius:10px;background:var(--tint,rgba(100,140,95,.13));font-size:12px}
.ga-month strong{font-variant-numeric:tabular-nums}
.ga-wa{color:var(--tt2,var(--ac,#527c48));font-weight:750;text-decoration:none;overflow-wrap:anywhere}
.ga-modal-heading{font-size:19px;margin:0 0 6px}
.ga-modal-intro{font-size:12px;color:var(--mu,#758078);margin:0 0 16px}
.ga-detail-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:11px}
.ga-detail-item{min-width:0}
.ga-detail-item label{display:block;font-size:10px;color:var(--mu,#758078);margin-bottom:4px}
.ga-detail-item div{font-size:13px;font-weight:700;overflow-wrap:anywhere}
.ga-detail-wide{grid-column:1/-1}
.ga-change-list{display:grid;gap:10px;margin-top:10px}
.ga-change{border-left:3px solid var(--ac,#6e9b57);padding:2px 0 2px 10px;font-size:12px}
.ga-change-fields{display:grid;gap:5px;margin-top:7px}
.ga-change-field{display:flex;flex-wrap:wrap;gap:4px;line-height:1.45;overflow-wrap:anywhere}
.ga-change-field strong{font-weight:800}
.ga-change-field span{overflow-wrap:anywhere}
.ga-change-empty{margin-top:7px;color:var(--mu,#758078)}
.ga-table-route{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.ga-table-route .ga-table-value{margin:2px 0}
.ga-table-route-arrow{color:var(--ac,#6e9b57);font-size:17px;font-weight:900;line-height:1}
.ga-inline-summary{font-size:12px;color:var(--mu,#758078);margin-top:7px}
@media(min-width:640px){.ga-stat-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.ga-month-list{grid-template-columns:repeat(2,minmax(0,1fr))}.ga-card{padding:15px}.ga-filters{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media(max-width:420px){.ga-heading{align-items:flex-start}.ga-date-pill{font-size:10px;padding:6px 8px}.ga-tabs{gap:3px}.ga-tab{font-size:11px;padding:10px 2px}.ga-card-actions{gap:6px}.ga-card-actions .ga-btn{padding:8px 5px;font-size:11px}.ga-detail-grid{grid-template-columns:1fr}.ga-detail-wide{grid-column:auto}}
/* Solid foundation card: keep the red dotted page as a frame, not behind the text. */
#app.in .ga-wrap{
  width:calc(100% - 20px)!important;
  max-width:1050px!important;
  margin:14px auto 24px!important;
  padding:clamp(14px,3vw,24px)!important;
  background:#fffaf5!important;
  border:2px solid #3b211d!important;
  border-radius:20px!important;
  box-shadow:0 6px 0 #3b211d!important;
  color:#351a16!important;
  opacity:1!important;
}
#app.in .ga-wrap .ga-tabs{background:#f0e5dc!important;border:1px solid #cbb7ad}
#app.in .ga-wrap .ga-tab{background:transparent}
#app.in .ga-wrap .ga-tab.active{background:#fff!important;border:1px solid #cbb7ad;box-shadow:0 2px 0 rgba(59,33,29,.10)}
#app.in .ga-wrap .ga-empty{background:#fff!important;border:1px solid #d9c9c0!important}
/* High-specificity text contrast override for the red Guest Arrival theme. */
#app.in .ga-wrap .ga-heading p.ga-muted,
#app.in .ga-wrap .ga-count,
#app.in .ga-wrap .ga-inline-summary,
#app.in .ga-wrap .ga-load,
#app.in .ga-wrap .ga-eyebrow,
#app.in .ga-wrap .ga-empty,
#app.in .ga-wrap .ga-muted { color:#44251f !important; opacity:1 !important; -webkit-text-fill-color:#44251f !important; }
#app.in .ga-wrap .ga-heading h2,
#app.in .ga-wrap .ga-section-title h3,
#app.in .ga-wrap .ga-empty strong,
#app.in .ga-wrap .ga-name,
#app.in .ga-wrap .ga-queue-code { color:#351a16 !important; opacity:1 !important; -webkit-text-fill-color:#351a16 !important; }
#app.in .ga-wrap .ga-tab { color:#351a16 !important; opacity:1 !important; }
#app.in .ga-wrap .ga-tab.active { color:#8b3f34 !important; }
#app.in .ga-wrap .ga-card,
#app.in .ga-wrap .ga-date-pill,
#app.in .ga-wrap .ga-empty { opacity:1 !important; }
/* Compact mobile-first layout: reduce vertical whitespace and balance columns. */
#app.in .ga-wrap { padding:clamp(12px,2.2vw,18px)!important; }
#app.in .ga-wrap .ga-heading { margin:0 0 12px!important; gap:8px!important; }
#app.in .ga-wrap .ga-heading { display:flex!important; flex-direction:column!important; align-items:stretch!important; gap:4px!important; }
#app.in .ga-wrap .ga-heading h2 { font-size:clamp(18px,5.1vw,24px)!important; line-height:1.16!important; white-space:nowrap; letter-spacing:-.035em; }
#app.in .ga-wrap .ga-heading .ga-date-pill { align-self:flex-end; margin-top:1px; }
@media(max-width:360px) { #app.in .ga-wrap .ga-heading h2 { font-size:17px!important; letter-spacing:-.045em; } }
#app.in .ga-wrap .ga-heading p { margin:5px 0 0!important; line-height:1.4; }
#app.in .ga-wrap .ga-heading h2 { font-size:clamp(20px,5.5vw,26px)!important; margin:3px 0 0!important; }
#app.in .ga-wrap .ga-date-pill { padding:6px 9px!important; font-size:10px!important; }
#app.in .ga-wrap .ga-tabs { margin-bottom:10px!important; padding:4px!important; gap:4px!important; }
#app.in .ga-wrap .ga-tab { padding:9px 4px!important; }
#app.in .ga-wrap .ga-actions { gap:8px!important; margin-bottom:8px!important; }
#app.in .ga-wrap .ga-section-title { margin:12px 0 8px!important; }
#app.in .ga-wrap .ga-card-list { gap:8px!important; }
#app.in .ga-wrap .ga-card { padding:11px!important; }
#app.in .ga-wrap .ga-card-meta { gap:4px 9px!important; margin-top:7px!important; }
#app.in .ga-wrap .ga-card-actions { grid-template-columns:repeat(auto-fit,minmax(80px,1fr))!important; gap:6px!important; margin-top:9px!important; }
#app.in .ga-wrap .ga-card-actions .ga-btn { padding:7px 5px!important; font-size:11px!important; }
#app.in .ga-wrap .ga-empty { padding:20px 11px!important; }
#app.in .ga-wrap .ga-filters { gap:8px!important; margin:8px 0 10px!important; }
#app.in .ga-wrap .ga-field { gap:4px!important; }
#app.in .ga-wrap .ga-field input, #app.in .ga-wrap .ga-field select, #app.in .ga-wrap .ga-field textarea { min-height:39px!important; padding:8px 9px!important; }
#app.in .ga-wrap .ga-stat-grid { gap:8px!important; margin:8px 0!important; }
#app.in .ga-wrap .ga-stat { padding:10px!important; }
#app.in .ga-wrap .ga-stat label { font-size:10px!important; line-height:1.3!important; }
#app.in .ga-wrap .ga-stat strong { margin-top:4px!important; font-size:clamp(19px,5vw,23px)!important; }
#app.in .ga-wrap .ga-stat .ga-unit { display:block; margin-top:2px; font-size:10px!important; }
#app.in .ga-wrap .ga-report-card { margin-top:8px!important; padding:11px!important; }
#app.in .ga-wrap .ga-report-card > p { margin:4px 0 8px!important; }
#app.in .ga-wrap .ga-month-list { gap:6px!important; }
#app.in .ga-wrap .ga-month { padding:8px!important; gap:8px!important; }
#app.in .ga-wrap .ga-btn-row { margin-top:8px!important; gap:7px!important; }
#app.in .ga-wrap .ga-dashboard-controls { margin:8px 0 10px; }
#app.in .ga-wrap .ga-dashboard-actions { display:grid; grid-template-columns:minmax(0,.85fr) minmax(0,1.15fr); gap:8px; align-items:end; }
#app.in .ga-wrap .ga-dashboard-actions .ga-field { min-width:0; }
#app.in .ga-wrap .ga-dashboard-actions { align-items:stretch!important; }
#app.in .ga-wrap .ga-dashboard-actions .ga-field { display:grid; grid-template-rows:16px 44px; align-content:end; }
#app.in .ga-wrap .ga-dashboard-actions .ga-field > span { display:block; line-height:16px; min-height:16px; font-size:10px; }
#app.in .ga-wrap .ga-dashboard-actions .ga-btn { height:44px!important; min-height:44px!important; max-height:44px; align-self:stretch; box-sizing:border-box; font-size:12px!important; line-height:1.15!important; white-space:nowrap!important; padding:6px 4px!important; }
#app.in .ga-wrap .ga-dashboard-actions .ga-btn { width:100%; min-width:0; min-height:39px; padding:8px 7px!important; white-space:normal; }
@media(min-width:520px) { #app.in .ga-wrap .ga-dashboard-controls { display:grid; grid-template-columns:minmax(0,1fr) minmax(220px,.8fr); gap:12px; align-items:end; } #app.in .ga-wrap .ga-dashboard-controls .ga-filters { margin:0!important; } #app.in .ga-wrap .ga-stat-grid { grid-template-columns:repeat(3,minmax(0,1fr))!important; } }
@media(min-width:520px) { #app.in .ga-wrap .ga-stat-grid { grid-template-columns:repeat(3,minmax(0,1fr))!important; } }
@media(max-width:380px) { #app.in .ga-wrap .ga-heading h2 { font-size:17px!important; letter-spacing:-.045em; } #app.in .ga-wrap .ga-date-pill { display:inline-flex; margin-top:1px; } #app.in .ga-wrap .ga-card-actions .ga-btn { font-size:10px!important; } }



/* Prevent date filters and report actions from visually merging on narrow desktop viewports. */
#app.in .ga-wrap .ga-dashboard-controls { display:flex!important; flex-direction:column!important; gap:10px!important; min-width:0!important; }
#app.in .ga-wrap .ga-dashboard-controls .ga-filters { display:grid!important; grid-template-columns:repeat(2,minmax(0,1fr))!important; gap:10px!important; width:100%!important; min-width:0!important; margin:0!important; }
#app.in .ga-wrap .ga-dashboard-controls .ga-filters .ga-field { min-width:0!important; width:100%!important; }
#app.in .ga-wrap .ga-dashboard-controls .ga-filters input,
#app.in .ga-wrap .ga-dashboard-controls .ga-filters select { width:100%!important; min-width:0!important; max-width:100%!important; box-sizing:border-box!important; }
#app.in .ga-wrap .ga-dashboard-actions { display:grid!important; grid-template-columns:repeat(2,minmax(0,1fr))!important; gap:10px!important; width:100%!important; min-width:0!important; }
#app.in .ga-wrap .ga-dashboard-actions .ga-field { min-width:0!important; width:100%!important; grid-template-rows:16px 42px!important; }
#app.in .ga-wrap .ga-dashboard-actions .ga-field > span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
#app.in .ga-wrap .ga-dashboard-actions .ga-btn { width:100%!important; min-width:0!important; max-width:100%!important; height:42px!important; min-height:42px!important; max-height:42px!important; box-sizing:border-box!important; white-space:nowrap!important; font-size:clamp(10px,1.1vw,12px)!important; padding:5px 3px!important; }
@media(min-width:768px) {
  #app.in .ga-wrap .ga-dashboard-controls { display:grid!important; grid-template-columns:minmax(0,1fr) minmax(190px,.9fr)!important; gap:12px!important; align-items:end!important; }
  #app.in .ga-wrap .ga-dashboard-controls .ga-filters { gap:10px!important; }
}
@media(max-width:420px) {
  #app.in .ga-wrap .ga-dashboard-controls .ga-filters { gap:7px!important; }
  #app.in .ga-wrap .ga-dashboard-actions { gap:7px!important; }
}

/* Desktop-only polish: denser history controls and clearer separation between guests. */
@media(min-width:768px) {
  #app.in .ga-wrap { padding:16px 20px!important; }
  #app.in .ga-wrap .ga-heading { margin-bottom:10px!important; }
  #app.in .ga-wrap .ga-tabs { margin-bottom:8px!important; }
  #app.in .ga-wrap .ga-filters { display:grid!important; grid-template-columns:minmax(180px,.7fr) minmax(280px,1.3fr); gap:10px!important; align-items:end; margin:8px 0!important; }
  #app.in .ga-wrap .ga-filters .ga-field { min-width:0; }
  #app.in .ga-wrap .ga-filters .ga-field input,
  #app.in .ga-wrap .ga-filters .ga-field select { height:38px!important; min-height:38px!important; }
  #app.in .ga-wrap .ga-section-title { margin:10px 0 7px!important; }
  #app.in .ga-wrap .ga-card-list { gap:9px!important; }
  #app.in .ga-wrap .ga-card-list .ga-card { padding:10px 13px!important; border:1.5px solid #c8796d!important; border-left:4px solid #c75e50!important; border-radius:12px!important; background:#fffaf6!important; box-shadow:0 2px 0 rgba(83,43,35,.10),0 4px 10px rgba(83,43,35,.07)!important; }
  #app.in .ga-wrap .ga-card-list .ga-card.ga-card-reservation { background:#edf4e9!important; border:1.5px solid #9db79a!important; border-left:4px solid #6f966d!important; box-shadow:0 2px 0 rgba(65,99,62,.14),0 4px 10px rgba(65,99,62,.08)!important; }
  #app.in .ga-wrap .ga-card-list .ga-card.ga-card-reservation .ga-rsv-linked-code { background:#dcead7!important; border-color:#9db79a!important; color:#385b3c!important; }
  #app.in .ga-wrap .ga-card-list .ga-card.ga-card-reservation .ga-status { border-color:#b4cdb0!important; }
  #app.in .ga-wrap .ga-card-list .ga-card + .ga-card { margin-top:0!important; }
  #app.in .ga-wrap .ga-card-list .ga-card-top { align-items:center!important; gap:12px!important; }
  #app.in .ga-wrap .ga-card-list .ga-queue-code { font-size:15px!important; }
  #app.in .ga-wrap .ga-card-list .ga-name { font-size:13px!important; margin:2px 0!important; }
  #app.in .ga-wrap .ga-card-list .ga-card-meta { margin-top:5px!important; gap:4px 10px!important; }
  #app.in .ga-wrap .ga-card-list .ga-inline-summary { margin-top:4px!important; line-height:1.35!important; }
  #app.in .ga-wrap .ga-card-list .ga-card-actions { display:flex!important; justify-content:flex-end!important; gap:7px!important; margin-top:7px!important; }
  #app.in .ga-wrap .ga-card-list .ga-card-actions .ga-btn { width:auto!important; min-width:100px!important; min-height:30px!important; padding:6px 12px!important; font-size:11px!important; }
  #app.in .ga-wrap .ga-card-list .ga-card-actions .ga-btn.wide { width:auto!important; }
}

/* Guest Arrival contrast fix: prevent inherited opacity/low-contrast text. */
.ga-wrap,.ga-wrap *{opacity:1}
.ga-wrap .ga-muted,.ga-wrap .ga-count,.ga-wrap .ga-inline-summary,.ga-wrap .ga-load,.ga-wrap .ga-eyebrow{color:#49302b!important;opacity:1!important}
.ga-wrap .ga-heading h2,.ga-wrap .ga-section-title h3,.ga-wrap .ga-empty strong,.ga-wrap .ga-tab,.ga-wrap .ga-card,.ga-wrap .ga-date-pill{opacity:1!important}
.ga-wrap .ga-tab{color:#3b211d!important}
.ga-wrap .ga-tab.active{color:#8b3f34!important}
.ga-wrap .ga-empty{color:#654b45!important}
.ga-wrap .ga-empty strong{color:#3b211d!important}
.ga-wrap .ga-count{font-weight:650}
.ga-wrap .ga-eyebrow{color:#71362d!important}

/* Outlet identity chip is compact and remains attached to the date in the header. */
#app.in .ga-wrap .ga-heading-meta{display:flex!important;align-items:flex-start!important;justify-self:end!important;gap:5px!important;min-width:0!important;max-width:100%!important}
#app.in .ga-wrap .ga-outlet-pill{display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;min-height:24px;padding:4px 6px;border:1px solid #c8796d;border-radius:999px;background:#fff1e9;color:#71362d;font-size:9px;font-weight:850;line-height:1;letter-spacing:.035em}
#app.in .ga-wrap .ga-heading-meta .ga-date-pill{flex:0 0 auto}
/* Compact date badge: keep the date inside the heading row without adding a separate row. */
#app.in .ga-wrap .ga-heading{
  display:grid!important;
  grid-template-columns:minmax(0,1fr) auto!important;
  align-items:start!important;
  gap:clamp(6px,1.4vw,12px)!important;
  position:relative!important;
  min-width:0!important;
  margin:0 0 10px!important;
}
#app.in .ga-wrap .ga-heading h2{
  min-width:0!important;
  margin:2px 0 0!important;
  font-size:clamp(17px,3.2vw,24px)!important;
  line-height:1.14!important;
  letter-spacing:-.035em!important;
  white-space:normal!important;
  overflow-wrap:normal!important;
  word-break:normal!important;
}
#app.in .ga-wrap .ga-heading .ga-date-pill{
  justify-self:end!important;
  align-self:start!important;
  position:static!important;
  display:inline-flex!important;
  align-items:center!important;
  max-width:100%!important;
  margin:0!important;
  padding:5px 7px!important;
  font-size:clamp(8px,1.25vw,10px)!important;
  line-height:1.15!important;
  letter-spacing:-.01em!important;
  white-space:nowrap!important;
  box-sizing:border-box!important;
}
#app.in .ga-wrap .ga-tabs{margin-top:0!important}
@media(max-width:380px){
  #app.in .ga-wrap .ga-heading{gap:5px!important}
  #app.in .ga-wrap .ga-heading h2{font-size:16px!important;letter-spacing:-.04em!important}
  #app.in .ga-wrap .ga-heading .ga-date-pill{font-size:8px!important;padding:4px 5px!important}
}

/* Keep Guest Arrival on its dedicated terracotta-red theme, independent of the account accent. */
body:has(#app.in .ga-wrap){
  background-color:#B4533F!important;
  background-image:radial-gradient(rgba(255,232,225,.58) 2px,transparent 2px)!important;
  background-size:32px 32px!important;
}
#app.in .ga-wrap{
  --ac:#B4533F;
  --tint:rgba(180,83,63,.14);
  --br:#D9A69B;
  --line:#3B211D;
  --onac:#FFFFFF;
}
/* Compact WhatsApp helper and the new guest preference/note fields. */
.ga-form-tight{margin-top:8px!important}
.ga-wa-field{gap:4px!important}
.ga-wa-help{display:block;margin-top:-1px!important;font-size:11px!important;line-height:1.25!important}
.ga-preference-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:6px 0 0}
.ga-preference-btn{display:flex;align-items:center;justify-content:center;gap:7px;min-width:0;min-height:44px;padding:8px 6px;border:2px solid #3b211d;border-radius:12px;background:#fff5ef;color:#351a16;font:750 12px/1.2 var(--fn,'Plus Jakarta Sans',sans-serif);cursor:pointer}
.ga-preference-btn svg{width:20px;height:20px;flex:none}
.ga-preference-btn.active{background:#c96759;border-color:#304235;color:#fff}
.ga-note-field{margin-top:8px!important}
.ga-note-field textarea{min-height:66px!important;resize:vertical}
.ga-status-field{margin-top:8px!important}
.ga-preference-chip{display:inline-flex;align-items:center;padding:4px 7px;border-radius:8px;background:#f7e8e2;color:#8b3f34;font-size:11px;font-weight:750}
/* Lift the add-guest card above the mobile keyboard while entering Note. */
#app.in .ov.ga-keyboard-open{
  align-items:flex-start!important;
  justify-content:center!important;
  padding:8px 0 10px!important;
  overflow-y:auto!important;
  overscroll-behavior:contain;
}
#app.in .ov.ga-keyboard-open .md{
  max-height:calc(var(--ga-visual-height, 100dvh) - 18px)!important;
  overflow-y:auto!important;
  margin:0 auto!important;
  flex-shrink:0!important;
  scroll-padding-bottom:24px;
}
#app.in .ov.ga-keyboard-open .ga-note-field textarea{
  scroll-margin-top:18px;
  scroll-margin-bottom:24px;
}
/* Compact detail modal: two balanced columns with clear separators. */
.ga-detail-grid{
  grid-template-columns:repeat(2,minmax(0,1fr))!important;
  gap:0 12px!important;
  align-items:stretch!important;
}
.ga-detail-item{
  min-width:0!important;
  padding:8px 0 9px!important;
  border-bottom:1px solid #ead5ce!important;
}
.ga-detail-item:nth-child(odd):not(.ga-detail-wide){
  padding-right:8px!important;
  border-right:1px solid #ead5ce!important;
}
.ga-detail-item label{
  margin:0 0 3px!important;
  font-size:10px!important;
  line-height:1.25!important;
}
.ga-detail-item>div{
  min-width:0!important;
  font-size:12px!important;
  line-height:1.35!important;
  overflow-wrap:anywhere!important;
}
.ga-detail-wide{grid-column:1/-1!important;padding-right:0!important;border-right:0!important}
.ga-detail-item .ga-status{vertical-align:top}
@media(max-width:380px){.ga-preference-btn{gap:4px;font-size:10px;padding:7px 3px}.ga-preference-btn svg{width:17px;height:17px}}

/* Make Antrean Hari Ini use the same compact, solid top shell as Dashboard. */
@media(max-width:600px){
  #app.in .ga-wrap.ga-wrap-queue{
    width:calc(100% - 12px)!important;
    margin:8px auto 14px!important;
    padding:10px!important;
    background:#fffaf5!important;
    background-image:none!important;
    border:2px solid #3b211d!important;
    border-radius:16px!important;
    box-shadow:0 4px 0 #3b211d!important;
    color:#351a16!important;
    opacity:1!important;
  }
  #app.in .ga-wrap.ga-wrap-queue .ga-heading{margin:0 0 7px!important;gap:6px!important}
  #app.in .ga-wrap.ga-wrap-queue .ga-heading h2{font-size:clamp(17px,4.7vw,21px)!important;line-height:1.12!important}
  #app.in .ga-wrap.ga-wrap-queue .ga-tabs{margin:0 0 7px!important;padding:3px!important;gap:3px!important}
  #app.in .ga-wrap.ga-wrap-queue .ga-tab{min-height:36px!important;padding:7px 3px!important;font-size:11px!important}
  #app.in .ga-wrap.ga-wrap-queue .ga-seated-shortcut{margin-bottom:7px!important}
}

/* Match Riwayat to the compact, solid shell used by Antrean and Dashboard. */
@media(max-width:600px){
  #app.in .ga-wrap.ga-wrap-history{
    width:calc(100% - 12px)!important;
    margin:8px auto 14px!important;
    padding:10px!important;
    background:#fffaf5!important;
    background-image:none!important;
    border:2px solid #3b211d!important;
    border-radius:16px!important;
    box-shadow:0 4px 0 #3b211d!important;
    color:#351a16!important;
    opacity:1!important;
  }
  #app.in .ga-wrap.ga-wrap-history .ga-heading{margin:0 0 7px!important;gap:6px!important}
  #app.in .ga-wrap.ga-wrap-history .ga-heading h2{font-size:clamp(17px,4.7vw,21px)!important;line-height:1.12!important}
  #app.in .ga-wrap.ga-wrap-history .ga-tabs{margin:0 0 7px!important;padding:3px!important;gap:3px!important}
  #app.in .ga-wrap.ga-wrap-history .ga-tab{min-height:36px!important;padding:7px 3px!important;font-size:11px!important}
  #app.in .ga-wrap.ga-wrap-history .ga-filters{gap:6px!important;margin:5px 0 8px!important}
  #app.in .ga-wrap.ga-wrap-history .ga-field{gap:4px!important;font-size:11px!important;line-height:1.2!important}
  #app.in .ga-wrap.ga-wrap-history .ga-field input{
    min-height:38px!important;height:38px!important;padding:7px 8px!important;font-size:12px!important;border-radius:9px!important;
  }
  #app.in .ga-wrap.ga-wrap-history .ga-section-title{margin:9px 0 5px!important;gap:6px!important}
  #app.in .ga-wrap.ga-wrap-history .ga-section-title h3{font-size:15px!important;line-height:1.2!important}
  #app.in .ga-wrap.ga-wrap-history .ga-count{font-size:10px!important;white-space:nowrap}
  #app.in .ga-wrap.ga-wrap-history .ga-card-list{gap:7px!important}
  #app.in .ga-wrap.ga-wrap-history .ga-card{padding:9px!important;border-radius:12px!important;box-shadow:0 1px 3px rgba(30,50,35,.035)!important}
  #app.in .ga-wrap.ga-wrap-history .ga-card-top{gap:6px!important}
  #app.in .ga-wrap.ga-wrap-history .ga-queue-code{font-size:16px!important;line-height:1.1!important}
  #app.in .ga-wrap.ga-wrap-history .ga-name{font-size:14px!important;line-height:1.22!important;margin:3px 0!important}
  #app.in .ga-wrap.ga-wrap-history .ga-card-meta{gap:5px 7px!important;margin-top:6px!important;line-height:1.2!important;font-size:11px!important}
  #app.in .ga-wrap.ga-wrap-history .ga-preference-chip,
  #app.in .ga-wrap.ga-wrap-history .ga-wait{padding:4px 6px!important;font-size:10px!important;border-radius:7px!important}
  #app.in .ga-wrap.ga-wrap-history .ga-inline-summary{font-size:11px!important;line-height:1.3!important;margin-top:4px!important}
  #app.in .ga-wrap.ga-wrap-history .ga-card-actions{gap:6px!important;margin-top:8px!important}
  #app.in .ga-wrap.ga-wrap-history .ga-card-actions .ga-btn{min-height:35px!important;padding:6px 7px!important;font-size:11px!important;border-radius:9px!important}
}

/* Compact, space-efficient dashboard layout for mobile screens. */
@media(max-width:600px){
  #app.in .ga-wrap.ga-wrap-dashboard{
    width:calc(100% - 12px)!important;
    margin:8px auto 14px!important;
    padding:10px!important;
    border-radius:16px!important;
    box-shadow:0 4px 0 #3b211d!important;
  }
  #app.in .ga-wrap.ga-wrap-dashboard .ga-heading{margin:0 0 7px!important;gap:6px!important}
  #app.in .ga-wrap.ga-wrap-dashboard .ga-heading h2{font-size:clamp(17px,4.7vw,21px)!important;line-height:1.12!important}
  #app.in .ga-wrap.ga-wrap-dashboard .ga-tabs{margin:0 0 7px!important;padding:3px!important;gap:3px!important}
  #app.in .ga-wrap.ga-wrap-dashboard .ga-tab{min-height:36px!important;padding:7px 3px!important;font-size:11px!important}
  #app.in .ga-wrap.ga-wrap-dashboard .ga-dashboard-controls{gap:7px!important;margin:5px 0 7px!important}
  #app.in .ga-wrap.ga-wrap-dashboard .ga-dashboard-controls>.ga-filters{gap:6px!important;margin:0!important}
  #app.in .ga-wrap.ga-wrap-dashboard .ga-dashboard-controls .ga-field{gap:3px!important;font-size:11px!important;line-height:1.2!important}
  #app.in .ga-wrap.ga-wrap-dashboard .ga-dashboard-controls input[type="date"]{
    min-height:38px!important;height:38px!important;padding:6px 7px!important;font-size:12px!important;border-radius:9px!important;
  }
  #app.in .ga-wrap.ga-wrap-dashboard .ga-dashboard-actions{gap:6px!important}
  #app.in .ga-wrap.ga-wrap-dashboard .ga-dashboard-actions .ga-field{grid-template-rows:14px 38px!important;gap:3px!important}
  #app.in .ga-wrap.ga-wrap-dashboard .ga-dashboard-actions .ga-field>span{min-height:14px!important;height:14px!important;line-height:14px!important;font-size:10px!important}
  #app.in .ga-wrap.ga-wrap-dashboard .ga-dashboard-actions .ga-btn{
    min-height:38px!important;height:38px!important;max-height:38px!important;padding:5px 4px!important;font-size:11px!important;border-radius:9px!important;
  }
  #app.in .ga-wrap.ga-wrap-dashboard .ga-stat-grid{gap:6px!important;margin:7px 0!important;grid-template-columns:repeat(2,minmax(0,1fr))!important}
  #app.in .ga-wrap.ga-wrap-dashboard .ga-stat{
    min-height:0!important;padding:8px!important;border-radius:11px!important;display:flex!important;flex-direction:column!important;justify-content:center!important;
  }
  #app.in .ga-wrap.ga-wrap-dashboard .ga-stat label{font-size:10px!important;line-height:1.25!important;min-height:0!important}
  #app.in .ga-wrap.ga-wrap-dashboard .ga-stat strong{font-size:clamp(18px,4.5vw,22px)!important;line-height:1.12!important;margin-top:3px!important}
  #app.in .ga-wrap.ga-wrap-dashboard .ga-stat .ga-unit{font-size:10px!important;line-height:1.15!important;margin-top:2px!important}
  #app.in .ga-wrap.ga-wrap-dashboard .ga-stat:last-child{
    grid-column:1/-1!important;display:grid!important;grid-template-columns:minmax(0,1fr) auto!important;
    grid-template-rows:auto auto;align-items:center;gap:2px 10px!important;
  }
  #app.in .ga-wrap.ga-wrap-dashboard .ga-stat:last-child label{grid-column:1;grid-row:1}
  #app.in .ga-wrap.ga-wrap-dashboard .ga-stat:last-child strong{grid-column:2;grid-row:1/3;margin:0!important;text-align:right}
  #app.in .ga-wrap.ga-wrap-dashboard .ga-stat:last-child .ga-unit{grid-column:1;grid-row:2;margin:0!important}
  #app.in .ga-wrap.ga-wrap-dashboard .ga-report-card{margin-top:7px!important;padding:9px!important;border-radius:11px!important}
  #app.in .ga-wrap.ga-wrap-dashboard .ga-report-card h3{font-size:15px!important;line-height:1.2!important}
  #app.in .ga-wrap.ga-wrap-dashboard .ga-report-card>p{margin:3px 0 6px!important;font-size:10px!important}
  #app.in .ga-wrap.ga-wrap-dashboard .ga-month-list{gap:5px!important;grid-template-columns:1fr!important}
  #app.in .ga-wrap.ga-wrap-dashboard .ga-month{padding:7px!important;gap:7px!important;font-size:11px!important;border-radius:8px!important}
}
@media(min-width:601px){
  #app.in .ga-wrap.ga-wrap-dashboard .ga-stat-grid{grid-template-columns:repeat(3,minmax(0,1fr))!important}
  #app.in .ga-wrap.ga-wrap-dashboard .ga-stat:last-child{grid-column:auto!important}
}

/* Mobile-first compact layout only for Tamu yang Telah Duduk. */
@media(max-width:600px){
  #app.in .ga-wrap.ga-wrap-seated{
    width:calc(100% - 12px)!important;
    margin:8px auto 14px!important;
    padding:10px!important;
    border-radius:16px!important;
    box-shadow:0 4px 0 #3b211d!important;
  }
  #app.in .ga-wrap.ga-wrap-seated .ga-heading{margin:0 0 7px!important;gap:6px!important}
  #app.in .ga-wrap.ga-wrap-seated .ga-heading h2{font-size:clamp(17px,4.7vw,21px)!important;line-height:1.12!important}
  #app.in .ga-wrap.ga-wrap-seated .ga-tabs{margin:0 0 7px!important;padding:3px!important;gap:3px!important}
  #app.in .ga-wrap.ga-wrap-seated .ga-tab{min-height:36px!important;padding:7px 3px!important;font-size:11px!important}
  #app.in .ga-wrap.ga-wrap-seated .ga-seated-back{
    min-height:36px!important;padding:7px 10px!important;margin:0 0 7px!important;
    border-radius:10px!important;font-size:12px!important;gap:6px!important;
  }
  #app.in .ga-wrap.ga-wrap-seated .ga-section-title{margin:9px 0 5px!important;gap:6px!important}
  #app.in .ga-wrap.ga-wrap-seated .ga-section-title h3{font-size:15px!important;line-height:1.2!important}
  #app.in .ga-wrap.ga-wrap-seated .ga-count{font-size:10px!important;white-space:nowrap}
  #app.in .ga-wrap.ga-wrap-seated .ga-filters{margin:5px 0 8px!important;gap:6px!important}
  #app.in .ga-wrap.ga-wrap-seated .ga-field{gap:4px!important;font-size:11px!important}
  #app.in .ga-wrap.ga-wrap-seated .ga-field input{
    min-height:38px!important;padding:7px 9px!important;font-size:13px!important;border-radius:9px!important;
  }
  #app.in .ga-wrap.ga-wrap-seated .ga-card-list{gap:7px!important}
  #app.in .ga-wrap.ga-wrap-seated .ga-card{
    padding:9px!important;border-radius:12px!important;box-shadow:0 1px 3px rgba(30,50,35,.035)!important;
  }
  #app.in .ga-wrap.ga-wrap-seated .ga-card-top{gap:6px!important}
  #app.in .ga-wrap.ga-wrap-seated .ga-queue-code{font-size:16px!important;line-height:1.1!important}
  #app.in .ga-wrap.ga-wrap-seated .ga-name{font-size:14px!important;line-height:1.22!important;margin:3px 0!important}
  #app.in .ga-wrap.ga-wrap-seated .ga-card-meta{gap:5px 7px!important;margin-top:6px!important;line-height:1.2!important;font-size:11px!important}
  #app.in .ga-wrap.ga-wrap-seated .ga-preference-chip,
  #app.in .ga-wrap.ga-wrap-seated .ga-table-chip{padding:4px 6px!important;font-size:10px!important;border-radius:7px!important}
  #app.in .ga-wrap.ga-wrap-seated .ga-sitting-chip{gap:5px!important;padding:5px 7px!important;font-size:10px!important;border-radius:9px!important}
  #app.in .ga-wrap.ga-wrap-seated .ga-sitting-chip strong{font-size:12px!important;letter-spacing:.015em!important}
  #app.in .ga-wrap.ga-wrap-seated .ga-wait{padding:4px 6px!important;font-size:10px!important}
  #app.in .ga-wrap.ga-wrap-seated .ga-inline-summary{font-size:11px!important;line-height:1.3!important;margin-top:4px!important}
  #app.in .ga-wrap.ga-wrap-seated .ga-card-actions{gap:6px!important;margin-top:8px!important}
  #app.in .ga-wrap.ga-wrap-seated .ga-card-actions .ga-btn{
    min-height:35px!important;padding:6px 7px!important;font-size:11px!important;border-radius:9px!important;
  }
}

.ga-rsv-time-banner{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:12px 0;padding:12px 14px;border:1.5px solid #b4533f;border-radius:12px;background:#fff0e8;color:#873a2d}.ga-rsv-time-label{font-size:10px;font-weight:850;letter-spacing:.09em}.ga-rsv-time-banner strong{font-size:clamp(22px,3vw,28px);line-height:1.1;font-weight:950;font-variant-numeric:tabular-nums;letter-spacing:.02em}.ga-rsv-details{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 12px;margin:10px 0 4px}.ga-rsv-detail{display:grid;gap:4px;min-width:0}.ga-rsv-detail>span{font-size:10px;color:var(--mu,#758078);font-weight:750}.ga-rsv-detail>strong{font-size:12px;font-weight:750;overflow-wrap:anywhere}.ga-rsv-detail-note{grid-column:1/-1;padding-top:9px;border-top:1px solid var(--br,#d7dfd3)}.ga-rsv-detail-note>strong{white-space:pre-wrap;font-weight:600}.ga-rsv-actions{grid-template-columns:repeat(3,minmax(0,1fr));align-items:center}.ga-rsv-actions .ga-btn{min-width:0;padding:9px 7px;font-size:12px}.ga-rsv-actions .ga-table-chip{grid-column:span 2;justify-content:center}.ga-rsv-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:12px 0 16px}.ga-rsv-toolbar h3,.ga-rsv-detail-head h3{margin:4px 0;font-size:clamp(17px,2.5vw,22px)}.ga-rsv-month-nav{display:flex;gap:6px;align-items:center}.ga-rsv-month-nav .ga-btn{min-width:42px;padding:8px}.ga-rsv-legend{display:flex;gap:12px;flex-wrap:wrap;margin:10px 0 12px;font-size:11px;color:var(--mu,#758078)}.ga-rsv-legend span{display:inline-flex;align-items:center;gap:6px}.ga-rsv-legend i,.ga-rsv-dots i{display:inline-block;width:7px;height:7px;border-radius:50%;background:#b98a27}.ga-rsv-legend i.seated,.ga-rsv-dots i.seated{background:#4c8a5a}.ga-rsv-legend i.cancelled,.ga-rsv-dots i.cancelled{background:#bf5b50}.ga-rsv-calendar{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:5px;padding:10px;border:1.5px solid var(--line,#26332a);border-radius:15px;background:var(--cd,#fff);box-shadow:0 3px 0 var(--line,#26332a)}.ga-rsv-weekday{text-align:center;padding:6px 0;color:var(--mu,#758078);font-size:10px;font-weight:850}.ga-rsv-day{position:relative;display:flex;flex-direction:column;align-items:flex-start;gap:5px;min-width:0;min-height:clamp(48px,8vw,82px);padding:7px;border:1px solid var(--br,#d7dfd3);border-radius:10px;background:var(--cd,#fff);color:var(--tx,#26332a);text-align:left;cursor:pointer}.ga-rsv-day.empty{visibility:hidden;border:0}.ga-rsv-day-num{font-size:12px;font-weight:800;line-height:1}.ga-rsv-day.today .ga-rsv-day-num{display:grid;place-items:center;width:23px;height:23px;margin:-4px 0 0 -4px;border-radius:50%;background:var(--ac,#6e9b57);color:var(--onac,#fff)}.ga-rsv-day.selected{outline:2px solid var(--tx,#26332a);outline-offset:-2px;background:var(--tint,rgba(100,140,95,.13))}.ga-rsv-day.has-items{border-color:var(--tx,#26332a)}.ga-rsv-day-count{font-size:10px;font-weight:900}.ga-rsv-dots{display:flex;gap:4px}.ga-rsv-detail-head{display:flex;justify-content:space-between;align-items:center;gap:10px;margin:20px 0 12px}.ga-rsv-form{padding:14px;margin:12px 0;border:1.5px solid var(--line,#26332a);border-radius:14px;background:var(--cd,#fff);box-shadow:0 3px 0 var(--line,#26332a)}.ga-rsv-form-heading{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:12px}.ga-rsv-form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-bottom:12px}.ga-rsv-wide{grid-column:1/-1}.ga-rsv-note{font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere;margin:10px 0 0;color:var(--mu,#758078)}.ga-rsv-card{border-color:var(--line,#26332a)}/* Reservation layout: balanced compact spacing */
.ga-rsv-toolbar{gap:6px;margin:4px 0 7px}
.ga-rsv-toolbar h3,.ga-rsv-detail-head h3{margin:1px 0}
.ga-rsv-toolbar p{margin:3px 0 0}
.ga-rsv-month-nav{gap:4px}
.ga-rsv-month-nav .ga-btn{min-width:34px;min-height:34px;padding:5px 7px}
.ga-rsv-legend{gap:7px;margin:5px 0 6px}
.ga-rsv-calendar{gap:3px;padding:6px}
.ga-rsv-weekday{padding:3px 0}
.ga-rsv-day{gap:3px;min-height:clamp(38px,5.2vw,54px);padding:4px;border-radius:8px}
.ga-rsv-day.today .ga-rsv-day-num{width:20px;height:20px}
.ga-rsv-detail-head{gap:6px;margin:9px 0 5px}
.ga-rsv-form{padding:9px;margin:5px 0;border-radius:11px}
.ga-rsv-form-heading{margin-bottom:6px}
.ga-rsv-form-grid{gap:6px;margin-bottom:6px}
.ga-rsv-card{padding:8px;margin:5px 0}
.ga-rsv-time-banner{gap:6px;margin:5px 0;padding:8px 10px}
.ga-rsv-details{gap:5px 8px;margin:5px 0 1px}
.ga-rsv-detail{gap:2px}
.ga-rsv-detail-note{padding-top:5px}
.ga-rsv-actions{gap:5px}
@media(max-width:520px){.ga-rsv-time-banner{align-items:flex-start;flex-direction:column;gap:6px}.ga-rsv-actions .ga-btn{font-size:11px;padding:8px 4px}.ga-rsv-toolbar{align-items:flex-start;flex-direction:column;gap:4px;margin:4px 0 6px}.ga-rsv-month-nav{width:100%;justify-content:space-between}.ga-rsv-month-nav .ga-btn{min-width:32px;min-height:32px;padding:4px 6px}.ga-rsv-legend{gap:6px;margin:4px 0 5px}.ga-rsv-calendar{gap:2px;padding:5px}.ga-rsv-weekday{padding:2px 0}.ga-rsv-day{gap:2px;min-height:35px;padding:3px;border-radius:7px}.ga-rsv-detail-head{margin:8px 0 5px}.ga-rsv-form{padding:8px;margin:5px 0}.ga-rsv-form-heading{margin-bottom:5px}.ga-rsv-form-grid{gap:5px;margin-bottom:5px}.ga-rsv-card{padding:7px;margin:4px 0}.ga-rsv-time-banner{margin:5px 0;padding:8px}.ga-rsv-details{gap:5px 7px;margin:5px 0 1px}.ga-rsv-day-num{font-size:11px}.ga-rsv-day-count{font-size:9px}.ga-rsv-form-grid{grid-template-columns:1fr}.ga-rsv-wide{grid-column:auto}.ga-rsv-detail-head{align-items:flex-start}.ga-rsv-detail-head>.ga-btn{padding:8px;font-size:12px}}
/* Compact reservation creation modal: tight fields, no oversized empty space. */
#m .md.ga-rsv-modal-shell{box-sizing:border-box;width:min(100%,560px);max-width:560px;max-height:calc(100dvh - 24px);padding:12px;overflow-y:auto;overscroll-behavior:contain}
.ga-rsv-form-modal{padding:0;margin:0;border:0;border-radius:0;background:transparent;box-shadow:none}
.ga-rsv-form-modal .ga-rsv-form-heading{margin:0 0 8px}
.ga-rsv-form-modal .ga-rsv-form-heading strong{font-size:18px;line-height:1.2}
.ga-rsv-form-modal .ga-rsv-form-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:7px 9px;margin:0 0 9px}
.ga-rsv-form-modal .ga-rsv-name-field,.ga-rsv-form-modal .ga-rsv-wide{grid-column:1/-1}
.ga-rsv-form-modal .ga-field{gap:3px;margin:0;font-size:12px;line-height:1.3}
.ga-rsv-form-modal .ga-field input,.ga-rsv-form-modal .ga-field select{min-height:38px;margin:0;padding:7px 9px;border-radius:9px;font-size:13px}
.ga-rsv-form-modal .ga-field textarea{min-height:54px;margin:0;padding:7px 9px;border-radius:9px;font-size:13px}
.ga-rsv-form-modal #ga-rsv-submit{width:100%;min-height:40px;padding:8px 12px}
@media(max-width:520px){
  #m .ov{padding:10px}
  #m .md.ga-rsv-modal-shell{width:calc(100vw - 20px);max-width:560px;max-height:calc(100dvh - 20px);padding:10px;border-radius:16px}
  .ga-rsv-form-modal .ga-rsv-form-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:7px 8px}
  .ga-rsv-form-modal .ga-field input,.ga-rsv-form-modal .ga-field select{min-height:36px;padding:6px 8px;font-size:12px}
  .ga-rsv-form-modal .ga-field textarea{min-height:50px;padding:6px 8px;font-size:12px}
}
 

/* Mobile reservation layout: use empty toolbar space and compact reservation cards. */
.ga-rsv-time-banner{box-sizing:border-box;width:50%;min-width:0;flex-direction:column;align-items:flex-start;justify-content:center;gap:4px;margin:6px 0;padding:8px 10px}
.ga-rsv-time-banner strong{font-size:clamp(20px,2.5vw,25px)}
.ga-rsv-note-actions{display:flex;align-items:flex-end;gap:8px;margin-top:5px;min-width:0}
.ga-rsv-note-actions .ga-rsv-detail-note{flex:1 1 0;min-width:0;margin:0;padding-top:7px}
.ga-rsv-actions{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px;flex:1 1 0;min-width:0;margin:0}
.ga-rsv-actions .ga-btn{min-width:0;min-height:34px;padding:6px 4px;font-size:11px;line-height:1.2;overflow-wrap:anywhere}
@media(max-width:520px){
  .ga-rsv-toolbar{align-items:center;flex-direction:row;gap:6px;margin:4px 0 6px}
  .ga-rsv-toolbar>div:first-child{flex:1 1 auto;min-width:0}
  .ga-rsv-toolbar .ga-eyebrow{font-size:9px}
  .ga-rsv-toolbar h3{font-size:18px;line-height:1.15;margin:2px 0}
  .ga-rsv-toolbar p{font-size:11px;line-height:1.25;margin:4px 0 0}
  .ga-rsv-month-nav{width:auto;flex:0 0 auto;justify-content:flex-end;gap:3px}
  .ga-rsv-month-nav .ga-btn{min-width:27px;min-height:31px;padding:4px 5px;font-size:11px}
  .ga-rsv-time-banner{width:50%;gap:3px;margin:5px 0;padding:7px 9px}
  .ga-rsv-time-label{font-size:9px}
  .ga-rsv-time-banner strong{font-size:21px;line-height:1.1}
  .ga-rsv-details{gap:6px 8px;margin:6px 0 2px}
  .ga-rsv-note-actions{gap:6px;margin-top:3px;align-items:flex-end}
  .ga-rsv-note-actions .ga-rsv-detail-note{padding-top:6px}
  .ga-rsv-note-actions .ga-rsv-detail-note>strong{font-size:11px}
  .ga-rsv-actions{gap:3px}
  .ga-rsv-actions .ga-btn{min-height:32px;padding:5px 2px;font-size:10px;border-radius:8px}
}

/* Reservation card two-column mobile layout; desktop keeps its previous flow. */
.ga-rsv-card-layout,.ga-rsv-card-info,.ga-rsv-card-side{display:contents}
@media(max-width:520px){
  .ga-rsv-card-layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,.92fr);gap:10px;align-items:start}
  .ga-rsv-card-info{display:flex;flex-direction:column;gap:7px;min-width:0}
  .ga-rsv-card-side{display:flex;flex-direction:column;gap:8px;min-width:0}
  .ga-rsv-card .ga-rsv-time-banner{width:100%;box-sizing:border-box;margin:0;padding:9px 8px;align-items:flex-start;gap:4px}
  .ga-rsv-card .ga-rsv-time-banner strong{font-size:clamp(19px,5vw,23px);line-height:1.1}
  .ga-rsv-card .ga-rsv-time-label{font-size:9px}
  .ga-rsv-card .ga-rsv-details{display:flex;flex-direction:column;gap:8px;margin:0}
  .ga-rsv-card .ga-rsv-detail{gap:3px}
  .ga-rsv-card .ga-rsv-detail>span{font-size:10px}
  .ga-rsv-card .ga-rsv-detail>strong{font-size:12px;line-height:1.35}
  .ga-rsv-card .ga-rsv-detail-note{padding-top:8px;border-top:1px solid var(--br,#d7dfd3)}
  .ga-rsv-card .ga-rsv-detail-note>strong{font-size:12px;overflow-wrap:anywhere}
  .ga-rsv-card .ga-rsv-actions{display:flex;flex-direction:column;gap:5px;width:100%;margin:0}
  .ga-rsv-card .ga-rsv-actions .ga-btn{width:100%;min-height:34px;padding:6px 5px;font-size:11px;line-height:1.2}
  .ga-rsv-card .ga-rsv-actions .ga-table-chip{width:100%;box-sizing:border-box;font-size:10px;padding:6px 4px}
}
`;
function guestArrivalQueueMarkup() {
  return '<div class="ga-actions"><button type="button" class="ga-btn primary" onclick="guestArrivalOpenForm()">＋ Tambah Tamu</button><button type="button" class="ga-btn secondary" onclick="guestArrivalOpenPendingModal()">Tertunda (' + GA.pending.length + ')</button></div>' +
    '<div class="ga-section-title"><h3>Tamu Menunggu</h3><span class="ga-count">' + GA.queue.length + ' antrean aktif</span></div><div id="ga-queue-cards" class="ga-card-list">' + guestArrivalQueueCards() + '</div>';
}
function guestArrivalCard(g, pending) {
  const detail = '<button type="button" class="ga-btn secondary small" onclick="guestArrivalOpenDetail(\'' + g.id + '\')">Detail</button>';
  const actions = g.status === 'Menunggu'
    ? '<button type="button" class="ga-btn primary small" onclick="guestArrivalOpenSeatModal(\'' + g.id + '\')">Duduk</button><button type="button" class="ga-btn danger small" onclick="guestArrivalCancel(\'' + g.id + '\')">Batalkan</button>'
    : g.status === 'Duduk'
      ? '<button type="button" class="ga-btn primary small" onclick="guestArrivalFinishSeated(\'' + g.id + '\')">Selesai</button>'
      : '';
  return '<article class="ga-card' + (g.reservation_code ? ' ga-card-reservation' : '') + '"><div class="ga-card-top"><div><div class="ga-queue-code">' + gaEscape(g.queue_code || ('WL-' + String(g.queue_number).padStart(3,'0'))) + '</div>' + (g.reservation_code ? '<div class="ga-rsv-linked-code">Reservasi: ' + gaEscape(g.reservation_code) + '</div>' : '') + '<div class="ga-name">' + gaEscape(g.guest_name) + '</div></div>' + gaStatusBadge(g.status) + '</div>' +
    '<div class="ga-card-meta"><span>' + Number(g.packs || 0) + ' pack</span>' + (g.whatsapp ? '<span>' + gaPhoneMarkup(g.whatsapp) + '</span>' : '') + '<span class="ga-preference-chip">' + gaEscape(g.smoking_preference || 'Non Smoking') + '</span>' + (g.table_name ? '<span class="ga-table-chip">Meja: ' + gaEscape(g.table_name) + '</span>' : '') + (g.status==='Duduk' ? '<span class="ga-sitting-chip' + (gaSittingRemaining(g)<=0?' expired':'') + '">Seating time <strong data-ga-sitting-id="' + gaEscape(g.id) + '">' + gaSittingCountdown(g) + '</strong></span>' : '<span class="ga-wait">Waiting <span class="ga-wait-time" data-ga-wait-id="' + gaEscape(g.id) + '">' + gaDuration(gaWaitSeconds(g)) + '</span></span>') + '</div>' + (g.note ? '<div class="ga-inline-summary">Note: ' + gaEscape(g.note) + '</div>' : '') +
    '<div class="ga-inline-summary">Datang ' + gaEscape(gaFormatDateTime(g.arrived_at)) + (pending ? ' · ' + gaEscape(gaFormatDate(g.operational_date)) : '') + (g.seated_at ? ' · Duduk ' + gaEscape(gaFormatDateTime(g.seated_at)) : '') + '</div><div class="ga-card-actions">' + detail + actions + '</div></article>';
}
function guestArrivalQueueCards() {
  return GA.queue.length ? GA.queue.map(g => guestArrivalCard(g,false)).join('') : '<div class="ga-empty"><strong>Belum ada tamu menunggu</strong>Antrean baru akan muncul setelah tamu didaftarkan.</div>';
}
function guestArrivalRenderQueueCards() {
  const node = document.getElementById('ga-queue-cards');
  if (node) node.innerHTML = guestArrivalQueueCards();
}
function guestArrivalToggleSeatedView() {
  if (GA.showSeated) {
    GA.showSeated = false; GA.tab = 'queue'; GA.search = ''; GA.ready = true; R();
    return;
  }
  GA.tab = 'queue'; GA.showSeated = true; GA.search = ''; GA.ready = false; GA.error = '';
  void guestArrivalRefresh();
}
function guestArrivalSeatedCards() {
  const needle = String(GA.search || '').trim().toLocaleLowerCase('id-ID');
  const rows = (GA.seated || []).filter(g =>
    String(g.guest_name || '').toLocaleLowerCase('id-ID').includes(needle) ||
    String(g.table_name || '').toLocaleLowerCase('id-ID').includes(needle) ||
    String(g.queue_code || '').toLocaleLowerCase('id-ID').includes(needle) ||
    String(g.reservation_code || '').toLocaleLowerCase('id-ID').includes(needle)
  ).slice().sort((a,b) => (Date.parse(b.seated_at || '') || 0) - (Date.parse(a.seated_at || '') || 0));
  if (!rows.length) return '<div class="ga-empty"><strong>Belum ada tamu yang telah duduk</strong>Tamu akan muncul di sini setelah status diubah menjadi Duduk.</div>';
  return rows.map(g => guestArrivalCard(g,false)).join('');
}
function guestArrivalSeatedMarkup() {
  return '<button type="button" class="ga-btn secondary ga-seated-back" onclick="guestArrivalToggleSeatedView()"><span aria-hidden="true">←</span> Kembali ke Antrean Hari Ini</button>' +
    '<div class="ga-section-title"><h3>Tamu yang Telah Duduk</h3><span class="ga-count">' + (GA.seated || []).length + ' tamu aktif</span></div>' +
    '<div class="ga-filters ga-seated-filter-wrap"><label class="ga-field">Cari nama tamu atau meja<input type="search" value="' + gaEscape(GA.search) + '" placeholder="Nama tamu, nomor antrean, atau meja…" oninput="GA.search=this.value;guestArrivalRenderSeatedCards()"></label></div>' +
    '<div id="ga-seated-cards" class="ga-card-list">' + guestArrivalSeatedCards() + '</div>';
}
function guestArrivalRenderSeatedCards() {
  const node = document.getElementById('ga-seated-cards');
  if (node) node.innerHTML = guestArrivalSeatedCards();
}
function guestArrivalHistoryMarkup() {
  return '<div class="ga-filters"><label class="ga-field">Tanggal riwayat<input type="date" value="' + gaEscape(GA.historyDate) + '" max="' + gaEscape(gaToday()) + '" onchange="guestArrivalHistoryDate(this.value)"></label><label class="ga-field">Cari nama tamu<input type="search" value="' + gaEscape(GA.search) + '" placeholder="Ketik nama tamu…" oninput="GA.search=this.value;guestArrivalRenderHistoryCards()"></label></div><div class="ga-section-title"><h3>Riwayat Tamu</h3><span class="ga-count">' + GA.history.length + ' pendaftaran</span></div><div id="ga-history-cards" class="ga-card-list">' + guestArrivalHistoryCards() + '</div>';
}
function guestArrivalHistoryCards() {
  const needle = String(GA.search || '').trim().toLocaleLowerCase('id-ID');
  const rows = GA.history
    .filter(g => String(g.guest_name || '').toLocaleLowerCase('id-ID').includes(needle))
    .slice()
    .sort((a, b) => {
      // Riwayat hanya menampilkan status final: Selesai atau Batalkan.
      const aTime = Date.parse(a.finished_at || a.arrived_at || '') || 0;
      const bTime = Date.parse(b.finished_at || b.arrived_at || '') || 0;
      return bTime - aTime;
    });
  if (!rows.length) return '<div class="ga-empty"><strong>Tamu tidak ditemukan</strong>Coba nama lain atau pilih tanggal yang berbeda.</div>';
  return rows.map(g => '<article class="ga-card"><div class="ga-card-top"><div><div class="ga-queue-code">' + gaEscape(g.queue_code) + '</div><div class="ga-name">' + gaEscape(g.guest_name) + '</div></div>' + gaStatusBadge(g.status) + '</div>' +
    '<div class="ga-card-meta"><span>' + Number(g.packs || 0) + ' pack</span>' + (g.whatsapp ? '<span>' + gaPhoneMarkup(g.whatsapp) + '</span>' : '') + '<span class="ga-preference-chip">' + gaEscape(g.smoking_preference || 'Non Smoking') + '</span><span class="ga-wait">Waiting ' + gaDuration(gaWaitSeconds(g)) + '</span></div>' + (g.note ? '<div class="ga-inline-summary">Note: ' + gaEscape(g.note) + '</div>' : '') +
    '<div class="ga-inline-summary">Datang ' + gaEscape(gaFormatDateTime(g.arrived_at)) + (g.finished_at ? ' · Selesai menunggu ' + gaEscape(gaFormatDateTime(g.finished_at)) : '') + '</div>' +
    (g.cancellation_reason ? '<div class="ga-inline-summary">Alasan pembatalan: ' + gaEscape(g.cancellation_reason) + '</div>' : '') +
    (Number(g.correction_count || 0) ? '<div class="ga-inline-summary">Pernah dikoreksi ' + Number(g.correction_count) + ' kali</div>' : '') +
    '<div class="ga-card-actions"><button type="button" class="ga-btn secondary small" onclick="guestArrivalOpenDetail(\'' + g.id + '\')">Lihat detail</button></div></article>').join('');
}
function guestArrivalRenderHistoryCards() {
  const node = document.getElementById('ga-history-cards');
  if (node) node.innerHTML = guestArrivalHistoryCards();
}
async function guestArrivalHistoryDate(value) {
  if (!value) return;
  GA.historyDate = value; GA.search = ''; GA.ready = false;
  await guestArrivalRefresh();
}
function guestArrivalSecondsStat(seconds) { return gaDuration(Number(seconds) || 0); }

const gaReservationDateLabel = (value, options={}) => {
  const d = new Date(String(value || '') + (String(value || '').length === 10 ? 'T12:00:00+07:00' : ''));
  if (!Number.isFinite(d.getTime())) return String(value || '—');
  return new Intl.DateTimeFormat('id-ID', {timeZone:'Asia/Jakarta', ...options}).format(d);
};
const gaReservationDateKey = (value) => {
  const d = new Date(String(value || ''));
  if (!Number.isFinite(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone:'Asia/Jakarta', year:'numeric', month:'2-digit', day:'2-digit'
  }).formatToParts(d);
  const year = parts.find(part => part.type === 'year')?.value;
  const month = parts.find(part => part.type === 'month')?.value;
  const day = parts.find(part => part.type === 'day')?.value;
  return year && month && day ? year + '-' + month + '-' + day : '';
};
function guestArrivalReservationsMarkup() {
  const [year, month] = GA.reservationsMonth.split('-').map(Number);
  const first = new Date(Date.UTC(year, month - 1, 1, 12));
  const offset = first.getUTCDay();
  const days = new Date(Date.UTC(year, month, 0, 12)).getUTCDate();
  const today = gaToday();
  const byDate = {};
  (GA.reservations || []).forEach(r => {
    const key = gaReservationDateKey(r.reservation_at);
    if (key) (byDate[key] ||= []).push(r);
  });
  const weekday = ['Min','Sen','Sel','Rab','Kam','Jum','Sab'];
  let cells = weekday.map(d => '<div class="ga-rsv-weekday">' + d + '</div>').join('');
  for (let i=0;i<offset;i++) cells += '<div class="ga-rsv-day empty" aria-hidden="true"></div>';
  for (let day=1;day<=days;day++) {
    const date = GA.reservationsMonth + '-' + String(day).padStart(2,'0');
    const items = byDate[date] || [];
    const active = items.filter(r => r.status === 'Menunggu Reservasi').length;
    const seated = items.filter(r => r.status === 'Duduk').length;
    const cancelled = items.filter(r => r.status === 'Dibatalkan').length;
    cells += '<button type="button" class="ga-rsv-day' + (date===today?' today':'') + (date===GA.reservationsDate?' selected':'') + (items.length?' has-items':'') + '" onclick="guestArrivalReservationSelectDate(\''+date+'\')" aria-label="'+date+', '+items.length+' reservasi">' +
      '<span class="ga-rsv-day-num">'+day+'</span>' +
      (items.length ? '<span class="ga-rsv-day-count">'+items.length+'</span><span class="ga-rsv-dots">'+(active?'<i class="waiting"></i>':'')+(seated?'<i class="seated"></i>':'')+(cancelled?'<i class="cancelled"></i>':'')+'</span>' : '') +
      '</button>';
  }
  const selected = (GA.reservations || []).filter(r => gaReservationDateKey(r.reservation_at) === GA.reservationsDate);
  const cards = selected.length ? '<div class="ga-card-list">'+selected.map(r =>
    '<article class="ga-card ga-rsv-card"><div class="ga-card-top"><div><div class="ga-queue-code">'+gaEscape(r.reservation_code)+'</div><div class="ga-name">'+gaEscape(r.guest_name)+'</div></div><span class="ga-status '+(r.status==='Duduk'?'seated':r.status==='Dibatalkan'?'cancelled':'waiting')+'">'+gaEscape(r.status)+'</span></div>' +
    '<div class="ga-rsv-card-layout"><div class="ga-rsv-card-info"><div class="ga-rsv-details"><div class="ga-rsv-detail"><span>Tanggal</span><strong>'+gaEscape(gaReservationDateLabel(r.reservation_at,{weekday:'long',day:'numeric',month:'long',year:'numeric'}))+'</strong></div><div class="ga-rsv-detail"><span>Preferensi smoking</span><strong>'+gaEscape(r.smoking_preference||'Non Smoking')+'</strong></div><div class="ga-rsv-detail"><span>Jumlah pack</span><strong>'+gaEscape(r.packs)+' pack</strong></div><div class="ga-rsv-detail"><span>WhatsApp</span><strong>'+(r.whatsapp?gaPhoneMarkup(r.whatsapp):'—')+'</strong></div></div>' +
    '<div class="ga-rsv-detail ga-rsv-detail-note"><span>Catatan</span><strong>'+(r.note?gaEscape(r.note):'—')+'</strong></div></div><div class="ga-rsv-card-side"><div class="ga-rsv-time-banner"><span class="ga-rsv-time-label">JAM RESERVASI</span><strong>'+gaEscape(gaReservationDateLabel(r.reservation_at,{hour:'2-digit',minute:'2-digit'}))+' WIB</strong></div>' +
    '<div class="ga-card-actions ga-rsv-actions"><button class="ga-btn secondary" type="button" onclick="guestArrivalReservationOpenDetail(\''+r.id+'\')">Detail</button>'+(r.status==='Menunggu Reservasi'?'<button class="ga-btn primary" type="button" onclick="guestArrivalReservationSeat(\''+r.id+'\')">Dudukkan tamu</button><button class="ga-btn danger" type="button" onclick="guestArrivalReservationCancel(\''+r.id+'\')">Batalkan</button>':r.guest_arrival_id?'<span class="ga-table-chip">Tercatat di Guest Arrival</span>':'')+'</div></div>' +
    '</div></article>').join('')+'</div>' : '<div class="ga-empty"><strong>Belum ada reservasi</strong>Tidak ada reservasi pada tanggal ini.</div>';
  return '<div class="ga-rsv-toolbar"><div><div class="ga-eyebrow">KALENDER RESERVASI</div><h3>'+gaEscape(gaReservationDateLabel(GA.reservationsMonth+'-01',{month:'long',year:'numeric'}))+'</h3><p class="ga-muted">Kapasitas tetap diatur staf secara manual.</p></div><div class="ga-rsv-month-nav"><button type="button" class="ga-btn secondary" aria-label="Bulan sebelumnya" onclick="guestArrivalReservationChangeMonth(-1)">‹</button><button type="button" class="ga-btn secondary" onclick="guestArrivalReservationThisMonth()">Hari ini</button><button type="button" class="ga-btn secondary" aria-label="Bulan berikutnya" onclick="guestArrivalReservationChangeMonth(1)">›</button></div></div>' +
    '<div class="ga-rsv-legend"><span><i class="waiting"></i> Menunggu</span><span><i class="seated"></i> Duduk</span><span><i class="cancelled"></i> Dibatalkan</span></div>' +
    '<div class="ga-rsv-calendar" role="group" aria-label="Kalender reservasi bulanan">'+cells+'</div>' +
    '<div class="ga-rsv-detail-head"><div><h3>'+gaEscape(gaReservationDateLabel(GA.reservationsDate,{weekday:'long',day:'numeric',month:'long',year:'numeric'}))+'</h3><p class="ga-muted">'+selected.length+' reservasi</p></div><button type="button" class="ga-btn primary" onclick="guestArrivalReservationToggleForm(!GA.reservationFormOpen)">+ Reservasi</button></div>' +
    cards;
}
function guestArrivalReservationSelectDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  GA.reservationsDate = date;
  R();
}
async function guestArrivalReservationChangeMonth(delta) {
  const [year,month]=GA.reservationsMonth.split('-').map(Number);
  const d=new Date(Date.UTC(year,month-1+delta,1,12));
  GA.reservationsMonth=d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0');
  GA.reservationsDate=GA.reservationsMonth+'-01';
  GA.reservationFormOpen=false; GA.ready=false; R(); await guestArrivalRefresh(true);
}
async function guestArrivalReservationThisMonth() {
  GA.reservationsMonth=gaToday().slice(0,7); GA.reservationsDate=gaToday(); GA.reservationFormOpen=false;
  GA.ready=false; R(); await guestArrivalRefresh(true);
}
function guestArrivalReservationFormMarkup() {
  const today=gaToday();
  return '<form class="ga-rsv-form ga-rsv-form-modal" onsubmit="guestArrivalReservationCreate(event)">' +
    '<div class="ga-rsv-form-heading"><strong>Reservasi baru</strong><button type="button" class="ga-btn small secondary" onclick="guestArrivalReservationToggleForm(false)">Tutup</button></div>' +
    '<div class="ga-rsv-form-grid">' +
    '<label class="ga-field ga-rsv-name-field">Nama tamu<input id="ga-rsv-name" maxlength="120" required autocomplete="name" placeholder="Nama tamu"></label>' +
    '<label class="ga-field">Jumlah pack<input id="ga-rsv-packs" type="number" min="1" max="500" step="1" value="2" required></label>' +
    '<label class="ga-field">Tanggal reservasi<input id="ga-rsv-date" type="date" min="'+today+'" value="'+GA.reservationsDate+'" required></label>' +
    '<label class="ga-field">Jam reservasi<input id="ga-rsv-time" type="time" step="60" value="19:00" required></label>' +
    '<label class="ga-field">WhatsApp (opsional)<input id="ga-rsv-phone" inputmode="tel" maxlength="24" placeholder="08xxxxxxxxxx"></label>' +
    '<label class="ga-field">Preferensi smoking<select id="ga-rsv-smoking"><option value="Non Smoking">Non Smoking</option><option value="Smoking">Smoking</option></select></label>' +
    '<label class="ga-field ga-rsv-wide">Catatan (opsional)<textarea id="ga-rsv-note" maxlength="1000" rows="2" placeholder="Catatan untuk staf"></textarea></label>' +
    '</div><button id="ga-rsv-submit" class="ga-btn primary wide" type="submit" '+(GA.busy==='reservation-create'?'disabled':'')+'>'+(GA.busy==='reservation-create'?'Menyimpan…':'Simpan reservasi')+'</button></form>';
}
function guestArrivalReservationToggleForm(open) {
  GA.reservationFormOpen=!!open;
  if (!GA.reservationFormOpen) { closeM(); return; }
  if (GA.reservationsDate < gaToday()) GA.reservationsDate=gaToday();
  modal(guestArrivalReservationFormMarkup());
  const shell=document.querySelector('#m .md');
  if (shell) shell.classList.add('ga-rsv-modal-shell');
  const overlay=document.querySelector('#m .ov');
  if (overlay) overlay.onmousedown=(event)=>{if(event.target===overlay){GA.reservationFormOpen=false;closeM();}};
}
async function guestArrivalReservationCreate(event) {
  if (event) event.preventDefault();
  if (GA.busy) return;
  const name=document.getElementById('ga-rsv-name')?.value?.trim()||'';
  const packs=Number(document.getElementById('ga-rsv-packs')?.value);
  const date=document.getElementById('ga-rsv-date')?.value||'';
  const time=document.getElementById('ga-rsv-time')?.value||'';
  const phone=document.getElementById('ga-rsv-phone')?.value?.trim()||'';
  const smoking=document.getElementById('ga-rsv-smoking')?.value||'Non Smoking';
  const note=document.getElementById('ga-rsv-note')?.value?.trim()||'';
  if (!name || !Number.isInteger(packs) || packs<1 || packs>500 || !date || !time) {
    gaToast('Lengkapi nama, jumlah pack, tanggal, dan jam reservasi.','err'); return;
  }
  const at=new Date(date+'T'+time+':00+07:00');
  if (!Number.isFinite(at.getTime()) || at.getTime()<Date.now()-5*60*1000) {
    gaToast('Tanggal dan jam reservasi tidak boleh di masa lalu.','err'); return;
  }
  if (phone && !gaPhoneValid(phone)) { gaToast('Format WhatsApp tidak valid. Gunakan nomor Indonesia, contoh 08xxxxxxxxxx.','err'); return; }
  GA.busy='reservation-create';
  const submit=document.getElementById('ga-rsv-submit');
  if (submit) { submit.disabled=true; submit.textContent='Menyimpan…'; }
  try {
    await gaRpc('guest_reservation_create',{p_guest_name:name,p_whatsapp:phone,p_packs:packs,p_reservation_at:at.toISOString(),p_smoking_preference:smoking,p_note:note,...(await gaOutletParams())});
    GA.reservationsMonth=date.slice(0,7); GA.reservationsDate=date; GA.reservationFormOpen=false; GA.ready=false;
    gaToast('Reservasi berhasil disimpan.','ok');
    closeM();
    await guestArrivalRefresh(true);
  } catch(e) { GA.error=gaHumanError(e); gaToast('Reservasi gagal disimpan. '+GA.error,'err'); }
  finally {
    GA.busy='';
    const currentSubmit=document.getElementById('ga-rsv-submit');
    if (currentSubmit) { currentSubmit.disabled=false; currentSubmit.textContent='Simpan reservasi'; }
    R();
  }
}
function guestArrivalReservationOpenDetail(id) {
  const r=(GA.reservations||[]).find(item=>item.id===id);
  if (!r) return;
  const info=(label,value,wide)=>'<div class="ga-detail-item '+(wide?'ga-detail-wide':'')+'"><label>'+label+'</label><div>'+value+'</div></div>';
  const statusClass=r.status==='Duduk'?'seated':r.status==='Dibatalkan'?'cancelled':'waiting';
  modal('<h3 class="ga-modal-heading">Detail Reservasi</h3><p class="ga-modal-intro">'+gaEscape(r.reservation_code)+' · '+gaEscape(r.guest_name)+'</p>'+
    '<div class="ga-rsv-time-banner"><span class="ga-rsv-time-label">JAM RESERVASI</span><strong>'+gaEscape(gaReservationDateLabel(r.reservation_at,{hour:'2-digit',minute:'2-digit'}))+' WIB</strong></div>'+
    '<div class="ga-detail-grid">'+info('Status','<span class="ga-status '+statusClass+'">'+gaEscape(r.status)+'</span>')+
    info('Nama tamu',gaEscape(r.guest_name))+info('Tanggal reservasi',gaEscape(gaReservationDateLabel(r.reservation_at,{weekday:'long',day:'numeric',month:'long',year:'numeric'})),true)+
    info('Jumlah pack',gaEscape(r.packs)+' pack')+info('Preferensi smoking',gaEscape(r.smoking_preference||'Non Smoking'))+
    info('WhatsApp',r.whatsapp?gaPhoneMarkup(r.whatsapp):'—',true)+info('Catatan',r.note?gaEscape(r.note):'—',true)+
    (r.guest_arrival_id?info('Guest Arrival','Tercatat di Guest Arrival',true):'')+'</div>'+
    '<div class="ga-btn-row"><button type="button" class="ga-btn secondary" onclick="closeM()">Tutup</button></div>');
}
function guestArrivalReservationCancel(id) {
  const row=(GA.reservations||[]).find(r=>r.id===id);
  if (!row || row.status!=='Menunggu Reservasi' || GA.busy) return;
  modal('<h3 class="ga-modal-heading">Batalkan reservasi?</h3><p class="ga-modal-intro">'+gaEscape(row.reservation_code)+' · '+gaEscape(row.guest_name)+'<br>Reservasi akan ditandai sebagai dibatalkan.</p>'+
    '<div class="ga-field"><label for="ga-rsv-cancel-reason">Alasan pembatalan (opsional)</label><textarea id="ga-rsv-cancel-reason" maxlength="1000" rows="3" placeholder="Tulis alasan jika ada"></textarea></div>'+
    '<div class="ga-btn-row"><button type="button" class="ga-btn danger" onclick="guestArrivalReservationConfirmCancel(\''+id+'\')">Ya, batalkan</button><button type="button" class="ga-btn secondary" onclick="closeM()">Kembali</button></div>');
}
async function guestArrivalReservationConfirmCancel(id) {
  if (GA.busy) return;
  const row=(GA.reservations||[]).find(r=>r.id===id);
  if (!row || row.status!=='Menunggu Reservasi') { closeM(); return; }
  const reason=document.getElementById('ga-rsv-cancel-reason')?.value?.trim()||'';
  GA.busy='reservation-cancel'; R();
  try {
    await gaRpc('guest_reservation_cancel',{p_id:id,p_reason:reason,...(await gaOutletParams())});
    closeM(); gaToast('Reservasi dibatalkan.','ok'); GA.ready=false; await guestArrivalRefresh(true);
  } catch(e) { GA.error=gaHumanError(e); gaToast('Pembatalan gagal. '+GA.error,'err'); }
  finally { GA.busy=''; R(); }
}
function guestArrivalReservationSeat(id) {
  const row=(GA.reservations||[]).find(r=>r.id===id);
  if (!row || row.status!=='Menunggu Reservasi' || GA.busy) return;
  modal('<h3 class="ga-modal-heading">Dudukkan tamu reservasi?</h3><p class="ga-modal-intro">'+gaEscape(row.reservation_code)+' · '+gaEscape(row.guest_name)+'<br>Isi meja tujuan. Setelah dikonfirmasi, data tamu akan tercatat di Guest Arrival.</p>'+
    '<div class="ga-seating-highlight"><label for="ga-rsv-seat-table">NOMOR / NAMA MEJA *</label><input id="ga-rsv-seat-table" maxlength="80" autocomplete="off" placeholder="Contoh: Meja 05, VIP 2, Teras A"><div class="ga-muted">Wajib diisi · Maksimal 80 karakter</div></div>'+
    '<div class="ga-btn-row"><button type="button" class="ga-btn primary" onclick="guestArrivalReservationConfirmSeat(\''+id+'\')">Konfirmasi Duduk</button><button type="button" class="ga-btn secondary" onclick="closeM()">Batal</button></div>');
}
async function guestArrivalReservationConfirmSeat(id) {
  if (GA.busy) return;
  const row=(GA.reservations||[]).find(r=>r.id===id);
  if (!row || row.status!=='Menunggu Reservasi') { closeM(); return; }
  const table=document.getElementById('ga-rsv-seat-table')?.value?.trim()||'';
  if (!table) { gaToast('Nomor atau nama meja wajib diisi.','err'); document.getElementById('ga-rsv-seat-table')?.focus(); return; }
  if (table.length>80) { gaToast('Nomor atau nama meja maksimal 80 karakter.','err'); return; }
  GA.busy='reservation-seat'; R();
  try {
    await gaRpc('guest_reservation_seat',{p_id:id,p_table_name:table,...(await gaOutletParams())});
    closeM(); gaToast('Reservasi terhubung ke Guest Arrival.','ok'); GA.ready=false; await guestArrivalRefresh(true);
  } catch(e) { GA.error=gaHumanError(e); gaToast('Gagal memproses reservasi. '+GA.error,'err'); }
  finally { GA.busy=''; R(); }
}

function guestArrivalDashboardMarkup() {
  const d = GA.dashboard || {};
  const stats = [
    ['Total Pendaftaran', d.total_registrations || 0, 'tamu'], ['Total Pack Terdaftar', d.total_packs || 0, 'pack'],
    ['Tamu Selesai', d.completed_count || 0, 'tamu'], ['Tamu Menunggu', d.waiting_count || 0, 'tamu'],
    ['Tamu Dibatalkan', d.cancelled_count || 0, 'tamu'],
    ['Rata-rata Waiting Time', guestArrivalSecondsStat(d.avg_waiting_seconds), 'selesai menunggu'],
    ['Waiting Time Terlama', guestArrivalSecondsStat(d.longest_waiting_seconds), 'selesai menunggu']
  ];
  const monthly = Array.isArray(d.monthly) ? d.monthly : [];
  return '<div class="ga-dashboard-controls"><div class="ga-filters"><label class="ga-field">Dari tanggal<input type="date" value="' + gaEscape(GA.fromDate) + '" max="' + gaEscape(GA.toDate) + '" onchange="guestArrivalDashboardFilter(\'fromDate\',this.value)"></label><label class="ga-field">Sampai tanggal<input type="date" value="' + gaEscape(GA.toDate) + '" min="' + gaEscape(GA.fromDate) + '" onchange="guestArrivalDashboardFilter(\'toDate\',this.value)"></label></div><div class="ga-dashboard-actions"><label class="ga-field"><span>Periode</span><button class="ga-btn secondary" type="button" onclick="guestArrivalSetThisMonth()">Bulan ini</button></label><label class="ga-field"><span>Ekspor laporan</span><button type="button" class="ga-btn primary ga-export-btn" onclick="guestArrivalExport()" ' + (GA.busy==='export'?'disabled':'') + '>Ekspor Excel (.xlsx)</button></label></div></div>' +
    '<div class="ga-stat-grid">' + stats.map(s => '<div class="ga-stat"><label>' + gaEscape(s[0]) + '</label><strong>' + gaEscape(s[1]) + '</strong><span class="ga-unit">' + gaEscape(s[2]) + '</span></div>').join('') + '</div>' +
    '<div class="ga-report-card"><h3>Rekap Bulanan</h3><p class="ga-muted">Mengikuti rentang tanggal yang dipilih.</p>' +
    (monthly.length ? '<div class="ga-month-list">' + monthly.map(m => '<div class="ga-month"><div><strong>' + gaEscape(m.month) + '</strong><div class="ga-muted">' + m.total_registrations + ' pendaftaran · ' + m.total_packs + ' pack</div></div><div style="text-align:right"><strong>' + m.completed_count + ' selesai</strong><div class="ga-muted">' + (m.seated_count || 0) + ' duduk · ' + m.waiting_count + ' menunggu · ' + m.cancelled_count + ' batal</div></div></div>').join('') + '</div>' : '<div class="ga-empty">Belum ada data pada periode ini.</div>') + '</div>';
}
async function guestArrivalDashboardFilter(key, value) {
  if (key !== 'fromDate' && key !== 'toDate') return;
  const old = GA[key]; GA[key] = value;
  if (GA.fromDate > GA.toDate) {
    GA[key] = old; gaToast('Tanggal mulai dan akhir tidak valid. Periksa kembali rentangnya.', 'err'); R(); return;
  }
  GA.ready = false; await guestArrivalRefresh();
}
function guestArrivalSetThisMonth() {
  GA.fromDate = gaToday().slice(0,7) + '-01'; GA.toDate = gaToday();
  GA.ready = false; guestArrivalRefresh();
}
function guestArrivalOpenForm() {
  GA.form = { name:'', packs:'1', whatsapp:'', smoking_preference:'Non Smoking', note:'', status:'Menunggu', table_name:'', requestId:gaUuid(), dirty:false, saving:false };
  guestArrivalShowForm();
}
function guestArrivalSyncKeyboardLayout() {
  const overlay = document.querySelector('#m .ov');
  if (!overlay || !overlay.querySelector('#ga-form-note')) return;
  const vv = window.visualViewport;
  const visualHeight = vv && vv.height ? vv.height : window.innerHeight;
  const active = document.activeElement;
  const editingField = !!(active && active.matches && active.matches('#ga-form-name,#ga-form-packs,#ga-form-wa,#ga-form-note,#ga-form-status,#ga-form-table-name'));
  const keyboardLikelyOpen = editingField && (window.innerHeight - visualHeight > 100 || (vv && vv.scale > 1.05));
  overlay.classList.toggle('ga-keyboard-open', keyboardLikelyOpen);
  overlay.style.setProperty('--ga-visual-height', Math.round(visualHeight) + 'px');
  if (keyboardLikelyOpen && active && active.id === 'ga-form-note') {
    requestAnimationFrame(() => {
      const currentOverlay = document.querySelector('#m .ov.ga-keyboard-open');
      const note = document.querySelector('#ga-form-note');
      if (!currentOverlay || !note) return;
      const r = note.getBoundingClientRect();
      const vh = window.visualViewport && window.visualViewport.height ? window.visualViewport.height : window.innerHeight;
      if (r.bottom > vh - 22 || r.top < 8) {
        note.scrollIntoView({ block: r.bottom > vh - 22 ? 'end' : 'start', behavior: 'smooth' });
      }
    });
  }
}
if (!window.__gaKeyboardLayoutBound) {
  window.__gaKeyboardLayoutBound = true;
  document.addEventListener('focusin', e => {
    if (e.target && e.target.matches && e.target.matches('#ga-form-name,#ga-form-packs,#ga-form-wa,#ga-form-note,#ga-form-status,#ga-form-table-name')) {
      setTimeout(guestArrivalSyncKeyboardLayout, 60);
      setTimeout(guestArrivalSyncKeyboardLayout, 240);
    }
  });
  document.addEventListener('focusout', () => setTimeout(guestArrivalSyncKeyboardLayout, 100));
  window.addEventListener('resize', guestArrivalSyncKeyboardLayout, {passive:true});
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', guestArrivalSyncKeyboardLayout, {passive:true});
    window.visualViewport.addEventListener('scroll', guestArrivalSyncKeyboardLayout, {passive:true});
  }
}

function guestArrivalFormInput(key, value) {
  if (!GA.form) return;
  GA.form[key] = value; GA.form.dirty = true;
  if (key === 'whatsapp') {
    const note = document.getElementById('ga-form-wa-note');
    if (note) note.textContent = value && !gaPhoneValid(value) ? 'Nomor tidak valid. Pendaftaran tetap boleh disimpan, tetapi tautan WhatsApp tidak akan aktif.' : 'Format lokal Indonesia, contoh 0812xxxxxxxx. Nomor tidak dikirim otomatis.';
  }
}
function guestArrivalSetInitialStatus(value) {
  if (!GA.form || !['Menunggu','Duduk'].includes(value) || GA.form.saving) return;
  GA.form.status = value;
  GA.form.dirty = true;
  guestArrivalShowForm();
}
function guestArrivalSetSmokingPreference(value) {
  if (!GA.form || !['Non Smoking','Smoking'].includes(value)) return;
  GA.form.smoking_preference = value;
  GA.form.dirty = true;
  document.querySelectorAll('.ga-preference-btn').forEach(button => {
    const active = button.dataset.preference === value;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}
function guestArrivalShowForm() {
  if (!GA.form) return;
  const f = GA.form;
  const preference = ['Non Smoking','Smoking'].includes(f.smoking_preference) ? f.smoking_preference : 'Non Smoking';
  modal('<h3 class="ga-modal-heading">Tambah Tamu</h3><p class="ga-modal-intro">Waktu kedatangan dicatat otomatis oleh server.</p>' +
    '<div class="ga-field"><label for="ga-form-name">Nama <span aria-hidden="true">*</span></label><input id="ga-form-name" autocomplete="name" maxlength="160" value="' + gaEscape(f.name) + '" placeholder="Nama tamu" oninput="guestArrivalFormInput(\'name\',this.value)" required></div>' +
    '<div class="ga-field ga-form-tight"><label for="ga-form-packs">Jumlah Pack <span aria-hidden="true">*</span></label><input id="ga-form-packs" type="number" min="1" step="1" inputmode="numeric" value="' + gaEscape(f.packs) + '" oninput="guestArrivalFormInput(\'packs\',this.value)" required></div>' +
    '<div class="ga-field ga-form-tight ga-wa-field"><label for="ga-form-wa">Nomor WhatsApp (opsional)</label><input id="ga-form-wa" type="tel" inputmode="tel" autocomplete="tel" maxlength="40" value="' + gaEscape(f.whatsapp) + '" placeholder="0812xxxxxxxx" oninput="guestArrivalFormInput(\'whatsapp\',this.value)"><span id="ga-form-wa-note" class="ga-muted ga-wa-help">' + (f.whatsapp && !gaPhoneValid(f.whatsapp) ? 'Nomor tidak valid. Pendaftaran tetap boleh disimpan, tetapi tautan WhatsApp tidak akan aktif.' : 'Format lokal Indonesia, contoh 0812xxxxxxxx. Nomor tidak dikirim otomatis.') + '</span></div>' +
    '<div class="ga-preference-grid" role="group" aria-label="Preferensi smoking">' +
      '<button type="button" class="ga-preference-btn' + (preference==='Non Smoking'?' active':'') + '" data-preference="Non Smoking" aria-pressed="' + (preference==='Non Smoking'?'true':'false') + '" onclick="guestArrivalSetSmokingPreference(this.dataset.preference)">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M5.6 5.6 18.4 18.4M7 13h8m2 0h1m-1 0v3H7v-3"></path></svg><span>Non Smoking</span></button>' +
      '<button type="button" class="ga-preference-btn' + (preference==='Smoking'?' active':'') + '" data-preference="Smoking" aria-pressed="' + (preference==='Smoking'?'true':'false') + '" onclick="guestArrivalSetSmokingPreference(this.dataset.preference)">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 15h18v4H3zM19 15V9m0 0c-2 0-3-1.5-2.2-3M14 15v-3m0 0c-2 0-3-1.5-2.2-3"></path></svg><span>Smoking</span></button>' +
    '</div>' +
    '<div class="ga-field ga-note-field"><label for="ga-form-note">Note (opsional)</label><textarea id="ga-form-note" rows="2" maxlength="1000" placeholder="Catatan tambahan..." oninput="guestArrivalFormInput(\'note\',this.value)">' + gaEscape(f.note || '') + '</textarea></div>' +
    '<div class="ga-field ga-status-field"><label for="ga-form-status">Status awal</label><select id="ga-form-status" onchange="guestArrivalSetInitialStatus(this.value)" ' + (f.saving?'disabled':'') + '><option value="Menunggu" ' + (f.status==='Menunggu'?'selected':'') + '>Menunggu</option><option value="Duduk" ' + (f.status==='Duduk'?'selected':'') + '>Duduk</option></select></div>' +
    (f.status==='Duduk' ? '<div class="ga-seating-highlight"><label for="ga-form-table-name">NOMOR / NAMA MEJA *</label><input id="ga-form-table-name" maxlength="80" autocomplete="off" value="' + gaEscape(f.table_name || '') + '" placeholder="Contoh: Meja 05, VIP 2, Teras A" oninput="guestArrivalFormInput(\'table_name\',this.value)" ' + (f.saving?'disabled':'') + ' required><div style="font-size:11px;line-height:1.45;margin-top:8px">Wajib diisi. Seating time 2 jam 30 menit dimulai setelah pendaftaran disimpan.</div></div>' : '') +
    '<div class="ga-btn-row"><button id="ga-save-btn" class="ga-btn primary" style="flex:1" type="button" onclick="guestArrivalSaveForm()" ' + (f.saving?'disabled':'') + '>' + (f.saving?'<span class="ga-spinner"></span>Menyimpan…':'Simpan') + '</button><button class="ga-btn secondary" type="button" onclick="guestArrivalRequestCloseForm()" ' + (f.saving?'disabled':'') + '>Tutup</button></div>');
}
function guestArrivalRequestCloseForm() {
  if (!GA.form) { closeM(); return; }
  if (GA.form.saving) { gaToast('Penyimpanan sedang berjalan. Tunggu sampai selesai.', 'warn'); return; }
  if (!GA.form.dirty) { GA.form = null; closeM(); return; }
  modal('<h3 class="ga-modal-heading">Perubahan belum disimpan</h3><p class="ga-modal-intro">Input tamu belum tersimpan. Pilih tetap mengedit atau buang input.</p><div class="ga-btn-row"><button type="button" class="ga-btn primary" onclick="guestArrivalShowForm()">Tetap mengedit</button><button type="button" class="ga-btn danger" onclick="guestArrivalDiscardForm()">Buang perubahan</button></div>');
}
function guestArrivalDiscardForm() { GA.form = null; closeM(); }
async function guestArrivalSaveForm() {
  if (!GA.form || GA.form.saving) return;
  const f = GA.form, packs = Number(f.packs);
  if (!String(f.name || '').trim()) { gaToast('Nama tamu wajib diisi.', 'err'); return; }
  if (!Number.isInteger(packs) || packs < 1) { gaToast('Jumlah pack harus bilangan bulat minimal 1.', 'err'); return; }
  if (!['Menunggu','Duduk'].includes(f.status)) { gaToast('Status awal tidak valid.', 'err'); return; }
  const tableName = String(f.table_name || '').trim();
  if (f.status==='Duduk' && !tableName) { gaToast('Nomor atau nama meja wajib diisi untuk status Duduk.', 'err'); const input=document.getElementById('ga-form-table-name'); if(input) input.focus(); return; }
  if (f.status==='Duduk' && tableName.length>80) { gaToast('Nomor atau nama meja maksimal 80 karakter.', 'err'); return; }
  f.saving = true; guestArrivalShowForm();
  try {
    const result = await gaRpc('guest_arrival_create', {
      p_name:String(f.name).trim(), p_packs:packs,
      p_whatsapp:String(f.whatsapp || '').trim() || null,
      p_initial_status:f.status, p_request_id:f.requestId,
      p_smoking_preference:f.smoking_preference || 'Non Smoking',
      p_note:String(f.note || '').trim() || null,
      p_table_name:f.status==='Duduk' ? tableName : null,
      ...(await gaOutletParams())
    });
    const code = result && result.queue_code ? result.queue_code : 'WL';
    const startSeated = f.status==='Duduk';
    GA.form = null; closeM();
    gaToast('Tamu berhasil didaftarkan — ' + code + (startSeated ? ' · langsung berstatus Duduk' : ''), 'ok');
    GA.tab = 'queue'; GA.showSeated = startSeated; GA.search = ''; GA.ready = false; await guestArrivalRefresh();
  } catch (e) {
    f.saving = false; f.dirty = true; guestArrivalShowForm();
    gaToast('Pendaftaran belum dapat dipastikan tersimpan. Input dipertahankan; coba Simpan lagi agar server memeriksa permintaan yang sama. ' + gaHumanError(e), 'err');
  }
}
function guestArrivalOpenPendingModal() {
  GA.showPending = true; guestArrivalRenderPendingModal();
}
function guestArrivalClosePendingModal() {
  GA.showPending = false; closeM();
}
function guestArrivalRenderPendingModal() {
  const rows = GA.pending || [];
  modal('<h3 class="ga-modal-heading">Antrean Tertunda</h3><p class="ga-modal-intro">Tamu dari tanggal sebelumnya yang masih berstatus Menunggu. Nomor dan tanggal asal tetap dipertahankan.</p>' +
    (rows.length ? '<div class="ga-card-list">' + rows.map(g => guestArrivalCard(g,true)).join('') + '</div>' : '<div class="ga-empty"><strong>Tidak ada antrean tertunda</strong>Semua antrean dari hari sebelumnya sudah ditangani.</div>') +
    '<div class="ga-btn-row"><button type="button" class="ga-btn secondary wide" onclick="guestArrivalClosePendingModal()">Tutup</button></div>');
}
function guestArrivalOpenSeatModal(id) {
  const row = [...GA.queue, ...GA.pending].find(g => g.id === id);
  if (!row || row.status !== 'Menunggu') { gaToast('Tamu ini tidak lagi berstatus Menunggu. Muat ulang daftar terlebih dahulu.', 'warn'); return; }
  GA.seat = { id, queue_code:row.queue_code, guest_name:row.guest_name, table_name:'', dirty:false, saving:false };
  guestArrivalShowSeatModal();
}
function guestArrivalSeatInput(value) {
  if (!GA.seat || GA.seat.saving) return;
  GA.seat.table_name = value;
  GA.seat.dirty = true;
}
function guestArrivalShowSeatModal() {
  if (!GA.seat) return;
  const f = GA.seat;
  modal('<h3 class="ga-modal-heading">Konfirmasi Tamu Duduk</h3><p class="ga-modal-intro">' + gaEscape(f.queue_code) + ' · ' + gaEscape(f.guest_name) + '<br>Isi meja tempat tamu duduk. Status belum berubah sampai kamu menekan konfirmasi.</p>' +
    '<div class="ga-seating-highlight"><label for="ga-seat-table">NOMOR / NAMA MEJA *</label><input id="ga-seat-table" maxlength="80" autocomplete="off" value="' + gaEscape(f.table_name) + '" placeholder="Contoh: Meja 05, VIP 2, Teras A" oninput="guestArrivalSeatInput(this.value)" ' + (f.saving?'disabled':'') + '><div style="font-size:11px;line-height:1.45;margin-top:8px">Wajib diisi · Maksimal 80 karakter</div></div>' +
    '<div class="ga-btn-row"><button type="button" class="ga-btn primary" onclick="guestArrivalConfirmSeated()" ' + (f.saving?'disabled':'') + '>' + (f.saving?'<span class="ga-spinner"></span>Menyimpan…':'Konfirmasi Duduk') + '</button><button type="button" class="ga-btn secondary" onclick="guestArrivalCancelSeatModal()" ' + (f.saving?'disabled':'') + '>Batal</button></div>');
  const input = document.getElementById('ga-seat-table');
  if (input) input.value = f.table_name;
}
function guestArrivalCancelSeatModal() {
  if (GA.seat && GA.seat.saving) { gaToast('Konfirmasi duduk sedang disimpan. Tunggu sampai selesai.', 'warn'); return; }
  GA.seat = null; closeM();
}
async function guestArrivalConfirmSeated() {
  if (!GA.seat || GA.seat.saving || GA.busy) return;
  const f = GA.seat, tableName = String(f.table_name || '').trim();
  if (!tableName) { gaToast('Nomor atau nama meja wajib diisi.', 'err'); const input=document.getElementById('ga-seat-table'); if(input) input.focus(); return; }
  if (tableName.length > 80) { gaToast('Nomor atau nama meja maksimal 80 karakter.', 'err'); return; }
  f.table_name = tableName; f.saving = true; GA.busy = f.id;
  guestArrivalShowSeatModal();
  try {
    await gaRpc('guest_arrival_set_seated', { p_id:f.id, p_table_name:tableName, ...(await gaOutletParams()) });
    GA.seat = null; GA.busy = ''; closeM();
    gaToast('Tamu dipindahkan ke Tamu yang Telah Duduk · Meja ' + tableName, 'ok');
    GA.ready = false; await guestArrivalRefresh();
  } catch (e) {
    f.saving = false; GA.busy = ''; guestArrivalShowSeatModal();
    gaToast('Status Duduk belum berhasil disimpan. Input meja tetap dipertahankan. ' + gaHumanError(e), 'err');
  } finally { if (GA.busy === f.id) GA.busy = ''; }
}
async function guestArrivalFinishSeated(id) {
  if (GA.busy) return;
  const row = (GA.seated || []).find(g => g.id === id);
  if (!row || row.status !== 'Duduk') { gaToast('Tamu ini tidak lagi berstatus Duduk. Muat ulang daftar terlebih dahulu.', 'warn'); return; }
  modal('<h3 class="ga-modal-heading">Selesaikan pelayanan tamu?</h3><p class="ga-modal-intro">' + gaEscape(row.queue_code) + ' · ' + gaEscape(row.guest_name) + '<br>Meja: <strong>' + gaEscape(row.table_name || '—') + '</strong><br>Tamu akan dipindahkan ke Riwayat dengan status Selesai.</p>' +
    '<div class="ga-btn-row"><button type="button" class="ga-btn primary" onclick="guestArrivalConfirmFinishSeated(\'' + id + '\')">Ya, selesai</button><button type="button" class="ga-btn secondary" onclick="closeM()">Kembali</button></div>');
}
async function guestArrivalConfirmFinishSeated(id) {
  if (GA.busy) return;
  GA.busy = id; closeM();
  try {
    await gaRpc('guest_arrival_finish_seated', { p_id:id, ...(await gaOutletParams()) });
    gaToast('Pelayanan selesai. Tamu masuk ke Riwayat.', 'ok');
    GA.ready = false; await guestArrivalRefresh();
  } catch (e) {
    gaToast('Status Selesai belum berhasil disimpan. ' + gaHumanError(e), 'err');
  } finally { GA.busy = ''; }
}
async function guestArrivalSetStatus(id, status) {
  if (!['Selesai','Batalkan'].includes(status)) return;
  if (status === 'Batalkan') { guestArrivalCancel(id); return; }
  if (GA.busy) return;
  GA.busy = id;
  try {
    await gaRpc('guest_arrival_set_status', { p_id:id, p_status:status, p_reason:null, ...(await gaOutletParams()) });
    gaToast('Status antrean berhasil diubah menjadi Selesai.', 'ok');
    GA.ready = false; await guestArrivalRefresh();
  } catch (e) {
    gaToast('Status belum berhasil diubah. ' + gaHumanError(e), 'err');
  } finally { GA.busy = ''; }
}
function guestArrivalCancel(id) {
  GA.cancelId = id; GA.cancelReason = '';
  const row = [...GA.queue,...GA.pending,...GA.history].find(g=>g.id===id);
  modal('<h3 class="ga-modal-heading">Batalkan antrean?</h3><p class="ga-modal-intro">Antrean ' + gaEscape(row ? row.queue_code : '') + ' akan berstatus Batalkan dan waiting time akan dihentikan. Tindakan ini tidak dapat dibalik lewat tombol biasa.</p>' +
    '<div class="ga-field"><label for="ga-cancel-reason">Alasan pembatalan (opsional)</label><textarea id="ga-cancel-reason" maxlength="1000" oninput="GA.cancelReason=this.value" placeholder="Tulis alasan jika ada"></textarea></div>' +
    '<div class="ga-btn-row"><button type="button" class="ga-btn danger" onclick="guestArrivalConfirmCancel()">Ya, batalkan</button><button type="button" class="ga-btn secondary" onclick="GA.cancelId=null;closeM()">Tidak</button></div>');
}
async function guestArrivalConfirmCancel() {
  if (!GA.cancelId || GA.busy) return;
  const id = GA.cancelId, reason = String(GA.cancelReason || '').trim() || null, wasPending = GA.showPending;
  GA.busy = id; closeM();
  try {
    await gaRpc('guest_arrival_set_status', { p_id:id, p_status:'Batalkan', p_reason:reason, ...(await gaOutletParams()) });
    gaToast('Antrean berhasil dibatalkan.', 'ok');
    GA.showPending = wasPending;
    GA.ready = false; await guestArrivalRefresh();
  } catch (e) { gaToast('Pembatalan belum berhasil. ' + gaHumanError(e), 'err'); }
  finally { GA.busy = ''; GA.cancelId = null; GA.cancelReason = ''; if (wasPending) { GA.showPending = true; guestArrivalRenderPendingModal(); } }
}
async function guestArrivalOpenDetail(id) {
  try { GA.detail = await gaRpc('guest_arrival_detail', { p_id:id, ...(await gaOutletParams()) }); guestArrivalShowDetail(); }
  catch (e) { gaToast('Detail tamu gagal dimuat. ' + gaHumanError(e), 'err'); }
}
function guestArrivalOpenMoveTable() {
  const g = GA.detail;
  if (!g || g.status !== 'Duduk') {
    gaToast('Pindah meja hanya tersedia untuk tamu yang sedang Duduk.', 'warn');
    return;
  }
  GA.tableMove = { id:g.id, queue_code:g.queue_code, guest_name:g.guest_name, old_table:g.table_name || '', table_name:'', dirty:false, saving:false };
  guestArrivalShowMoveTable();
}
function guestArrivalMoveTableInput(value) {
  if (!GA.tableMove || GA.tableMove.saving) return;
  GA.tableMove.table_name = value;
  GA.tableMove.dirty = true;
}
function guestArrivalShowMoveTable() {
  if (!GA.tableMove) return;
  const f = GA.tableMove;
  modal('<h3 class="ga-modal-heading">Pindah Meja Tamu</h3><p class="ga-modal-intro">' + gaEscape(f.queue_code) + ' · ' + gaEscape(f.guest_name) + '<br>Pastikan meja tujuan benar sebelum konfirmasi.</p>' +
    '<div class="ga-move-table-panel"><div style="margin-bottom:13px"><label>MEJA SAAT INI</label><div class="ga-table-value">' + gaEscape(f.old_table || '—') + '</div></div>' +
    '<label for="ga-move-table-input">PINDAH KE MEJA *</label><input id="ga-move-table-input" maxlength="80" autocomplete="off" value="' + gaEscape(f.table_name) + '" placeholder="Contoh: Meja 05, VIP 2, Teras A" oninput="guestArrivalMoveTableInput(this.value)" ' + (f.saving?'disabled':'') + '>' +
    '<div style="font-size:11px;line-height:1.45;margin-top:8px">Wajib diisi · Maksimal 80 karakter</div></div>' +
    '<div class="ga-btn-row"><button type="button" class="ga-btn primary" onclick="guestArrivalConfirmMoveTable()" ' + (f.saving?'disabled':'') + '>' + (f.saving?'<span class="ga-spinner"></span>Menyimpan…':'Konfirmasi Pindah Meja') + '</button><button type="button" class="ga-btn secondary" onclick="guestArrivalCancelMoveTable()" ' + (f.saving?'disabled':'') + '>Kembali</button></div>');
  const input=document.getElementById('ga-move-table-input');
  if(input) input.value=f.table_name;
}
function guestArrivalCancelMoveTable() {
  if (GA.tableMove && GA.tableMove.saving) {
    gaToast('Perpindahan meja sedang disimpan. Tunggu sampai selesai.', 'warn');
    return;
  }
  GA.tableMove=null;
  guestArrivalShowDetail();
}
async function guestArrivalConfirmMoveTable() {
  if (!GA.tableMove || GA.tableMove.saving || GA.busy) return;
  const f=GA.tableMove, tableName=String(f.table_name||'').trim();
  if(!tableName) {
    gaToast('Nomor atau nama meja baru wajib diisi.','err');
    const input=document.getElementById('ga-move-table-input'); if(input) input.focus();
    return;
  }
  if(tableName.length>80) { gaToast('Nomor atau nama meja maksimal 80 karakter.','err'); return; }
  if(tableName===String(f.old_table||'').trim()) { gaToast('Meja baru harus berbeda dari meja saat ini.','err'); return; }
  f.table_name=tableName; f.saving=true; GA.busy=f.id;
  guestArrivalShowMoveTable();
  try {
    await gaRpc('guest_arrival_move_table',{p_id:f.id,p_table_name:tableName,...(await gaOutletParams())});
    const id=f.id;
    GA.tableMove=null; GA.busy='';
    gaToast('Meja berhasil dipindahkan ke ' + tableName + '.','ok');
    GA.ready=false;
    await guestArrivalRefresh();
    GA.detail=await gaRpc('guest_arrival_detail',{p_id:id,...(await gaOutletParams())});
    guestArrivalShowDetail();
  } catch(e) {
    if(GA.tableMove) { GA.tableMove.saving=false; guestArrivalShowMoveTable(); }
    GA.busy='';
    gaToast('Pindah meja belum berhasil disimpan. ' + gaHumanError(e),'err');
  } finally {
    if(GA.busy===f.id) GA.busy='';
  }
}
function gaChangeValue(key,value) {
  if (value === null || value === undefined || value === '') return '—';
  if (key === 'arrived_at' || key === 'seated_at' || key === 'finished_at') return gaFormatDateTime(value);
  if (key === 'operational_date') return gaFormatDate(value);
  if (key === 'waiting_seconds') return gaDuration(value);
  if (key === 'packs') return String(value) + ' pack';
  return String(value);
}
function gaChangeSummary(change) {
  const oldData = change && change.old_data && typeof change.old_data === 'object' ? change.old_data : {};
  const newData = change && change.new_data && typeof change.new_data === 'object' ? change.new_data : {};
  const fields = [
    ['guest_name','Nama'], ['status','Status'], ['table_name','Meja'], ['packs','Jumlah pack'],
    ['whatsapp','WhatsApp'], ['smoking_preference','Preferensi'], ['note','Catatan'],
    ['arrived_at','Waktu kedatangan'], ['seated_at','Waktu duduk'], ['finished_at','Waktu akhir'],
    ['operational_date','Tanggal antrean'], ['waiting_seconds','Waiting Time'], ['cancellation_reason','Alasan pembatalan']
  ];
  const rows = fields.filter(([key]) => (oldData[key] == null ? null : oldData[key]) !== (newData[key] == null ? null : newData[key]))
    .map(([key,label]) => '<div class="ga-change-field"><strong>' + label + ':</strong><span>' +
      gaEscape(gaChangeValue(key,oldData[key])) + ' → ' + gaEscape(gaChangeValue(key,newData[key])) + '</span></div>').join('');
  return rows ? '<div class="ga-change-fields">' + rows + '</div>' :
    '<div class="ga-change-empty">Tidak ada perubahan yang perlu ditampilkan.</div>';
}
function gaTableRoute(changes,currentTable) {
  const tableChanges = (Array.isArray(changes) ? changes : []).filter(c => {
    const oldData = c && c.old_data && typeof c.old_data === 'object' ? c.old_data : {};
    const newData = c && c.new_data && typeof c.new_data === 'object' ? c.new_data : {};
    return String(oldData.table_name || '').trim() !== String(newData.table_name || '').trim();
  }).slice().sort((a,b) => (Date.parse(a.changed_at || '') || 0) - (Date.parse(b.changed_at || '') || 0));
  const route = [];
  tableChanges.forEach(c => {
    const oldData = c.old_data || {}, newData = c.new_data || {};
    const before = String(oldData.table_name || '').trim(), after = String(newData.table_name || '').trim();
    if (before && route[route.length - 1] !== before) route.push(before);
    if (after && route[route.length - 1] !== after) route.push(after);
  });
  const current = String(currentTable || '').trim();
  if (current && (!route.length || route[route.length - 1] !== current)) route.push(current);
  return route;
}
function gaTableRouteMarkup(route) {
  if (!Array.isArray(route) || !route.length) return '<span class="ga-muted">—</span>';
  return '<div class="ga-table-route">' + route.map((table,index) =>
    (index ? '<span class="ga-table-route-arrow" aria-hidden="true">→</span>' : '') +
    '<span class="ga-table-value">' + gaEscape(table) + '</span>').join('') + '</div>';
}
function guestArrivalShowDetail() {
  const g = GA.detail; if (!g) return;
  const changes = Array.isArray(g.changes) ? g.changes : [];
  const tableRoute = gaTableRoute(changes,g.table_name);
  const info = (label,value,wide) => '<div class="ga-detail-item ' + (wide?'ga-detail-wide':'') + '"><label>' + gaEscape(label) + '</label><div>' + value + '</div></div>';
  modal('<h3 class="ga-modal-heading">' + gaEscape(g.queue_code) + ' · ' + gaEscape(g.guest_name) + '</h3><p class="ga-modal-intro">Detail pendaftaran tamu. Koreksi data tidak dapat mengubah status atau waktu kedatangan.</p>' +
    '<div class="ga-detail-grid">' +
    info('Nomor antrean',gaEscape(g.queue_code)) + (g.reservation_code ? info('Kode reservasi',gaEscape(g.reservation_code)) : '') + info('Status',gaStatusBadge(g.status)) +
    (tableRoute.length ? info('Meja',gaTableRouteMarkup(tableRoute),true) : '') +
    (g.seated_at ? info('Waktu duduk',gaEscape(gaFormatDateTime(g.seated_at))) : '') +
    info('Jumlah pack',gaEscape(g.packs)+' pack') + info('WhatsApp',gaPhoneMarkup(g.whatsapp)) +
    info('Preferensi',gaEscape(g.smoking_preference || 'Non Smoking')) +
    info('Tanggal antrean',gaEscape(gaFormatDate(g.operational_date))) + info('Waktu kedatangan',gaEscape(gaFormatDateTime(g.arrived_at))) +
    info('Waktu akhir',gaEscape(g.finished_at ? gaFormatDateTime(g.finished_at) : (g.status==='Duduk' ? 'Masih duduk' : 'Belum selesai menunggu'))) +
    info('Waiting Time',gaEscape(gaDuration(gaWaitSeconds(g)))) +
    info('Didaftarkan oleh',gaEscape(g.created_by_email || '—')) +
    (g.note ? info('Note',gaEscape(g.note),true) : '') +
    (g.cancellation_reason ? info('Alasan pembatalan',gaEscape(g.cancellation_reason),true) : '') +
    (Number(g.correction_count || 0) ? info('Koreksi',Number(g.correction_count)+' kali · terakhir '+gaEscape(g.last_correction_at?gaFormatDateTime(g.last_correction_at):'—'),true) : '') +
    '</div><details style="margin-top:15px"><summary style="cursor:pointer;font-weight:750">Riwayat Perubahan (' + changes.length + ')</summary>' +
    (changes.length ? '<div class="ga-change-list">' + changes.map(c => {
      const changeTitle = c.change_type==='CORRECTION' ? 'Koreksi data' : c.change_type==='TABLE_MOVE' ? 'Pindah meja' : 'Perubahan status';
      return '<div class="ga-change"><strong>' + changeTitle + '</strong><div class="ga-muted">' + gaEscape(gaFormatDateTime(c.changed_at)) + ' · ' + gaEscape(c.actor_email || '—') + '</div>' +
        (c.reason ? '<div>Alasan: ' + gaEscape(c.reason) + '</div>' : '') + gaChangeSummary(c) + '</div>';
    }).join('') : '<div class="ga-inline-summary">Belum ada perubahan data</div>') +
    '</details><div class="ga-btn-row">' +
    (g.status==='Duduk' ? '<button type="button" class="ga-btn primary" onclick="guestArrivalOpenMoveTable()">Pindah meja</button>' : '') +
    '<button type="button" class="ga-btn primary" onclick="guestArrivalOpenEdit()">Edit data</button><button type="button" class="ga-btn secondary" onclick="closeM()">Tutup</button></div>');
}
function guestArrivalOpenEdit() {
  if (!GA.detail) return;
  const g = GA.detail;
  GA.edit = { id:g.id, name:g.guest_name || '', packs:String(g.packs||1), whatsapp:g.whatsapp||'', reason:'', dirty:false, saving:false };
  guestArrivalShowEdit();
}
function guestArrivalEditInput(key,value) {
  if (!GA.edit) return;
  GA.edit[key] = value; GA.edit.dirty = true;
  if (key==='whatsapp') {
    const node=document.getElementById('ga-edit-wa-note');
    if (node) node.textContent=value&&!gaPhoneValid(value)?'Nomor tidak valid; koreksi tetap boleh disimpan.':'Format lokal Indonesia, contoh 0812xxxxxxxx.';
  }
}
function guestArrivalShowEdit() {
  if (!GA.edit) return;
  const f=GA.edit;
  modal('<h3 class="ga-modal-heading">Koreksi Data Tamu</h3><p class="ga-modal-intro">Alasan koreksi wajib. Status dan waktu kedatangan tidak dapat diubah dari formulir ini.</p>' +
    '<div class="ga-field"><label for="ga-edit-name">Nama *</label><input id="ga-edit-name" maxlength="160" value="' + gaEscape(f.name) + '" oninput="guestArrivalEditInput(\'name\',this.value)" required></div>' +
    '<div class="ga-field" style="margin-top:11px"><label for="ga-edit-packs">Jumlah Pack *</label><input id="ga-edit-packs" type="number" min="1" step="1" inputmode="numeric" value="' + gaEscape(f.packs) + '" oninput="guestArrivalEditInput(\'packs\',this.value)" required></div>' +
    '<div class="ga-field" style="margin-top:11px"><label for="ga-edit-wa">WhatsApp (opsional)</label><input id="ga-edit-wa" type="tel" value="' + gaEscape(f.whatsapp) + '" maxlength="40" oninput="guestArrivalEditInput(\'whatsapp\',this.value)"><span id="ga-edit-wa-note" class="ga-muted">' + (f.whatsapp&&!gaPhoneValid(f.whatsapp)?'Nomor tidak valid; koreksi tetap boleh disimpan.':'Format lokal Indonesia, contoh 0812xxxxxxxx.') + '</span></div>' +
    '<div class="ga-field" style="margin-top:11px"><label for="ga-edit-reason">Alasan koreksi *</label><textarea id="ga-edit-reason" maxlength="1000" oninput="guestArrivalEditInput(\'reason\',this.value)" placeholder="Jelaskan alasan perubahan"></textarea></div>' +
    '<div class="ga-btn-row"><button type="button" id="ga-edit-save" class="ga-btn primary" onclick="guestArrivalSaveEdit()" ' + (f.saving?'disabled':'') + '>' + (f.saving?'Menyimpan…':'Simpan koreksi') + '</button><button type="button" class="ga-btn secondary" onclick="guestArrivalCancelEdit()" ' + (f.saving?'disabled':'') + '>Kembali</button></div>');
  const reason=document.getElementById('ga-edit-reason'); if(reason) reason.value=f.reason;
}
function guestArrivalCancelEdit() {
  if (GA.edit && GA.edit.saving) { gaToast('Penyimpanan koreksi sedang berjalan.', 'warn'); return; }
  if (GA.edit && GA.edit.dirty) {
    modal('<h3 class="ga-modal-heading">Koreksi belum disimpan</h3><p class="ga-modal-intro">Input koreksi akan dibuang jika kamu kembali ke detail.</p><div class="ga-btn-row"><button type="button" class="ga-btn primary" onclick="guestArrivalShowEdit()">Tetap mengedit</button><button type="button" class="ga-btn danger" onclick="GA.edit=null;guestArrivalShowDetail()">Buang koreksi</button></div>');
    return;
  }
  GA.edit=null; guestArrivalShowDetail();
}
async function guestArrivalSaveEdit() {
  if (!GA.edit || GA.edit.saving) return;
  const f=GA.edit, packs=Number(f.packs);
  if (!String(f.name||'').trim()) { gaToast('Nama tamu wajib diisi.','err'); return; }
  if (!Number.isInteger(packs)||packs<1) { gaToast('Jumlah pack harus bilangan bulat minimal 1.','err'); return; }
  if (!String(f.reason||'').trim()) { gaToast('Alasan koreksi wajib diisi.','err'); return; }
  f.saving=true; guestArrivalShowEdit();
  const reasonNode=document.getElementById('ga-edit-reason'); if(reasonNode) reasonNode.value=f.reason;
  try {
    await gaRpc('guest_arrival_correct',{p_id:f.id,p_name:String(f.name).trim(),p_packs:packs,p_whatsapp:String(f.whatsapp||'').trim()||null,p_reason:String(f.reason).trim(),...(await gaOutletParams())});
    gaToast('Koreksi tersimpan dan tercatat di Riwayat Perubahan.','ok');
    const id=f.id; GA.edit=null;
    GA.detail=await gaRpc('guest_arrival_detail',{p_id:id,...(await gaOutletParams())});
    GA.ready=false; await guestArrivalRefresh(); guestArrivalShowDetail();
  } catch(e) {
    f.saving=false; guestArrivalShowEdit();
    gaToast('Koreksi gagal disimpan. Input tetap dipertahankan. '+gaHumanError(e),'err');
  }
}
function guestArrivalHasUnsaved() {
  return !!((GA.form && GA.form.dirty && !GA.form.saving) || (GA.edit && GA.edit.dirty && !GA.edit.saving) || (GA.seat && GA.seat.dirty && !GA.seat.saving) || (GA.tableMove && GA.tableMove.dirty && !GA.tableMove.saving));
}
window.guestArrivalHandleNavigation = function(nextPage) {
  if (!guestArrivalHasUnsaved()) return true;
  modal('<h3 class="ga-modal-heading">Perubahan belum disimpan</h3><p class="ga-modal-intro">Ada input yang belum tersimpan. Pilih tetap mengedit atau tinggalkan halaman dan buang perubahan.</p><div class="ga-btn-row"><button type="button" class="ga-btn primary" onclick="guestArrivalResumeEditing()">Tetap mengedit</button><button type="button" class="ga-btn danger" onclick="guestArrivalDiscardAndNavigate(\'' + gaEscape(nextPage) + '\')">Tinggalkan halaman</button></div>');
  return false;
};
function guestArrivalResumeEditing() { if (GA.tableMove) guestArrivalShowMoveTable(); else if (GA.seat) guestArrivalShowSeatModal(); else if (GA.edit) guestArrivalShowEdit(); else if (GA.form) guestArrivalShowForm(); }
function guestArrivalDiscardAndNavigate(nextPage) {
  GA.form=null; GA.edit=null; GA.seat=null; GA.tableMove=null; closeM(); pg=nextPage; R();
}
window.addEventListener('beforeunload', function(e) {
  if (D && D.me && (D.me.r==='G'||pg==='guest_arrival') && guestArrivalHasUnsaved()) { e.preventDefault(); e.returnValue=''; }
});
async function guestArrivalExport() {
  if (GA.busy) return;
  if (typeof XLSX==='undefined'||!XLSX.utils) { gaToast('Library Excel belum tersedia. Muat ulang halaman dan coba lagi.','err'); return; }
  GA.busy='export'; R();
  try {
    const data=await gaRpc('guest_arrival_export',{p_from:GA.fromDate,p_to:GA.toDate,...(await gaOutletParams())});
    const details=Array.isArray(data.details)?data.details:[], cancellations=Array.isArray(data.cancellations)?data.cancellations:[], summary=data.summary||{};
    const columns=[['Tanggal Operasional','operational_date'],['Nomor Antrean','queue_code'],['Nama Tamu','guest_name'],['Jumlah Pack','packs'],['WhatsApp','whatsapp'],['Preferensi','smoking_preference'],['Note','note'],['Waktu Kedatangan','arrived_at'],['Status','status'],['Meja','table_name'],['Waktu Duduk','seated_at'],['Waktu Akhir','finished_at'],['Waiting Time (detik)','waiting_seconds'],['Alasan Pembatalan','cancellation_reason'],['Jumlah Koreksi','correction_count'],['Koreksi Terakhir','last_correction_at'],['Alasan Koreksi Terakhir','last_correction_reason'],['Didaftarkan Oleh','created_by_email']];
    const makeRows=rows=>[columns.map(x=>x[0]),...rows.map(g=>columns.map(([label,key])=>g[key]==null?'':g[key]))];
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(makeRows(details)),'Detail Tamu');
    XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(makeRows(cancellations)),'Pembatalan');
    const summaryRows=[['Ringkasan Guest Arrival','Nilai'],['Dari tanggal',GA.fromDate],['Sampai tanggal',GA.toDate],['Total Pendaftaran',summary.total_registrations||0],['Total Pack Terdaftar',summary.total_packs||0],['Tamu Selesai',summary.completed_count||0],['Tamu Menunggu',summary.waiting_count||0],['Tamu Duduk',summary.seated_count||0],['Tamu Dibatalkan',summary.cancelled_count||0],['Pack Selesai',summary.completed_packs||0],['Pack Menunggu',summary.waiting_packs||0],['Pack Duduk',summary.seated_packs||0],['Pack Dibatalkan',summary.cancelled_packs||0],['Rata-rata Waiting Time (detik)',summary.avg_waiting_seconds||0],['Waiting Time Terlama (detik)',summary.longest_waiting_seconds||0],[],['Rekap Bulanan','Total Pendaftaran','Total Pack','Selesai','Menunggu','Duduk','Dibatalkan','Pack Selesai','Pack Menunggu','Pack Duduk','Pack Dibatalkan']];
    (summary.monthly||[]).forEach(m=>summaryRows.push([m.month,m.total_registrations,m.total_packs,m.completed_count,m.waiting_count,m.seated_count||0,m.cancelled_count,m.completed_packs,m.waiting_packs,m.seated_packs||0,m.cancelled_packs]));
    XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(summaryRows),'Ringkasan');
    XLSX.writeFile(wb,'Guest-Arrival-'+GA.fromDate+'-sd-'+GA.toDate+'.xlsx');
    gaToast('Ekspor Excel berhasil dibuat.','ok');
  } catch(e) { gaToast('Ekspor gagal. '+gaHumanError(e),'err'); }
  finally { GA.busy=''; R(); }
}
window.guestArrivalResetSession = function() {
  const today = gaToday();
  GA.tab='queue'; GA.ready=false; GA.loading=false; GA.error='';
  GA.reservationsMonth=today.slice(0,7); GA.reservationsDate=today; GA.reservations=[]; GA.reservationFormOpen=false;
  GA.queue=[]; GA.pending=[]; GA.seated=[]; GA.history=[]; GA.search=''; GA.showSeated=false; GA.seat=null;
  GA.historyDate=today; GA.lastOperationalDate=today;
  GA.fromDate=today.slice(0,7)+'-01'; GA.toDate=today;
  GA.dashboard=null; GA.context=null; GA.busy='';
  GA.form=null; GA.edit=null; GA.detail=null; GA.seat=null; GA.tableMove=null;
  GA.cancelId=null; GA.cancelReason=''; GA.showPending=false; GA.serverOffsetMs=0;
};
if (typeof window.__barappRegisterViews === 'function') {
  window.__barappRegisterViews({guest_arrival: () => guestArrivalRender()});
} else {
  window.__barappPendingViews = window.__barappPendingViews || {};
  window.__barappPendingViews.guest_arrival = () => guestArrivalRender();
}
if (window.__barappRefreshUI) window.__barappRefreshUI();
setInterval(() => {
  if (!D || !D.me || pg!=='guest_arrival') return;
  const today = gaToday();
  if (today !== GA.lastOperationalDate && !GA.loading) {
    GA.lastOperationalDate = today;
    if (GA.tab === 'queue') { GA.ready = false; guestArrivalRefresh(true); }
  }
  document.querySelectorAll('[data-ga-wait-id]').forEach(node => {
    const id=node.getAttribute('data-ga-wait-id'), row=[...GA.queue,...GA.pending,...GA.history].find(g=>g.id===id);
    if (row) node.textContent=gaDuration(gaWaitSeconds(row));
  });
  document.querySelectorAll('[data-ga-sitting-id]').forEach(node => {
    const id=node.getAttribute('data-ga-sitting-id'), row=(GA.seated||[]).find(g=>g.id===id);
    if (row) {
      node.textContent=gaSittingCountdown(row);
      const chip=node.closest('.ga-sitting-chip');
      if (chip) chip.classList.toggle('expired',gaSittingRemaining(row)<=0);
    }
  });
},1000);
