"use strict";

// Version 2 includes upstream's unhinged ideas and pins the rules, RNG and 50 ms timestep.
// Bump it when those rules change; never silently replay an old save with new rules.
function validateReplay(save){
  const uint=(n,max)=>Number.isInteger(n)&&n>=0&&n<=max;
  if(!save||save.version!==2)throw new Error('This save uses an unsupported game version.');
  if(!uint(save.seed,0xffffffff)||!uint(save.steps,250000)||!Array.isArray(save.commands)||save.commands.length>10000)
    throw new Error('This game is too large or the save is invalid.');
  let previous=0;
  for(const c of save.commands){
    if(!c||!uint(c.step,save.steps)||c.step<previous||typeof c.arg!=='string'||c.arg.length>80)
      throw new Error('Invalid save command.');
    previous=c.step;
    const a=c.arg;
    let valid=false;
    switch(c.act){
      case 'start':case 'nextday':case 'rotate':case 'cancel':case 'ledger':case 'desel':valid=a==='';break;
      case 'speed':valid=['0','1','3'].includes(a);break;
      case 'tab':valid=['build','slack','pipes','team'].includes(a);break;
      case 'build':valid=Object.hasOwn(FAC,a);break;
      case 'buildpipe':valid=Object.hasOwn(PIPES,a);break;
      case 'hire':valid=['maint','mentor'].includes(a);break;
      case 'hack':valid=Object.hasOwn(HACKS,a);break;
      case 'egg':valid=Object.hasOwn(EGGS,a);break;
      case 'sl':valid=/^\d+:[0-2]$/.test(a);break;
      case 'assign':case 'force':valid=/^pipe:\d+$/.test(a)||(a.startsWith('mod:')&&ALL_MODS.includes(a.slice(4)));break;
      case 'upgrade':case 'release':case 'profile':case 'remove':case 'prod':valid=/^\d+$/.test(a);break;
      case 'map':{
        let point;try{point=JSON.parse(a)}catch{}
        valid=Array.isArray(point)&&point.length===2&&point.every(Number.isFinite);
        break;
      }
    }
    if(!valid)throw new Error('Invalid save command.');
  }
}

function exportReplay(){
  validateReplay(replay);
  return structuredClone(replay);
}

function restoreReplay(save){
  validateReplay(save);
  const old={state:S,replay,randomState,accumulator,html:$('#overlay').innerHTML,display:$('#overlay').style.display};
  replaying=true;
  try{
    newGame(save.seed);intro();
    for(const command of save.commands){
      while(replay.steps<command.step)advanceGame();
      gameAction(command.act,command.arg);
    }
    while(replay.steps<save.steps)advanceGame();
    replay=structuredClone(save);
    S.paused=true;S.hover=null;typed='';
  }catch{
    S=old.state;replay=old.replay;randomState=old.randomState;accumulator=old.accumulator;
    $('#overlay').innerHTML=old.html;$('#overlay').style.display=old.display;
    throw new Error('Could not restore this save. Your current game has not changed.');
  }finally{
    replaying=false;
    updateHUD();updateModebar();renderPanel(true);renderInspect(true);renderCI();
    last=performance.now();
  }
}
