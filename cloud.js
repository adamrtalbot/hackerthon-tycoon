"use strict";

(()=>{
  const dialog=$('#cloud'),key='nfcore-hackathon-cloud-code';
  let token='',revision=null,savedSeed=null,busy=false,wasPaused=true,storageAvailable=true;
  try{token=localStorage.getItem(key)||''}catch{storageAvailable=false}
  if(!/^[0-9a-f]{64}$/.test(token)){
    token=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
    try{localStorage.setItem(key,token)}catch{storageAvailable=false}
  }
  $('#recovery-code').value=token;
  try{$('#player-name').value=localStorage.getItem('nfcore-hackathon-name')||''}catch{}

  function status(message,error=false){
    $('#cloud-status').textContent=message;
    $('#cloud-status').dataset.error=String(error);
  }
  function controls(){
    dialog.querySelectorAll('button,input').forEach(el=>el.disabled=busy);
    $('#submit-score').disabled=busy||!S.over;
    $('#score-hint').textContent=S.over?`Finished on day ${S.day} · ${score().toLocaleString()} points. Your name will be public.`:'Finish a hackathon to submit your score.';
    dialog.setAttribute('aria-busy',String(busy));
  }
  async function api(path,method='GET',body,code=token){
    let response;
    try{
      response=await fetch(`/api/${path}`,{
        method,headers:{...(path==='leaderboard'?{}:{Authorization:`Bearer ${code}`}),...(body?{'Content-Type':'application/json'}:{})},
        body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000),
      });
    }catch{throw new Error('Cloud service unavailable. Your current game is still here; check your connection and try again.')}
    let data;
    try{data=await response.json()}catch{throw new Error('Cloud saves need the Cloudflare-hosted game. You can still play here.')}
    if(!response.ok)throw new Error(data.error||'Cloud request failed. Please try again.');
    return data;
  }
  async function run(fn,target='save'){
    if(busy)return;
    busy=true;controls();
    try{await fn()}catch(error){
      if(target==='score')$('#score-status').textContent=error.message;
      else status(error.message,true);
    }finally{busy=false;controls()}
  }
  async function leaderboard(){
    $('#leaderboard').textContent='Loading scores…';
    try{
      const {entries}=await api('leaderboard');
      $('#leaderboard').innerHTML=entries.length?`<table><caption>Community leaderboard</caption><thead><tr><th scope="col">Rank</th><th scope="col">Player</th><th scope="col">Day</th><th scope="col">Score</th></tr></thead><tbody>${entries.map((e,i)=>`<tr><td>${i+1}</td><td>${esc(e.name)}</td><td>${e.day}</td><td>${e.score.toLocaleString()}</td></tr>`).join('')}</tbody></table>`:'<p class="hint">No scores yet. Finish a hackathon and submit the first one.</p>';
    }catch(error){$('#leaderboard').textContent=error.message}
  }
  async function inspectSave(){
    const data=await api('save');
    if(revision===null){revision=data.revision;savedSeed=data.save?.seed??null}
    if(data.revision!==revision){status('Your cloud save changed on another tab or device. Load it before saving again.',true);return}
    status(data.save?`Cloud save available · ${new Date(data.updatedAt).toLocaleString()}`:'No cloud save yet. Save this hackathon to get started.');
    if(!storageAvailable)status('Browser storage is unavailable. Keep your recovery code before leaving.',true);
  }
  function confirmLoad(){
    return (!replay.steps&&!replay.commands.length)||window.confirm('Load the cloud save? Unsaved progress in this game will be replaced.');
  }
  function load(data){
    restoreReplay(data.save);
    revision=data.revision;savedSeed=data.save.seed;wasPaused=true;
    const next=S.over?'Close this panel to view your results or start a new hackathon.':
      S.t>=DAY_LEN?'Close this panel and start the next day.':
      $('#overlay').style.display==='flex'?'Close this panel to start the hackathon.':'Close this panel, then press play to continue.';
    status(`Loaded day ${S.day}, ${clockStr()}. ${next}`);
  }
  const actions={
    open:()=>{
      if(dialog.open)return;
      wasPaused=S.paused;S.paused=true;
      $('#score-status').textContent='';
      dialog.showModal();
      run(async()=>{status('Checking cloud save…');await Promise.all([inspectSave(),leaderboard()])});
    },
    close:()=>dialog.close(),
    reveal:()=>{
      const input=$('#recovery-code');input.type=input.type==='password'?'text':'password';
      $('[data-cloud="reveal"]').textContent=input.type==='password'?'Show code':'Hide code';
    },
    refresh:()=>run(leaderboard),
    save:()=>run(async()=>{
      const save=exportReplay();
      if(revision===null)await inspectSave();
      if(savedSeed!==null&&savedSeed!==save.seed&&!window.confirm('Replace your existing cloud save with this hackathon?'))return;
      status('Saving…');
      const data=await api('save','PUT',{revision,save});
      revision=data.revision;savedSeed=save.seed;
      status(`Saved day ${S.day}, ${clockStr()} to the cloud.`);
    }),
    load:()=>run(async()=>{
      status('Loading…');
      const data=await api('save');
      if(!data.save){status('No cloud save yet. Save this game first, or connect a recovery code.');return}
      if(confirmLoad())load(data);else status('Load cancelled. Your current game has not changed.');
    }),
  };
  document.addEventListener('click',event=>{
    const button=event.target.closest('[data-cloud]');
    if(button&&!button.disabled)actions[button.dataset.cloud]?.();
  });
  dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault()});
  dialog.addEventListener('close',()=>{
    S.paused=wasPaused;
    $('#recovery-code').type='password';$('[data-cloud="reveal"]').textContent='Show code';
    $('#recover-code').value='';$('#recovery-details').open=false;
  });
  $('#recover-form').addEventListener('submit',event=>{
    event.preventDefault();
    run(async()=>{
      const code=$('#recover-code').value.trim().toLowerCase();
      const data=await api('save','GET',undefined,code);
      if(!data.save)throw new Error('No saved game was found for that code. Check the code on your other device.');
      if(!confirmLoad()){status('Connection cancelled. Your current game has not changed.');return}
      load(data);token=code;$('#recovery-code').value=token;$('#recover-code').value='';
      try{localStorage.setItem(key,token)}catch{status('Game loaded. Keep your recovery code: this browser cannot remember it.',true)}
    });
  });
  $('#score-form').addEventListener('submit',event=>{
    event.preventDefault();
    if(!S.over)return;
    run(async()=>{
      const name=$('#player-name').value.trim();
      $('#score-status').textContent='Submitting…';
      await api('score','POST',{name,score:score(),day:S.day});
      try{localStorage.setItem('nfcore-hackathon-name',name)}catch{}
      $('#score-status').textContent='Score submitted. Only your best score is kept.';
      await leaderboard();
    },'score');
  });
})();
