/* Guest Arrival & Waiting List — Barapp module */
const GA = {
  tab: 'queue', ready: false, loading: false, error: '',
  queue: [], pending: [], history: [],
  historyDate: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date()),
  lastOperationalDate: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date()),
  search: '',
  fromDate: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date()).slice(0, 7) + '-01',
  toDate: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date()),
  dashboard: null, busy: '', form: null, edit: null, detail: null,
  cancelId: null, cancelReason: '', showPending: false, serverOffsetMs: 0
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
const gaUuid = () => {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
};
const gaStatusClass = (s) => s === 'Selesai' ? 'done' : s === 'Batalkan' ? 'cancelled' : 'waiting';
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
const gaRefreshLists = async () => {
  const [queue, pending] = await Promise.all([
    gaRpc('guest_arrival_list', { p_scope:'today', p_date:GA.historyDate }),
    gaRpc('guest_arrival_list', { p_scope:'pending', p_date:GA.historyDate })
  ]);
  GA.queue = Array.isArray(queue) ? queue : [];
  GA.pending = Array.isArray(pending) ? pending : [];
  gaCaptureServerTime(GA.queue.concat(GA.pending));
};
async function guestArrivalRefresh(silent) {
  if (T.dbRole !== 'guest_arrival' && !isDeveloper()) return;
  if (GA.loading) return;
  GA.loading = true; GA.error = '';
  if (!silent) R();
  try {
    if (GA.tab === 'queue') await gaRefreshLists();
    else if (GA.tab === 'history') {
      const rows = await gaRpc('guest_arrival_list', { p_scope:'history', p_date:GA.historyDate });
      GA.history = Array.isArray(rows) ? rows : [];
      gaCaptureServerTime(GA.history);
    } else if (GA.tab === 'dashboard') {
      if (GA.fromDate > GA.toDate) throw new Error('Tanggal mulai harus sebelum atau sama dengan tanggal akhir.');
      GA.dashboard = await gaRpc('guest_arrival_dashboard', { p_from:GA.fromDate, p_to:GA.toDate });
    }
    GA.ready = true;
  } catch (e) {
    GA.error = gaHumanError(e);
    if (typeof console !== 'undefined') console.error('Guest Arrival:', e);
  } finally {
    GA.loading = false;
    R();
    if (GA.showPending && document.querySelector('#m .ov')) guestArrivalRenderPendingModal();
    else if (!document.querySelector('#m .ov')) GA.showPending = false;
  }
}
function guestArrivalSetTab(tab) {
  if (!['queue','dashboard','history'].includes(tab)) return;
  GA.tab = tab; GA.ready = false; GA.error = ''; GA.search = '';
  R(); guestArrivalRefresh();
}
function guestArrivalRender() {
  if (!GA.ready && !GA.loading) setTimeout(() => guestArrivalRefresh(), 0);
  const tabs = [['queue','Antrean Hari Ini'],['dashboard','Dashboard'],['history','Riwayat']];
  return '<style>' + gaCss + '</style><section class="ga-wrap">' +
    '<div class="ga-heading"><div><div class="ga-eyebrow">GUEST ARRIVAL</div><h2>Guest Arrival &amp; Waiting List</h2><p class="ga-muted">Kelola kedatangan tamu dan waktu tunggu.</p></div><span class="ga-date-pill">' + gaEscape(gaFormatDate(gaToday())) + ' WIB</span></div>' +
    '<div class="ga-tabs" role="tablist">' + tabs.map(([key,title]) => '<button type="button" class="ga-tab ' + (GA.tab===key?'active':'') + '" aria-selected="' + (GA.tab===key?'true':'false') + '" onclick="guestArrivalSetTab(\'' + key + '\')">' + title + '</button>').join('') + '</div>' +
    (GA.error ? '<div class="ga-error" role="alert"><strong>Data belum berhasil dimuat.</strong><span>' + gaEscape(GA.error) + '</span><button type="button" class="ga-btn secondary" onclick="guestArrivalRefresh()">Coba lagi</button></div>' : '') +
    (GA.loading ? '<div class="ga-load"><span class="ga-spinner"></span><span>Memuat data dari server…</span></div>' : GA.tab==='queue' ? guestArrivalQueueMarkup() : GA.tab==='history' ? guestArrivalHistoryMarkup() : guestArrivalDashboardMarkup()) +
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
.ga-card{border:1px solid var(--br,#d7dfd3);border-radius:15px;padding:13px;background:var(--cd,#fff);box-shadow:0 2px 7px rgba(30,50,35,.04);min-width:0}
.ga-card-top{display:flex;justify-content:space-between;align-items:flex-start;gap:10px}
.ga-queue-code{font-size:18px;font-weight:850;letter-spacing:.01em;line-height:1.2}
.ga-name{font-size:15px;font-weight:800;overflow-wrap:anywhere;margin:5px 0}
.ga-card-meta{display:flex;flex-wrap:wrap;gap:6px 12px;font-size:12px;margin-top:9px;align-items:center}
.ga-wait{display:inline-flex;align-items:center;gap:5px;padding:5px 8px;background:var(--tint,rgba(100,140,95,.13));border-radius:9px;font-variant-numeric:tabular-nums;font-size:12px;font-weight:800}
.ga-status{display:inline-flex;align-items:center;padding:5px 8px;border-radius:999px;font-size:10px;font-weight:800;white-space:nowrap}
.ga-status.waiting{background:#fff3d5;color:#825b00}
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
.ga-change pre{font-family:inherit;white-space:pre-wrap;overflow-wrap:anywhere;background:var(--tint,rgba(100,140,95,.13));padding:8px;border-radius:8px;margin:6px 0}
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
`;
function guestArrivalQueueMarkup() {
  return '<div class="ga-actions"><button type="button" class="ga-btn primary" onclick="guestArrivalOpenForm()">＋ Tambah Tamu</button><button type="button" class="ga-btn secondary" onclick="guestArrivalOpenPendingModal()">Tertunda (' + GA.pending.length + ')</button></div>' +
    '<div class="ga-section-title"><h3>Tamu Menunggu</h3><span class="ga-count">' + GA.queue.length + ' antrean aktif</span></div><div id="ga-queue-cards" class="ga-card-list">' + guestArrivalQueueCards() + '</div>';
}
function guestArrivalCard(g, pending) {
  const detail = '<button type="button" class="ga-btn secondary small" onclick="guestArrivalOpenDetail(\'' + g.id + '\')">Detail</button>';
  const actions = g.status === 'Menunggu'
    ? '<button type="button" class="ga-btn primary small" onclick="guestArrivalSetStatus(\'' + g.id + '\',\'Selesai\')">Selesai</button><button type="button" class="ga-btn danger small" onclick="guestArrivalCancel(\'' + g.id + '\')">Batalkan</button>'
    : '';
  return '<article class="ga-card"><div class="ga-card-top"><div><div class="ga-queue-code">' + gaEscape(g.queue_code || ('WL-' + String(g.queue_number).padStart(3,'0'))) + '</div><div class="ga-name">' + gaEscape(g.guest_name) + '</div></div>' + gaStatusBadge(g.status) + '</div>' +
    '<div class="ga-card-meta"><span>' + Number(g.packs || 0) + ' pack</span>' + (g.whatsapp ? '<span>' + gaPhoneMarkup(g.whatsapp) + '</span>' : '') + '<span class="ga-wait">Waiting <span class="ga-wait-time" data-ga-wait-id="' + gaEscape(g.id) + '">' + gaDuration(gaWaitSeconds(g)) + '</span></span></div>' +
    '<div class="ga-inline-summary">Datang ' + gaEscape(gaFormatDateTime(g.arrived_at)) + (pending ? ' · ' + gaEscape(gaFormatDate(g.operational_date)) : '') + '</div><div class="ga-card-actions">' + detail + actions + '</div></article>';
}
function guestArrivalQueueCards() {
  return GA.queue.length ? GA.queue.map(g => guestArrivalCard(g,false)).join('') : '<div class="ga-empty"><strong>Belum ada tamu menunggu</strong>Antrean baru akan muncul setelah tamu didaftarkan.</div>';
}
function guestArrivalRenderQueueCards() {
  const node = document.getElementById('ga-queue-cards');
  if (node) node.innerHTML = guestArrivalQueueCards();
}
function guestArrivalHistoryMarkup() {
  return '<div class="ga-filters"><label class="ga-field">Tanggal riwayat<input type="date" value="' + gaEscape(GA.historyDate) + '" max="' + gaEscape(gaToday()) + '" onchange="guestArrivalHistoryDate(this.value)"></label><label class="ga-field">Cari nama tamu<input type="search" value="' + gaEscape(GA.search) + '" placeholder="Ketik nama tamu…" oninput="GA.search=this.value;guestArrivalRenderHistoryCards()"></label></div><div class="ga-section-title"><h3>Riwayat Tamu</h3><span class="ga-count">' + GA.history.length + ' pendaftaran</span></div><div id="ga-history-cards" class="ga-card-list">' + guestArrivalHistoryCards() + '</div>';
}
function guestArrivalHistoryCards() {
  const needle = String(GA.search || '').trim().toLocaleLowerCase('id-ID');
  const rows = GA.history.filter(g => String(g.guest_name || '').toLocaleLowerCase('id-ID').includes(needle));
  if (!rows.length) return '<div class="ga-empty"><strong>Tamu tidak ditemukan</strong>Coba nama lain atau pilih tanggal yang berbeda.</div>';
  return rows.map(g => '<article class="ga-card"><div class="ga-card-top"><div><div class="ga-queue-code">' + gaEscape(g.queue_code) + '</div><div class="ga-name">' + gaEscape(g.guest_name) + '</div></div>' + gaStatusBadge(g.status) + '</div>' +
    '<div class="ga-card-meta"><span>' + Number(g.packs || 0) + ' pack</span>' + (g.whatsapp ? '<span>' + gaPhoneMarkup(g.whatsapp) + '</span>' : '') + '<span class="ga-wait">Waiting ' + gaDuration(gaWaitSeconds(g)) + '</span></div>' +
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
function guestArrivalDashboardMarkup() {
  const d = GA.dashboard || {};
  const stats = [
    ['Total Pendaftaran', d.total_registrations || 0, 'tamu'], ['Total Pack Terdaftar', d.total_packs || 0, 'pack'],
    ['Tamu Selesai', d.completed_count || 0, 'tamu'], ['Tamu Menunggu', d.waiting_count || 0, 'tamu'],
    ['Tamu Dibatalkan', d.cancelled_count || 0, 'tamu'], ['Pack Selesai', d.completed_packs || 0, 'pack'],
    ['Pack Menunggu', d.waiting_packs || 0, 'pack'], ['Pack Dibatalkan', d.cancelled_packs || 0, 'pack'],
    ['Rata-rata Waiting Time', guestArrivalSecondsStat(d.avg_waiting_seconds), 'selesai menunggu'],
    ['Waiting Time Terlama', guestArrivalSecondsStat(d.longest_waiting_seconds), 'selesai menunggu']
  ];
  const monthly = Array.isArray(d.monthly) ? d.monthly : [];
  return '<div class="ga-filters"><label class="ga-field">Dari tanggal<input type="date" value="' + gaEscape(GA.fromDate) + '" max="' + gaEscape(GA.toDate) + '" onchange="guestArrivalDashboardFilter(\'fromDate\',this.value)"></label><label class="ga-field">Sampai tanggal<input type="date" value="' + gaEscape(GA.toDate) + '" min="' + gaEscape(GA.fromDate) + '" onchange="guestArrivalDashboardFilter(\'toDate\',this.value)"></label><div class="ga-field"><span>Periode laporan</span><button class="ga-btn secondary" type="button" onclick="guestArrivalSetThisMonth()">Bulan ini</button></div></div>' +
    '<div class="ga-btn-row"><button type="button" class="ga-btn primary" onclick="guestArrivalExport()" ' + (GA.busy==='export'?'disabled':'') + '>Ekspor Excel (.xlsx)</button></div>' +
    '<div class="ga-stat-grid">' + stats.map(s => '<div class="ga-stat"><label>' + gaEscape(s[0]) + '</label><strong>' + gaEscape(s[1]) + '</strong><span class="ga-unit">' + gaEscape(s[2]) + '</span></div>').join('') + '</div>' +
    '<div class="ga-report-card"><h3>Rekap Bulanan</h3><p class="ga-muted">Mengikuti rentang tanggal yang dipilih.</p>' +
    (monthly.length ? '<div class="ga-month-list">' + monthly.map(m => '<div class="ga-month"><div><strong>' + gaEscape(m.month) + '</strong><div class="ga-muted">' + m.total_registrations + ' pendaftaran · ' + m.total_packs + ' pack</div></div><div style="text-align:right"><strong>' + m.completed_count + ' selesai</strong><div class="ga-muted">' + m.waiting_count + ' menunggu · ' + m.cancelled_count + ' batal</div></div></div>').join('') + '</div>' : '<div class="ga-empty">Belum ada data pada periode ini.</div>') + '</div>';
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
  GA.form = { name:'', packs:'1', whatsapp:'', status:'Menunggu', requestId:gaUuid(), dirty:false, saving:false };
  guestArrivalShowForm();
}
function guestArrivalFormInput(key, value) {
  if (!GA.form) return;
  GA.form[key] = value; GA.form.dirty = true;
  if (key === 'whatsapp') {
    const note = document.getElementById('ga-form-wa-note');
    if (note) note.textContent = value && !gaPhoneValid(value) ? 'Nomor tidak valid. Pendaftaran tetap boleh disimpan, tetapi tautan WhatsApp tidak akan aktif.' : 'Format lokal Indonesia, contoh 0812xxxxxxxx. Nomor tidak dikirim otomatis.';
  }
}
function guestArrivalShowForm() {
  if (!GA.form) return;
  const f = GA.form;
  modal('<h3 class="ga-modal-heading">Tambah Tamu</h3><p class="ga-modal-intro">Waktu kedatangan dicatat otomatis oleh server.</p>' +
    '<div class="ga-field"><label for="ga-form-name">Nama <span aria-hidden="true">*</span></label><input id="ga-form-name" autocomplete="name" maxlength="160" value="' + gaEscape(f.name) + '" placeholder="Nama tamu" oninput="guestArrivalFormInput(\'name\',this.value)" required></div>' +
    '<div class="ga-field" style="margin-top:11px"><label for="ga-form-packs">Jumlah Pack <span aria-hidden="true">*</span></label><input id="ga-form-packs" type="number" min="1" step="1" inputmode="numeric" value="' + gaEscape(f.packs) + '" oninput="guestArrivalFormInput(\'packs\',this.value)" required></div>' +
    '<div class="ga-field" style="margin-top:11px"><label for="ga-form-wa">Nomor WhatsApp (opsional)</label><input id="ga-form-wa" type="tel" inputmode="tel" autocomplete="tel" maxlength="40" value="' + gaEscape(f.whatsapp) + '" placeholder="0812xxxxxxxx" oninput="guestArrivalFormInput(\'whatsapp\',this.value)"><span id="ga-form-wa-note" class="ga-muted">' + (f.whatsapp && !gaPhoneValid(f.whatsapp) ? 'Nomor tidak valid. Pendaftaran tetap boleh disimpan, tetapi tautan WhatsApp tidak akan aktif.' : 'Format lokal Indonesia, contoh 0812xxxxxxxx. Nomor tidak dikirim otomatis.') + '</span></div>' +
    '<div class="ga-field" style="margin-top:11px"><label for="ga-form-status">Status awal</label><select id="ga-form-status" onchange="guestArrivalFormInput(\'status\',this.value)"><option value="Menunggu" ' + (f.status==='Menunggu'?'selected':'') + '>Menunggu</option><option value="Selesai" ' + (f.status==='Selesai'?'selected':'') + '>Selesai</option></select></div>' +
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
  if (!['Menunggu','Selesai'].includes(f.status)) { gaToast('Status awal tidak valid.', 'err'); return; }
  f.saving = true; guestArrivalShowForm();
  try {
    const result = await gaRpc('guest_arrival_create', {
      p_name:String(f.name).trim(), p_packs:packs,
      p_whatsapp:String(f.whatsapp || '').trim() || null,
      p_initial_status:f.status, p_request_id:f.requestId
    });
    const code = result && result.queue_code ? result.queue_code : 'WL';
    GA.form = null; closeM();
    gaToast('Tamu berhasil didaftarkan — ' + code, 'ok');
    GA.ready = false; await guestArrivalRefresh();
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
async function guestArrivalSetStatus(id, status) {
  if (!['Selesai','Batalkan'].includes(status)) return;
  if (status === 'Batalkan') { guestArrivalCancel(id); return; }
  if (GA.busy) return;
  GA.busy = id;
  try {
    await gaRpc('guest_arrival_set_status', { p_id:id, p_status:status, p_reason:null });
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
    await gaRpc('guest_arrival_set_status', { p_id:id, p_status:'Batalkan', p_reason:reason });
    gaToast('Antrean berhasil dibatalkan.', 'ok');
    GA.showPending = wasPending;
    GA.ready = false; await guestArrivalRefresh();
  } catch (e) { gaToast('Pembatalan belum berhasil. ' + gaHumanError(e), 'err'); }
  finally { GA.busy = ''; GA.cancelId = null; GA.cancelReason = ''; if (wasPending) { GA.showPending = true; guestArrivalRenderPendingModal(); } }
}
async function guestArrivalOpenDetail(id) {
  try { GA.detail = await gaRpc('guest_arrival_detail', { p_id:id }); guestArrivalShowDetail(); }
  catch (e) { gaToast('Detail tamu gagal dimuat. ' + gaHumanError(e), 'err'); }
}
function guestArrivalShowDetail() {
  const g = GA.detail; if (!g) return;
  const changes = Array.isArray(g.changes) ? g.changes : [];
  const info = (label,value,wide) => '<div class="ga-detail-item ' + (wide?'ga-detail-wide':'') + '"><label>' + gaEscape(label) + '</label><div>' + value + '</div></div>';
  modal('<h3 class="ga-modal-heading">' + gaEscape(g.queue_code) + ' · ' + gaEscape(g.guest_name) + '</h3><p class="ga-modal-intro">Detail pendaftaran tamu. Koreksi data tidak dapat mengubah status atau waktu kedatangan.</p>' +
    '<div class="ga-detail-grid">' +
    info('Nomor antrean',gaEscape(g.queue_code)) + info('Status akhir',gaStatusBadge(g.status)) +
    info('Jumlah pack',gaEscape(g.packs)+' pack') + info('WhatsApp',gaPhoneMarkup(g.whatsapp)) +
    info('Tanggal antrean',gaEscape(gaFormatDate(g.operational_date))) + info('Waktu kedatangan',gaEscape(gaFormatDateTime(g.arrived_at))) +
    info('Waktu akhir',gaEscape(g.finished_at?gaFormatDateTime(g.finished_at):'Belum selesai menunggu')) +
    info('Waiting Time',gaEscape(gaDuration(gaWaitSeconds(g)))) +
    info('Didaftarkan oleh',gaEscape(g.created_by_email || '—'),true) +
    (g.cancellation_reason ? info('Alasan pembatalan',gaEscape(g.cancellation_reason),true) : '') +
    (Number(g.correction_count || 0) ? info('Koreksi',Number(g.correction_count)+' kali · terakhir '+gaEscape(g.last_correction_at?gaFormatDateTime(g.last_correction_at):'—'),true) : '') +
    '</div><details style="margin-top:15px"><summary style="cursor:pointer;font-weight:750">Riwayat Perubahan (' + changes.length + ')</summary>' +
    (changes.length ? '<div class="ga-change-list">' + changes.map(c => '<div class="ga-change"><strong>' + (c.change_type==='CORRECTION'?'Koreksi data':'Perubahan status') + '</strong><div class="ga-muted">' + gaEscape(gaFormatDateTime(c.changed_at)) + ' · ' + gaEscape(c.actor_email || '—') + '</div>' +
      (c.reason?'<div>Alasan: '+gaEscape(c.reason)+'</div>':'') +
      '<details style="margin-top:6px"><summary style="cursor:pointer">Lihat nilai sebelum/sesudah</summary><pre>Sebelum:\n' + gaEscape(JSON.stringify(c.old_data||{},null,2)) + '\n\nSesudah:\n' + gaEscape(JSON.stringify(c.new_data||{},null,2)) + '</pre></details></div>').join('') : '<div class="ga-inline-summary">Belum ada perubahan data</div>') +
    '</details><div class="ga-btn-row"><button type="button" class="ga-btn primary" onclick="guestArrivalOpenEdit()">Edit data</button><button type="button" class="ga-btn secondary" onclick="closeM()">Tutup</button></div>');
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
    await gaRpc('guest_arrival_correct',{p_id:f.id,p_name:String(f.name).trim(),p_packs:packs,p_whatsapp:String(f.whatsapp||'').trim()||null,p_reason:String(f.reason).trim()});
    gaToast('Koreksi tersimpan dan tercatat di Riwayat Perubahan.','ok');
    const id=f.id; GA.edit=null;
    GA.detail=await gaRpc('guest_arrival_detail',{p_id:id});
    GA.ready=false; await guestArrivalRefresh(); guestArrivalShowDetail();
  } catch(e) {
    f.saving=false; guestArrivalShowEdit();
    gaToast('Koreksi gagal disimpan. Input tetap dipertahankan. '+gaHumanError(e),'err');
  }
}
function guestArrivalHasUnsaved() {
  return !!((GA.form && GA.form.dirty && !GA.form.saving) || (GA.edit && GA.edit.dirty && !GA.edit.saving));
}
window.guestArrivalHandleNavigation = function(nextPage) {
  if (!guestArrivalHasUnsaved()) return true;
  modal('<h3 class="ga-modal-heading">Perubahan belum disimpan</h3><p class="ga-modal-intro">Ada input yang belum tersimpan. Pilih tetap mengedit atau tinggalkan halaman dan buang perubahan.</p><div class="ga-btn-row"><button type="button" class="ga-btn primary" onclick="guestArrivalResumeEditing()">Tetap mengedit</button><button type="button" class="ga-btn danger" onclick="guestArrivalDiscardAndNavigate(\'' + gaEscape(nextPage) + '\')">Tinggalkan halaman</button></div>');
  return false;
};
function guestArrivalResumeEditing() { if (GA.edit) guestArrivalShowEdit(); else if (GA.form) guestArrivalShowForm(); }
function guestArrivalDiscardAndNavigate(nextPage) {
  GA.form=null; GA.edit=null; closeM(); pg=nextPage; R();
}
window.addEventListener('beforeunload', function(e) {
  if (D && D.me && (D.me.r==='G'||pg==='guest_arrival') && guestArrivalHasUnsaved()) { e.preventDefault(); e.returnValue=''; }
});
async function guestArrivalExport() {
  if (GA.busy) return;
  if (typeof XLSX==='undefined'||!XLSX.utils) { gaToast('Library Excel belum tersedia. Muat ulang halaman dan coba lagi.','err'); return; }
  GA.busy='export'; R();
  try {
    const data=await gaRpc('guest_arrival_export',{p_from:GA.fromDate,p_to:GA.toDate});
    const details=Array.isArray(data.details)?data.details:[], cancellations=Array.isArray(data.cancellations)?data.cancellations:[], summary=data.summary||{};
    const columns=[['Tanggal Operasional','operational_date'],['Nomor Antrean','queue_code'],['Nama Tamu','guest_name'],['Jumlah Pack','packs'],['WhatsApp','whatsapp'],['Waktu Kedatangan','arrived_at'],['Status Akhir','status'],['Waktu Selesai Menunggu','finished_at'],['Waiting Time (detik)','waiting_seconds'],['Alasan Pembatalan','cancellation_reason'],['Jumlah Koreksi','correction_count'],['Koreksi Terakhir','last_correction_at'],['Alasan Koreksi Terakhir','last_correction_reason'],['Didaftarkan Oleh','created_by_email']];
    const makeRows=rows=>[columns.map(x=>x[0]),...rows.map(g=>columns.map(([label,key])=>g[key]==null?'':g[key]))];
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(makeRows(details)),'Detail Tamu');
    XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(makeRows(cancellations)),'Pembatalan');
    const summaryRows=[['Ringkasan Guest Arrival','Nilai'],['Dari tanggal',GA.fromDate],['Sampai tanggal',GA.toDate],['Total Pendaftaran',summary.total_registrations||0],['Total Pack Terdaftar',summary.total_packs||0],['Tamu Selesai',summary.completed_count||0],['Tamu Menunggu',summary.waiting_count||0],['Tamu Dibatalkan',summary.cancelled_count||0],['Pack Selesai',summary.completed_packs||0],['Pack Menunggu',summary.waiting_packs||0],['Pack Dibatalkan',summary.cancelled_packs||0],['Rata-rata Waiting Time (detik)',summary.avg_waiting_seconds||0],['Waiting Time Terlama (detik)',summary.longest_waiting_seconds||0],[],['Rekap Bulanan','Total Pendaftaran','Total Pack','Selesai','Menunggu','Dibatalkan','Pack Selesai','Pack Menunggu','Pack Dibatalkan']];
    (summary.monthly||[]).forEach(m=>summaryRows.push([m.month,m.total_registrations,m.total_packs,m.completed_count,m.waiting_count,m.cancelled_count,m.completed_packs,m.waiting_packs,m.cancelled_packs]));
    XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(summaryRows),'Ringkasan');
    XLSX.writeFile(wb,'Guest-Arrival-'+GA.fromDate+'-sd-'+GA.toDate+'.xlsx');
    gaToast('Ekspor Excel berhasil dibuat.','ok');
  } catch(e) { gaToast('Ekspor gagal. '+gaHumanError(e),'err'); }
  finally { GA.busy=''; R(); }
}
V.guest_arrival = () => guestArrivalRender();
if (window.__barappRefreshUI) window.__barappRefreshUI();
setInterval(() => {
  if (!D || !D.me || (D.me.r!=='G' && !isDeveloper()) || pg!=='guest_arrival') return;
  const today = gaToday();
  if (today !== GA.lastOperationalDate && !GA.loading) {
    GA.lastOperationalDate = today;
    if (GA.tab === 'queue') { GA.ready = false; guestArrivalRefresh(true); }
  }
  document.querySelectorAll('[data-ga-wait-id]').forEach(node => {
    const id=node.getAttribute('data-ga-wait-id'), row=[...GA.queue,...GA.pending,...GA.history].find(g=>g.id===id);
    if (row) node.textContent=gaDuration(gaWaitSeconds(row));
  });
},1000);
