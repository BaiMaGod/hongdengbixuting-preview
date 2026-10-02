(() => {
  'use strict';
  const {Race,CONFIG:C,DRIVERS,ITEM_LABEL,rankCars,noise,clamp}=window.RedLight;
  const $=id=>document.getElementById(id),canvas=$('gameCanvas'),ctx=canvas.getContext('2d',{alpha:false}),shell=$('shell');
  const GLYPH={nitro:'ϟ',double:'×2',magnet:'∩',brake:'▰'};
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let race=null,mode='home',duration=120,wallet=0,saved=true,muted=false,audio=null;
  let width=1000,height=700,scale=1,roadX=500,camY=220,last=0,hudClock=0,demoTime=0;
  let feed=[],particles=[],appliedRace=null;
  const keyInput={left:false,right:false,brake:false},pointerInput={left:new Set(),right:new Set(),brake:new Set()};
  try{const stored=Number(localStorage.getItem('redLightMustStop.wallet'));wallet=Number.isFinite(stored)?stored:0;}catch{saved=false;}
  const fmt=n=>(n>0?'+':'')+n.toLocaleString('zh-CN');
  const esc=text=>String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const px=x=>roadX+x*scale,py=y=>height*.69-(y-camY)*scale;
  function sound(type) {
    if(muted)return;
    try {
      const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;
      if(!audio)audio=new AC();if(audio.state==='suspended')audio.resume().catch(()=>{});
      const o=audio.createOscillator(),g=audio.createGain(),t=audio.currentTime;
      o.type=type==='bad'?'triangle':'sine';const hz={good:620,bad:130,item:850,start:440}[type]||440;
      o.frequency.setValueAtTime(hz,t);o.frequency.exponentialRampToValueAtTime(type==='bad'?70:hz*1.45,t+.12);
      g.gain.setValueAtTime(.025,t);g.gain.exponentialRampToValueAtTime(.0001,t+.2);
      o.connect(g);g.connect(audio.destination);o.start();o.stop(t+.21);
    }catch{}
  }
  function overlay(next) {
    mode=next;
    for(const [id,name] of [['homeOverlay','home'],['pauseOverlay','paused'],['endOverlay','ended']])$(id).classList.toggle('hidden',name!==next);
    $('hud').classList.toggle('hidden',next==='home'||next==='ended');
    if(next==='paused')$('resumeBtn').focus({preventScroll:true});
    if(next==='ended')$('againBtn').focus({preventScroll:true});
    if(next==='home')renderWallet();
  }
  function renderWallet() {
    $('walletAmount').textContent=wallet.toLocaleString('zh-CN');$('walletAmount').classList.toggle('negative',wallet<0);
    $('storageHint').textContent=saved?'本机自动保存 · 金币可为负数':'浏览器未开放存档 · 本次会话有效';
  }
  function clearInput() {
    for(const k of Object.keys(keyInput)){keyInput[k]=false;pointerInput[k].clear();}
    if(race)race.input={left:false,right:false,brake:false};
    document.querySelectorAll('.control.held').forEach(e=>e.classList.remove('held'));
  }
  function syncInput() {
    for(const k of Object.keys(keyInput)) {
      const pressed=keyInput[k]||pointerInput[k].size>0;
      if(race)race.input[k]=pressed;
      $(k==='brake'?'brakeBtn':k+'Btn').classList.toggle('held',pressed);
    }
  }
  function start() {
    clearInput();race=new Race({duration,seed:Math.floor(Math.random()*100000)});feed=[];particles=[];
    $('rankBox').classList.remove('open');$('rankToggle').setAttribute('aria-expanded','false');
    overlay('playing');hudClock=0;last=performance.now();updateHUD();sound('start');
  }
  function pause() {
    if(mode==='playing'){race.pause();clearInput();overlay('paused');}
    else if(mode==='paused'){race.resume();clearInput();overlay('playing');last=performance.now();}
  }
  function home(){clearInput();race=null;feed=[];particles=[];overlay('home');}
  function useItem(){if(mode==='playing'&&race.useItem()){consumeEvents();updateHUD();}}
  function consumeEvents() {
    for(const event of race.events.splice(0)) {
      if(event.id!=='player')continue;
      feed.unshift(event);feed=feed.slice(0,2);
      if(event.amount)particles.push({...event,born:race.elapsed});
      if(event.kind!=='good'||event.amount>=10)sound(event.kind);
    }
    feed=feed.filter(e=>race.elapsed-e.time<2.4);
    particles=particles.filter(e=>race.elapsed-e.born<1.1);
  }
  function updateHUD() {
    if(!race)return;
    const p=race.player,time=Math.max(0,Math.ceil(race.duration-race.elapsed)),rank=rankCars(race.cars),position=rank.indexOf(p)+1;
    $('myScore').textContent=p.score.toLocaleString('zh-CN');
    $('timeText').textContent=String(Math.floor(time/60)).padStart(2,'0')+':'+String(time%60).padStart(2,'0');
    $('timeProgress').style.width=(100*(1-race.elapsed/race.duration))+'%';
    $('speedText').textContent=Math.round(p.speed*.36);$('speedBar').style.width=clamp(p.speed/330*100,0,100)+'%';
    $('rankToggle').textContent='第 '+position+' 名 ▾';
    $('rankList').innerHTML=rank.map((c,i)=>`<div class="rank-row ${c.id==='player'?'me':''}"><span>${String(i+1).padStart(2,'0')}</span><i style="--car:${c.color}"></i><span>${esc(c.name)}${c.retired?' · 退赛':''}</span><strong>${c.score}</strong></div>`).join('');
    const up=race.upcoming(p),ph=up.phase,distance=Math.max(0,Math.ceil(up.distance*.1));
    $('signalTitle').textContent=ph.name;$('signalTitle').style.color=ph.color;
    $('signalText').textContent='距停止线 '+distance+' m';$('lightCountdown').textContent=Math.ceil(ph.left);$('lightCountdown').style.color=ph.color;
    document.querySelectorAll('[data-light]').forEach(b=>{b.classList.toggle('active',b.dataset.light===ph.kind);b.style.setProperty('--light',ph.color);});
    const caution=ph.kind!=='green'&&up.distance<p.speed*p.speed/(2*C.brake)+130&&up.distance>=0;
    $('signalBox').classList.toggle('danger',caution);
    $('brakeWarning').classList.toggle('hidden',!caution);
    $('brakeWarning').textContent=p.speed<5?'稳稳停住 · 等待绿灯':ph.kind==='red'?'前方红灯 · 按住刹车':'前方黄灯 · 减速准备';
    const item=p.item;$('itemBtn').disabled=!item;$('itemBtn').classList.toggle('has-item',!!item);
    $('itemGlyph').textContent=item?GLYPH[item]:'＋';$('itemLabel').textContent=item?ITEM_LABEL[item]:'道具槽';
    $('itemBtn').setAttribute('aria-label',item?'使用'+ITEM_LABEL[item]:'暂无道具');
    $('effectList').innerHTML=Object.entries(p.buffs).filter(([,until])=>until>race.elapsed)
      .map(([kind,until])=>`<span class="effect">${GLYPH[kind]} ${ITEM_LABEL[kind]} ${Math.ceil(until-race.elapsed)}s</span>`).join('');
    const feedHTML=feed.map(e=>`<div class="feed-item ${e.kind}">${esc(e.text)}</div>`).join('');
    if($('scorefeed').innerHTML!==feedHTML)$('scorefeed').innerHTML=feedHTML;
  }
  function showResult() {
    if(appliedRace===race)return;
    appliedRace=race;clearInput();const rows=race.result,mine=rows.find(c=>c.id==='player');
    wallet+=mine.final;try{localStorage.setItem('redLightMustStop.wallet',String(wallet));saved=true;}catch{saved=false;}
    $('resultEyebrow').textContent=race.reason==='red-light'?'RED LIGHT / 红灯越线':'FINISH / 本局结算';
    $('resultTitle').textContent=race.reason==='red-light'?'闯红灯，结束':mine.rank===1?'稳稳拿下冠军':'比赛完成';
    $('resultSubtitle').textContent=race.reason==='red-light'?'红灯时车头越过停止线，本局立即结束。按此刻金币锁定六人排名并结算。':`完整超车 ${mine.overtakes} 次 · 守法停车 ${mine.stops} 次 · 排名已锁定`;
    $('resultMyRank').textContent='#'+mine.rank;
    for(const [id,value] of [['resultBase',mine.score],['resultAdj',mine.adjustment],['resultFinal',mine.final]]) {
      $(id).textContent=fmt(value);$(id).classList.toggle('negative',value<0);$(id).classList.toggle('positive',value>0);
    }
    $('resultsTable').innerHTML='<div class="result-row header" role="row"><span role="columnheader">名次 / 车手</span><span role="columnheader">局内金币</span><span role="columnheader">奖惩</span><span role="columnheader">最终获得</span></div>'+rows.map(c=>`<div class="result-row ${c.id==='player'?'mine':''}" role="row"><span role="cell">${c.rank}. ${esc(c.name)}</span><span role="cell">${c.score}</span><span role="cell" class="${c.adjustment<0?'negative':'positive'}">${fmt(c.adjustment)}</span><span role="cell" class="${c.final<0?'negative':'positive'}">${fmt(c.final)}</span></div>`).join('');
    $('resultWallet').textContent=wallet.toLocaleString('zh-CN');$('resultWallet').classList.toggle('negative',wallet<0);
    $('resultStorage').textContent=saved?'本局已计入并保存':'本局已计入 · 浏览器阻止保存，刷新后可能丢失';
    overlay('ended');sound(race.reason==='red-light'?'bad':'start');
  }
  function resize() {
    const b=shell.getBoundingClientRect();width=b.width;height=b.height;
    const dpr=Math.min(window.devicePixelRatio||1,2);canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0);scale=clamp((width-42)/(C.roadHalf*2),.65,1.2);
  }
  function rect(x,y,w,h,r,color){ctx.fillStyle=color;ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fill();}
  function line(x1,y1,x2,y2,color,w=1){ctx.strokeStyle=color;ctx.lineWidth=w;ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();}
  function circle(x,y,r,color){ctx.fillStyle=color;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();}
  function drawBuilding(x,y,w,h,seed) {
    rect(x+8,y+12,w,h,5,'#132d3245');rect(x,y,w,h,4,['#829995','#adab99','#859da6','#b1aaa4'][Math.floor(noise(seed)*4)]);
    rect(x+5,y+5,w-10,h-10,2,'#ffffff12');rect(x+9,y+9,w-18,h-20,2,'#203d452b');
    rect(x+14,y+16,w*.4,18,2,'#617778');rect(x+15,y+17,w*.4-2,4,1,'#c9d2c233');
    for(let n=0;n<Math.floor((w-22)/18);n++)rect(x+13+n*18,y+h-10,9,4,1,'#d7e9cc');
    rect(x+w-26,y+18,13,23,2,'#c1c6b6');line(x+6,y+h,x+w-6,y+h,'#52696a',3);
  }
  function drawTree(x,y,size) {
    ctx.fillStyle='#0c252548';ctx.beginPath();ctx.ellipse(x+7,y+11,size,size*.72,0,0,Math.PI*2);ctx.fill();
    circle(x,y,size,'#326d59');circle(x-4,y-4,size*.77,'#4c8d67');circle(x-7,y-7,size*.46,'#71a67a');
    circle(x+size*.5,y+3,size*.5,'#3e7c5b');
  }
  function drawWorld() {
    const l=px(-C.roadHalf),r=px(C.roadHalf),t=r-l;
    ctx.fillStyle='#456c61';ctx.fillRect(0,0,width,height);
    const block=250*scale,offset=(camY*scale)%block;
    for(let n=-2;n<height/block+1;n++) {
      const y=n*block+offset,k=Math.floor(camY/250)-n;
      ctx.fillStyle='#789284';ctx.fillRect(0,y+192*scale,width,13*scale);
      drawBuilding(l-168*scale,y+22*scale,116*scale,151*scale,k*9);
      drawBuilding(r+55*scale,y+30*scale,150*scale,129*scale,k*9+3);
      for(let side of [-1,1]){
        const edge=side===-1?l:r;
        rect(edge+side*33*scale-14*scale,y+204*scale,28*scale,22*scale,4,'#789a78');
        drawTree(edge+side*37*scale,y+218*scale,18*scale);
        drawTree(edge+side*204*scale,y+180*scale,24*scale);
      }
    }
    ctx.fillStyle='#abb6a9';ctx.fillRect(l-18*scale,0,t+36*scale,height);
    ctx.fillStyle='#d7d4bc';ctx.fillRect(l-4*scale,0,t+8*scale,height);
    const gradient=ctx.createLinearGradient(l,0,r,0);gradient.addColorStop(0,'#303f47');gradient.addColorStop(.5,'#3b4c55');gradient.addColorStop(1,'#303f47');
    ctx.fillStyle=gradient;ctx.fillRect(l,0,t,height);
    for(let i=0;i<4;i++)ctx.fillStyle=i%2?'#ffffff02':'#00000004',ctx.fillRect(px(-168+i*84),0,84*scale,height);
    line(l+7*scale,0,l+7*scale,height,'#e8c767',2*scale);line(r-7*scale,0,r-7*scale,height,'#e8c767',2*scale);
    const period=93*scale,dash=(camY*scale)%period;
    for(let y=dash-period;y<height;y+=period)for(let lane=-1;lane<=1;lane++)rect(px(lane*84)-1.5*scale,y,3*scale,38*scale,1,'#cdd8d09e');
    const curb=(camY*scale)%(42*scale);
    for(let y=curb-42*scale;y<height;y+=42*scale) {
      rect(l-4*scale,y,4*scale,21*scale,0,'#899d98');rect(r,y,4*scale,21*scale,0,'#899d98');
    }
    const first=Math.max(0,Math.floor((camY-height/scale-C.firstSignal)/C.signalGap));
    const lastIndex=Math.max(first,Math.ceil((camY+height/scale-C.firstSignal)/C.signalGap));
    for(let i=first;i<=lastIndex;i++)drawIntersection(i,l,r);
    // Road arrows and block markers anchor the moving city without visual clutter.
    const arrowIndex=Math.floor(camY/650);
    for(let n=arrowIndex-1;n<=arrowIndex+2;n++) {
      const y=py(n*650+180);if(y<20||y>height-20)continue;
      for(const lane of [-126,126]) {
        const x=px(lane);line(x,y+15*scale,x,y-15*scale,'#bacdc533',3*scale);
        line(x,y-15*scale,x-8*scale,y-6*scale,'#bacdc533',3*scale);line(x,y-15*scale,x+8*scale,y-6*scale,'#bacdc533',3*scale);
      }
    }
  }
  function drawIntersection(index,l,r) {
    const y=py(C.firstSignal+index*C.signalGap);if(y< -150||y>height+170)return;
    const phase=race?race.phase(index):{kind:'green',color:'#63e7b1'};
    ctx.fillStyle='#344952';ctx.fillRect(0,y-127*scale,width,138*scale);
    line(0,y-134*scale,l,y-134*scale,'#c6cec3',4*scale);line(r,y-134*scale,width,y-134*scale,'#c6cec3',4*scale);
    for(let x=l+12*scale;x<r-16*scale;x+=29*scale)rect(x,y-66*scale,16*scale,37*scale,1,'#e8e6d5');
    rect(l+4*scale,y-3*scale,r-l-8*scale,6*scale,0,'#faf2d9');
    if(phase.kind==='red')rect(l,y+4*scale,r-l,8*scale,0,'#ff717a24');
    for(const x of [l-21*scale,r+21*scale]) {
      line(x,y-65*scale,x,y+9*scale,'#2b4245',4*scale);
      rect(x-10*scale,y-107*scale,20*scale,58*scale,6*scale,'#0e202b');
      for(const [n,kind] of ['red','yellow','green'].entries()) {
        const active=phase.kind===kind,color={red:'#ff717a',yellow:'#ffc857',green:'#63e7b1'}[kind];
        if(active)circle(x,y-(96-n*17)*scale,8*scale,color+'25');
        circle(x,y-(96-n*17)*scale,5*scale,active?color:'#34494b');
      }
    }
    ctx.save();ctx.textAlign='center';ctx.fillStyle='#e4e7d389';ctx.font=`700 ${10*scale}px sans-serif`;ctx.fillText('STOP',px(-126),y+25*scale);ctx.restore();
  }
  function drawCar(car) {
    const x=px(car.x),y=py(car.y);if(y< -140||y>height+140)return;
    const traffic=car.type==='traffic',player=car.id==='player',w=traffic?38:44,h=traffic?68:74;
    ctx.save();ctx.translate(x,y);ctx.scale(scale,scale);
    // Keep the painted body aligned to its collision box during lateral movement.
    rect(-w/2+5,-h/2+8,w+3,h,11,'#07141c55');
    if(player){ctx.strokeStyle='#ffc85777';ctx.lineWidth=1.5;ctx.beginPath();ctx.roundRect(-w/2-7,-h/2-6,w+14,h+12,13);ctx.stroke();}
    if(race&&car.buffs&&race.active(car,'nitro')) {
      for(const sx of [-10,10]){const len=15+noise(Math.floor(race.elapsed*40)+sx)*24;ctx.fillStyle='#74cefdba';ctx.beginPath();ctx.moveTo(sx-4,h/2-2);ctx.lineTo(sx+4,h/2-2);ctx.lineTo(sx,h/2+len);ctx.fill();}
    }
    rect(-w/2-3,-h*.32,7,17,3,'#13202a');rect(w/2-4,-h*.32,7,17,3,'#13202a');
    rect(-w/2-3,h*.18,7,17,3,'#13202a');rect(w/2-4,h*.18,7,17,3,'#13202a');
    rect(-w/2,-h/2,w,h,10,car.color);rect(-w/2+3,-h/2+4,w-6,h-10,8,'#ffffff14');
    rect(-w*.35,-h*.29,w*.7,h*.23,4,'#163143');rect(-w*.3,-h*.27,w*.28,h*.17,2,'#8cbcca66');
    rect(-w*.35,h*.19,w*.7,h*.17,4,'#264455');rect(-w*.3,h*.2,w*.4,2,0,'#a4d0d055');
    rect(-w*.31,-h*.025,w*.62,h*.20,3,car.color);
    if(!traffic){rect(-3,-h*.48,6,h*.16,1,'#20374899');rect(-3,h*.38,6,h*.1,1,'#20374899');}
    rect(-w*.39,-h*.46,9,5,2,'#fff5d3');rect(w*.18,-h*.46,9,5,2,'#fff5d3');
    const braking=player?race?.input.brake:car.speed<50;
    rect(-w*.4,h*.39,9,4,1,braking?'#ff7773':'#a75356');rect(w*.18,h*.39,9,4,1,braking?'#ff7773':'#a75356');
    if(braking){circle(-w*.28,h*.43,7,'#ff717a25');circle(w*.29,h*.43,7,'#ff717a25');}
    if(!traffic){ctx.textAlign='center';ctx.font='800 8px sans-serif';ctx.fillStyle=player?'#5b4a24':'#193c4c';ctx.fillText(player?'YOU':car.short,0,5);}
    if(player) {
      ctx.fillStyle='#ffe39b';ctx.beginPath();ctx.moveTo(-5,-h/2-20);ctx.lineTo(5,-h/2-20);ctx.lineTo(0,-h/2-14);ctx.fill();
    }else if(!traffic){rect(-21,-h/2-21,42,14,4,'#112635ed');ctx.fillStyle='#ecf1dc';ctx.font='700 7px sans-serif';ctx.textAlign='center';ctx.fillText(car.name,-0,-h/2-11);}
    ctx.restore();
  }
  function drawPickup(item) {
    const x=px(item.x),y=py(item.y);if(y< -40||y>height+40)return;
    const coin=item.kind==='coin',radius=coin?12:17;
    const time=race?race.elapsed:demoTime;
    ctx.save();ctx.translate(x,y);ctx.scale(scale,scale);
    circle(0,3,radius+4,'#071c2340');circle(0,0,radius+5,coin?'#ffcd5716':'#b4a1ff16');
    if(coin){circle(0,0,12,'#d79c39');circle(-1,-2,10,'#ffdb7a');circle(-1,-2,7,'#efb748');ctx.textAlign='center';ctx.fillStyle='#fff0af';ctx.font='800 12px sans-serif';ctx.fillText('$',-1,2);}
    else{rect(-17,-17,34,34,9,'#6a608e');rect(-14,-15,28,28,7,'#d2c4ef');ctx.fillStyle='#51416e';ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='900 20px sans-serif';ctx.fillText(GLYPH[item.kind],0,0);}
    if(!reduced){ctx.globalAlpha=.2+.12*Math.sin(time*3+(item.wave||0));circle(-radius*.5,-radius*.6,3,'#fff');}
    ctx.restore();
  }
  function draw() {
    roadX=mode==='home'&&width>700?width*.70:width*.5;
    camY=race?race.player.y:360+(reduced?0:(demoTime*30)%1200);
    drawWorld();
    if(race){for(const item of race.items)drawPickup(item);for(const car of race.all().sort((a,b)=>b.y-a.y))drawCar(car);}
    else {
      const offsets=[0,150,290,-180,-80];
      for(let i=0;i<5;i++)drawCar({...DRIVERS[i],type:i===3?'traffic':'racer',x:C.lanes[[1,3,0,2,0][i]],y:camY+offsets[i],speed:150});
      for(let i=0;i<3;i++)drawPickup({x:C.lanes[2],y:camY+80+i*90,kind:i===2?'nitro':'coin'});
    }
    for(const p of particles){const life=(race.elapsed-p.born)/1.1;ctx.save();ctx.globalAlpha=1-life;ctx.textAlign='center';ctx.font='800 18px sans-serif';ctx.fillStyle='#ddffb6';ctx.shadowBlur=5;ctx.shadowColor='#162735';ctx.fillText('+'+p.amount,px(p.x)+32,py(p.y)-35-life*35);ctx.restore();}
  }
  function frame(now) {
    const dt=Math.min(.1,Math.max(0,(now-last)/1000||0));last=now;
    if(mode==='playing') {
      race.advance(dt);consumeEvents();hudClock+=dt;
      if(hudClock>=.10){hudClock=0;updateHUD();}
      if(race.state==='ended')showResult();
    }else if(mode==='home')demoTime+=dt;
    draw();requestAnimationFrame(frame);
  }
  for(const key of ['left','right','brake']) {
    const button=$(key==='brake'?'brakeBtn':key+'Btn');
    button.addEventListener('pointerdown',e=>{if(mode!=='playing')return;e.preventDefault();pointerInput[key].add(e.pointerId);try{button.setPointerCapture(e.pointerId);}catch{}syncInput();});
    for(const event of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(event,e=>{pointerInput[key].delete(e.pointerId);syncInput();});
    button.addEventListener('contextmenu',e=>e.preventDefault());
  }
  const bindings={a:'left',arrowleft:'left',d:'right',arrowright:'right',' ':'brake',s:'brake',arrowdown:'brake'};
  window.addEventListener('keydown',e=>{
    const key=e.key.toLowerCase();
    if(mode==='playing'&&bindings[key]){e.preventDefault();keyInput[bindings[key]]=true;syncInput();}
    if(key==='e'&&mode==='playing'&&!e.repeat){e.preventDefault();useItem();}
    if((key==='p'||key==='escape')&&!e.repeat&&(mode==='playing'||mode==='paused')){e.preventDefault();pause();}
  });
  window.addEventListener('keyup',e=>{const key=bindings[e.key.toLowerCase()];if(key){keyInput[key]=false;syncInput();}});
  window.addEventListener('blur',()=>{clearInput();if(mode==='playing')pause();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&mode==='playing')pause();});
  $('startBtn').addEventListener('click',start);$('againBtn').addEventListener('click',start);$('itemBtn').addEventListener('click',useItem);
  $('pauseBtn').addEventListener('click',pause);$('resumeBtn').addEventListener('click',pause);$('leaveBtn').addEventListener('click',home);$('endHomeBtn').addEventListener('click',home);
  $('rankToggle').addEventListener('click',()=>{const open=$('rankBox').classList.toggle('open');$('rankToggle').setAttribute('aria-expanded',String(open));});
  $('muteBtn').addEventListener('click',()=>{muted=!muted;$('muteBtn').textContent=muted?'♪':'♫';$('muteBtn').setAttribute('aria-pressed',String(muted));$('muteBtn').setAttribute('aria-label',muted?'开启音效':'关闭音效');});
  document.querySelectorAll('.mode').forEach(button=>button.addEventListener('click',()=>{duration=Number(button.dataset.seconds);document.querySelectorAll('.mode').forEach(b=>{const active=button===b;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});}));
  new ResizeObserver(resize).observe(shell);resize();renderWallet();overlay('home');requestAnimationFrame(frame);
  // Mutating test hooks are opt-in; production opens without a debug API.
  if(new URLSearchParams(location.search).has('test'))window.__redLightDebug={
    get:()=>({mode,wallet,saved,state:race?.state,elapsed:race?.elapsed,duration:race?.duration,reason:race?.reason,input:{...race?.input},cars:race?.cars.map(c=>({id:c.id,x:c.x,y:c.y,speed:c.speed,score:c.score,item:c.item})),trafficCount:race?.traffic.length,itemCount:race?.items.length}),
    start:(seconds=60)=>{duration=seconds;start();},
    advance:seconds=>{if(mode==='playing'){race.advance(seconds);consumeEvents();updateHUD();if(race.state==='ended')showResult();draw();}},
    scenario:name=>{
      if(!race)start();race.traffic=[];race.items=[];race.world=false;
      race.cars.slice(1).forEach((c,i)=>{c.x=126;c.y=-500-i*150;});
      const p=race.player;p.x=-42;p.prevX=-42;p.speed=200;
      if(name==='red-light'){race.elapsed=15;p.y=C.firstSignal-38;p.prevY=p.y;p.lastStop=-1;}
      if(name==='item'){race.items=[{x:p.x,y:p.y+45,kind:'nitro',id:'test-pickup'}];}
      if(name==='negative'){race.cars.forEach((c,i)=>{c.score=i===0?0:600-i*90;});}
      updateHUD();draw();
    },
    finish:()=>{if(mode==='playing'){race.finish();showResult();}},
    draw
  };
})();
