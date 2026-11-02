/* Barapp Absensi module
 * UI-only view override. Reuses the existing Barapp session, permissions,
 * in-memory records, date range, modal and Supabase-backed save handlers.
 * Do not duplicate backend or attendance business logic here.
 */
(function(){
  'use strict';

  function attendanceView(){
    const range=rng(),f=range.f,t=range.t,bad=f>t;
    const ds=bad?[]:days(f,t),tooWide=ds.length>93;
    const rows=bad||tooWide?[]:flt(f,t);
    const locked=D.per.filter(p=>p.lock&&p.s<=t&&p.e>=f);
    const active=(D.emp||[]).filter(e=>e.aktif);
    const todayKey=today();
    const todayRows=(D.att||[]).filter(a=>a.d===todayKey);
    const todayPresent=todayRows.filter(a=>a.s==='M').length;
    const todayRecorded=new Set(todayRows.map(a=>String(a.e))).size;
    const missingToday=Math.max(0,active.length-todayRecorded);
    const periodRows=(D.att||[]).filter(a=>a.d>=f&&a.d<=t);
    const count=key=>periodRows.filter(a=>a.s===key).length;
    const totalDays=ds.length;
    const dateLabel=(value)=>fd(value);
    const summary=[
      ['Total karyawan',active.length,'Aktif di outlet ini','users','neutral'],
      ['Hadir hari ini',todayPresent,'Status Masuk','check','green'],
      ['Belum diisi',missingToday,'Perlu diperiksa hari ini','clock','amber'],
      ['Data periode',periodRows.length,'Catatan absensi tersimpan','calendar','blue']
    ];
    const summaryHtml=summary.map(([label,value,meta,icon,tone])=>`
      <article class="abx-metric">
        <div class="abx-metric-top"><span>${label}</span><span class="abx-metric-icon ${tone}">${iconSvg(icon)}</span></div>
        <strong>${value}</strong><small>${meta}</small>
      </article>`).join('');
    const message=bad
      ? '<div class="abx-empty">Tanggal mulai harus sebelum tanggal akhir.</div>'
      : tooWide
        ? '<div class="abx-empty">Rentang lebih dari 93 hari terlalu panjang untuk tabel harian. Persempit rentang, atau lihat di Rekap / Export.</div>'
        : '';
    const table=rows.length?`
      <div class="abx-table-scroll">
        <table class="abx-table">
          <thead><tr><th class="abx-employee-col">KARYAWAN</th>
            ${ds.map(d=>`<th><span>${+d.slice(8)}</span><small>${(LANG==='en'?['Su','Mo','Tu','We','Th','Fr','Sa']:['Mg','Sn','Sl','Rb','Km','Jm','Sb'])[new Date(U(d)).getUTCDay()]}</small></th>`).join('')}
            <th class="abx-total-col">MASUK</th><th>LIBUR</th><th>IZIN</th><th>SAKIT</th><th>PH</th><th>BELUM</th>
          </tr></thead>
          <tbody>${rows.map(e=>{
            const c={M:0,L:0,I:0,S:0,PH:0,B:0};
            return `<tr>
              <td class="abx-employee">
                <span class="abx-avatar">${esc((e.nama||'').trim().charAt(0).toUpperCase())}</span>
                <span><b>${esc(e.nama)}</b><small>${esc(e.jab)||'Karyawan'}</small></span>
              </td>
              ${ds.map(d=>{
                const a=rec(e.id,d);
                if(a)c[a.s]=(c[a.s]||0)+1;else c.B++;
                return `<td class="abx-day" ${adm()? `onclick="cell('${esc(e.id)}','${d}')"`:''} title="${a?ST[a.s]:'BELUM ADA DATA'}">${a?badge(a.s)+(a.ph?IC('cam',12):''):'<span class="abx-dash">—</span>'}</td>`;
              }).join('')}
              <td class="abx-total">${c.M}</td><td>${c.L}</td><td>${c.I}</td><td>${c.S}</td><td>${c.PH}</td><td class="abx-total">${c.B}</td>
            </tr>`;
          }).join('')}</tbody>
        </table>
      </div>
      <div class="abx-table-foot"><span>${rows.length} karyawan ditampilkan · ${totalDays} hari dalam periode</span><span>Ketuk status tanggal untuk mengubah data (sesuai izin).</span></div>
    ` : (message?'':`<div class="abx-empty">${D.emp.length?'Tidak ada hasil.':'Belum ada karyawan. Tambahkan karyawan terlebih dahulu.'}</div>`);
    const statusLegend=[['M','Masuk'],['L','Libur'],['I','Izin'],['S','Sakit'],['PH','Public Holiday']];
    return `
      <section class="abx-view">
        <div class="abx-summary">${summaryHtml}</div>
        <section class="abx-panel abx-period">
          <div><div class="abx-eyebrow">PERIODE REKAP</div><h3>${bad?'Periode tidak valid':dateLabel(f)+' – '+dateLabel(t)}</h3><p>Ringkasan mengikuti periode outlet yang sedang dipilih.</p></div>
          <div class="abx-period-meta"><span>${totalDays} hari</span><span>${periodRows.length} catatan</span></div>
        </section>
        ${locked.length?`<div class="abx-locked"><b>PERIODE TERKUNCI</b><span>${locked.map(pl).join(', ')}</span></div>`:''}
        <section class="abx-panel abx-attendance">
          <div class="abx-heading">
            <div><div class="abx-eyebrow">PEOPLE OPERATIONS</div><h2>Catatan Kehadiran</h2><p>Kelola dan tinjau status kehadiran karyawan.</p></div>
            ${adm()?'<button class="abx-primary" onclick="openAtt(-1)"><span>＋</span> Input Absensi</button>':''}
          </div>
          <div class="abx-toolbar">
            <label class="abx-search"><span>⌕</span><input value="${esc(F.q||'')}" placeholder="Cari nama karyawan..." oninput="fSearchInput(this)" data-q></label>
            <span class="abx-result-count">${rows.length} karyawan</span>
          </div>
          ${message}${table}
          <div class="abx-legend">${statusLegend.map(([key,label])=>`<span><i class="abx-dot ${key.toLowerCase()}"></i>${label} <small>${count(key)}</small></span>`).join('')}<span><i class="abx-dot missing"></i>Belum ada data <small>${count('B')+(rows.reduce((n,e)=>n+ds.filter(d=>!rec(e.id,d)).length,0)-count('B'))}</small></span></div>
        </section>
      </section>`;
  }

  function iconSvg(name){
    const paths={
      users:'<path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="10" cy="7" r="4"/><path d="M20 21v-2a4 4 0 0 0-3-3.9M16 3.2a4 4 0 0 1 0 7.6"/>',
      check:'<path d="m5 12 4 4L19 6"/>',
      clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
      calendar:'<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M16 3v4M8 3v4M3 10h18"/>'
    };
    return '<svg viewBox="0 0 24 24" aria-hidden="true">'+(paths[name]||'')+'</svg>';
  }

  window.__barappRegisterViews({abs:attendanceView});
})();
