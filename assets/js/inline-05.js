/* Extracted from index.html inline script 5. Preserve original execution order. */
/* Keep the recipe remove handler available to inline buttons. */
window.cgRemoveLine=function(type,i){
  const row=document.querySelector('.cg-line[data-kind="'+type+'"][data-index="'+i+'"]');
  if(!row)return;
  row.remove();
  if(type==='wip'&&typeof window.cgWipPreview==='function')window.cgWipPreview();
  if(type==='menu'&&typeof window.cgMenuPreview==='function')window.cgMenuPreview();
};
