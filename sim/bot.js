// Bot policies for sim.py. chaos: good, plus every unhinged idea as soon as it unlocks. good: reviews PRs, keeps a reserve, builds steadily. build: zero reserve, builds and upgrades every pipeline asap, test_full on. rush: like build, also approves every PR and hires 4 staff. idle: does nothing.
window.runBot=function(policy,maxDays){
  newGame();S.paused=false;
  const out=[];let tick=0;const DT=.05;
  const place=(kind,type)=>{const c0=kind==='pipe'?PIPES[type]:null;
    for(const rot of [false,true]){const w=c0?(rot?c0.h:c0.w):1,h=c0?(rot?c0.w:c0.h):1;
      for(let r=1;r<ROWS-2;r++)for(let c=1;c<COLS-w;c++)if(canPlace(c,r,w,h)){spend('Building',kind==='pipe'?c0.cost:FAC[type].cost);const o=addObj(kind,type,c,r,rot);for(const a of [...S.hackers,...S.staff]){if(unstick(a)){release(a);if(a.job){claim(a.job,false);a.job=null}a.state='idle'}}return o}}return null};
  const cnt=t=>S.objs.filter(o=>o.type===t).length;
  while(!S.over&&S.day<=maxDays){
    if(S.paused){ // end of day modal
      out.push(snap('end'));out.push('   ledger '+JSON.stringify(Object.fromEntries(Object.entries(S.today).map(([k,v])=>[k,Math.round(v)]))));
      if(S.over)break; nextDay(); continue;}
    update(DT);tick++;
    if(tick%20)continue; // act every 1s game time
    if(policy==='idle'){continue}
    // chaos: plays like good, and fires every unhinged idea as soon as it unlocks
    if(policy==='chaos'){
      for(const k of ['claude','fork','rust','swarm','mega'])if(S.hu.has(k)&&!S.hk[k]&&!(k==='rust'&&S.rustDone))doHack(k);
      if(S.hu.has('bribe'))doHack('bribe');
      if(S.hu.has('force')&&Math.random()<.1){const o=S.objs.find(o=>o.kind==='pipe'&&o.broken&&!o.claimed);if(o)forcePush({kind:'pipe',ref:o.id})}
      if(S.hu.has('prod'))for(const o of S.objs)if(o.kind==='pipe')prodRun(o.id);
    }
    // PRs
    for(const pr of [...S.prs]){ if(pr.age<3)continue; const seesBad=Math.random()<.8?pr.bad:!pr.bad;
      if(policy==='rush'||!seesBad)approvePR(pr.id,false);else requestChanges(pr.id,false);}
    // slack events: choose option 0 if affordable
    for(const m of S.slack){if(m.actions&&!m.done&&!m.noAuto){const a=m.actions[0];if(a.cost&&S.credits<a.cost)continue;if(a.cost)spend('Slack purchases',a.cost);const r=a.fn();if(r!==false){m.done=true;m.choice='bot'}}}
    // fix CI
    for(const o of S.objs)if(o.kind==='pipe'&&o.broken&&!o.claimed)assignFix({kind:'pipe',ref:o.id});
    for(const m of S.badMods)if(!S.modClaim.has(m))assignFix({kind:'mod',ref:m});
    // releases & upgrades
    for(const o of S.objs)if(o.kind==='pipe'){if(policy!=='idle')o.full=policy==='rush'||policy==='build'||S.credits>450;releasePipe(o.id);if(canUpgrade(o)&&S.credits>upCost(o)+(policy==='rush'||policy==='build'?0:150))upgradePipe(o.id)}
    const reserve=policy==='rush'||policy==='build'?0:120;
    // pipelines
    for(const k of S.unlocked){if(cnt(k))continue;if(PIPES[k].mods.some(m=>S.badMods.has(m)))continue;if(S.credits>=PIPES[k].cost+reserve)place('pipe',k)}
    // facilities
    const nh=S.hackers.filter(h=>h.state!=='leave').length;
    const want={table:Math.ceil(nh/2.5),coffee:Math.ceil(nh/6),pizza:Math.ceil(nh/9),beanbag:Math.ceil(nh/9),stickers:nh>6?1:0,help:S.day>=2?1:0};
    for(const [t,n] of Object.entries(want))if(cnt(t)<n&&S.credits>=FAC[t].cost+reserve)place('fac',t);
    if(S.day>=2&&!S.staff.some(s=>s.type==='maint')&&S.credits>350)hire('maint');
    if(policy==='rush'&&S.credits>150&&S.staff.length<4)hire(S.staff.length%2?'mentor':'maint');
    if(tick%(20*25)===0)out.push(snap('mid'));
  }
  if(S.over)out.push(snap('OVER'));
  return {out,reason:S.overReason,score:score()};
  function snap(tag){return [tag,S.day,clockStr(),Math.round(S.credits),S.hackers.filter(h=>h.state!=='leave').length,Math.round(avgHap()),Math.round(S.rep),S.objs.filter(o=>o.kind==='pipe').map(o=>o.type.slice(0,4)+(o.released?'*':'')+(o.broken?'!':'')).join(','),S.mods.size,S.badMods.size,score(),[...S.hu].join('+')].join(' ')}
};
