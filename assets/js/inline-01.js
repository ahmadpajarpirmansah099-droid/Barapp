/* Extracted from index.html inline script 1. Preserve original execution order. */
(function(){
  function showError(kind, message, line, col){
    var a=document.getElementById('app');
    if(!a) return;
    a.innerHTML='<div style="margin:12px;padding:22px;border:1px solid #D9B6A1;border-radius:18px;background:#FFFCF6;color:#2C1A14;font:14px/1.6 system-ui;overflow-wrap:anywhere"><b>BARAPP · Diagnostik JavaScript</b><p style="margin:10px 0">Aplikasi berhenti sebelum UI tampil.</p><code style="white-space:pre-wrap">'+String(kind)+': '+String(message||'Error tidak terdeteksi').replace(/[&<>]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c]})+(line?' (baris '+line+(col?':'+col:'')+')':'')+'</code><p style="margin-top:12px">Kirim screenshot ini ke Ka. Data Supabase tidak diubah.</p></div>';
  }
  window.addEventListener('error',function(e){showError('JS ERROR',e.message,e.lineno,e.colno)});
  window.addEventListener('unhandledrejection',function(e){var r=e.reason;showError('PROMISE ERROR',r&&(r.stack||r.message)||r)});
})();
