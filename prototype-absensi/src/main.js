import './style.css'

const days = [
  ['24','Sb'],['25','Mg'],['26','Sn'],['27','Sl'],['28','Rb'],['29','Km'],['30','Jm'],['31','Sb'],
  ['1','Mg'],['2','Sn'],['3','Sl'],['4','Rb'],['5','Km'],['6','Jm'],['7','Sb'],['8','Mg'],['9','Sn'],['10','Sl'],['11','Rb'],['12','Km'],['13','Jm']
]
const employees = [
  {name:'Ahyar',role:'Bar',status:['M','M','M','L','M','M','M','M','M','','','','','','','','','','','','']},
  {name:'Dimas',role:'Bar',status:['M','M','L','M','M','M','M','M','M','M','','','','','','','','','','','']},
  {name:'Nadia',role:'Service',status:['M','M','M','M','L','M','M','M','M','M','M','','','','','','','','','','']},
  {name:'Rizky',role:'Kitchen',status:['M','L','M','M','M','M','M','L','M','M','M','','','','','','','','','','']},
  {name:'Salsa',role:'Service',status:['M','M','M','M','M','L','M','M','M','M','M','','','','','','','','','','']},
]
const state = {section:'attendance',query:'',selected:'24 Okt 2026 – 23 Nov 2026'}
const icon = (name) => {
  const paths = {
    calendar:'<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M16 3v4M8 3v4M3 10h18"/>',
    users:'<path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="10" cy="7" r="4"/><path d="M20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    check:'<path d="m5 12 4 4L19 6"/>',
    search:'<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    chevron:'<path d="m7 10 5 5 5-5"/>',
    download:'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/>',
    plus:'<path d="M12 5v14M5 12h14"/>',
    dots:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>'
  }
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name]||''}</svg>`
}
const statusClass = s => ({M:'present',L:'off',I:'leave',S:'sick',PH:'holiday'}[s]||'empty')
const statusLabel = s => ({M:'Masuk',L:'Libur',I:'Izin',S:'Sakit',PH:'Libur nasional'}[s]||'Belum diisi')
function render(){
  const filtered = employees.filter(e=>e.name.toLowerCase().includes(state.query.toLowerCase()))
  document.querySelector('#app').innerHTML = `
    <header class="topbar">
      <a class="brand" href="#" aria-label="Barapp"><span class="brand-mark">b.</span><span>barapp</span><small>PEOPLE OPERATIONS</small></a>
      <div class="top-actions">
        <button class="outlet-select">Lazy Jennie <span class="muted-code">LJN</span>${icon('chevron')}</button>
        <button class="avatar">LJ</button>
      </div>
    </header>
    <main class="shell">
      <div class="page-heading">
        <div><div class="eyebrow">PEOPLE / ATTENDANCE</div><h1>Absensi</h1><p class="subtitle">Pantau kehadiran dan kelola catatan karyawan outlet.</p></div>
        <button class="period-button">${icon('calendar')}<span>${state.selected}</span>${icon('chevron')}</button>
      </div>
      <section class="summary-grid">
        <article class="metric"><div class="metric-top"><span>Total karyawan</span><span class="metric-icon neutral">${icon('users')}</span></div><strong>18</strong><small>Aktif di outlet ini</small></article>
        <article class="metric"><div class="metric-top"><span>Hadir hari ini</span><span class="metric-icon green">${icon('check')}</span></div><strong>14</strong><small>78% dari karyawan aktif</small></article>
        <article class="metric"><div class="metric-top"><span>Belum diisi</span><span class="metric-icon amber">${icon('clock')}</span></div><strong>3</strong><small>Perlu diperiksa</small></article>
        <article class="metric"><div class="metric-top"><span>Periode berjalan</span><span class="metric-icon blue">${icon('calendar')}</span></div><strong>31 <em>hari</em></strong><small>24 Okt – 23 Nov 2026</small></article>
      </section>
      <section class="panel period-panel">
        <div><div class="eyebrow">PERIODE REKAP</div><h2>24 Okt 2026 – 23 Nov 2026</h2><p>Data absensi ditampilkan berdasarkan periode outlet yang dipilih.</p></div>
        <button class="select-period">Pilih periode ${icon('chevron')}</button>
      </section>
      <div class="section-stack">
        <section class="panel accordion">
          <button class="accordion-head" data-toggle="schedule"><span class="section-icon violet">${icon('calendar')}</span><span class="section-title"><b>Jadwal</b><small>Atur dan tinjau jadwal kerja mingguan</small></span><span class="head-meta">Minggu ini</span>${icon('chevron')}</button>
          <div class="accordion-body" id="schedule" hidden><div class="empty-state">Preview jadwal mingguan akan mengikuti data jadwal yang tersedia di Barapp.</div></div>
        </section>
        <section class="panel accordion">
          <button class="accordion-head" data-toggle="summary"><span class="section-icon orange">${icon('users')}</span><span class="section-title"><b>Rekap Karyawan</b><small>Ringkasan kehadiran setiap karyawan</small></span><span class="head-meta">18 karyawan</span>${icon('chevron')}</button>
          <div class="accordion-body" id="summary" hidden><div class="empty-state">Rekap per karyawan ditampilkan pada bagian ini.</div></div>
        </section>
        <section class="panel attendance-panel">
          <div class="attendance-heading">
            <div class="heading-left"><span class="section-icon green">${icon('check')}</span><div><h2>Input Absensi</h2><p>Catat dan perbarui status kehadiran karyawan.</p></div></div>
            <button class="primary-button" id="add-attendance">${icon('plus')} Input Absensi</button>
          </div>
          <div class="toolbar">
            <label class="search-box">${icon('search')}<input id="employee-search" placeholder="Cari nama karyawan..." value="${state.query}"></label>
            <div class="toolbar-right"><span class="table-count">Menampilkan ${filtered.length} dari 18 karyawan</span><button class="secondary-button">${icon('download')} Export</button><button class="icon-button" aria-label="Opsi lainnya">${icon('dots')}</button></div>
          </div>
          <div class="table-wrap">
            <table class="attendance-table">
              <thead><tr><th class="employee-col">KARYAWAN</th>${days.map(d=>`<th><span>${d[0]}</span><small>${d[1]}</small></th>`).join('')}<th class="total-col">HADIR</th></tr></thead>
              <tbody>${filtered.map(e=>`<tr><td class="employee-cell"><span class="employee-avatar">${e.name.slice(0,1)}</span><span><b>${e.name}</b><small>${e.role}</small></span></td>${e.status.map((s,i)=>`<td><button class="status ${statusClass(s)}" title="${statusLabel(s)}" aria-label="${e.name}, tanggal ${days[i][0]}: ${statusLabel(s)}">${s||'—'}</button></td>`).join('')}<td class="total-cell">${e.status.filter(s=>s==='M').length}</td></tr>`).join('')}</tbody>
            </table>
            ${filtered.length?'':'<div class="empty-state">Nama karyawan tidak ditemukan.</div>'}
          </div>
          <div class="table-footer"><div class="legend"><span><i class="dot present-dot"></i>Masuk</span><span><i class="dot off-dot"></i>Libur</span><span><i class="dot leave-dot"></i>Izin</span><span><i class="dot sick-dot"></i>Sakit</span><span><i class="dot empty-dot"></i>Belum diisi</span></div><span class="footnote">Klik status untuk melihat contoh interaksi.</span></div>
        </section>
      </div>
      <footer class="preview-note"><span class="preview-dot"></span>DESAIN PREVIEW · DATA CONTOH · BELUM TERHUBUNG KE BACKEND</footer>
    </main>
    <div class="toast" id="toast" role="status"></div>
  `
  document.querySelector('#employee-search').addEventListener('input',e=>{state.query=e.target.value;render()})
  document.querySelectorAll('[data-toggle]').forEach(btn=>btn.addEventListener('click',()=>{
    const target=document.getElementById(btn.dataset.toggle)
    target.hidden=!target.hidden
    btn.classList.toggle('expanded',!target.hidden)
  }))
  document.querySelectorAll('.status').forEach(btn=>btn.addEventListener('click',()=>showToast('Kontrol status pada prototype ini hanya visual. Logika asli tidak disentuh.')))
  document.querySelector('#add-attendance').addEventListener('click',()=>showToast('Form input akan tetap menggunakan fungsi asli Barapp saat implementasi.'))
}
function showToast(message){const el=document.querySelector('#toast');el.textContent=message;el.classList.add('show');clearTimeout(window.toastTimer);window.toastTimer=setTimeout(()=>el.classList.remove('show'),2600)}
render()
