function saveDraft() {
  if (S.activeJob) {
    saveActiveJobState();
    if (typeof renderJobs === 'function') renderJobs();
  }
  showToast('Draft saved');
  goScreen('s-dash');
}
function completeJob() {
  if (S.activeJob) saveActiveJobState();
  const required = ['preassess','assess','score','payment','feedback'];
  const all = required.every(k => S.stepsDone[k]);
  if(!all){ showToast('Complete all steps first'); return; }
  showToast('Job complete'); goScreen('s-dash');
}
function showToast(msg) {
  let t = document.getElementById('toast');
  if(!t){ t=document.createElement('div'); t.id='toast'; Object.assign(t.style,{position:'fixed',bottom:'88px',left:'50%',transform:'translateX(-50%)',background:'rgba(15,23,42,.9)',color:'#fff',padding:'10px 18px',borderRadius:'20px',fontSize:'14px',fontWeight:'500',zIndex:'99',transition:'opacity .3s',whiteSpace:'nowrap',pointerEvents:'none'}); document.body.appendChild(t); }
  t.textContent=msg; t.style.opacity='1';
  clearTimeout(t._t); t._t=setTimeout(()=>t.style.opacity='0',2500);
}
