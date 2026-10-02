/* Shared simulation: browser and Node tests execute this same implementation. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RedLight = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const CONFIG = Object.freeze({lane:84, lanes:[-126,-42,42,126], roadHalf:184,
    firstSignal:1700, signalGap:2400, green:12, yellow:3, red:5,
    step:1/120, brake:600, chunk:1200, pickupRadius:17, coinRadius:12});
  const DRIVERS = [
    {id:'player',name:'你',short:'YOU',color:'#ffc857',base:230},
    {id:'turtle',name:'老实龟',short:'01',color:'#58d6a4',base:206},
    {id:'lightning',name:'红色闪电',short:'02',color:'#ff717a',base:244},
    {id:'master',name:'超车大师',short:'03',color:'#65bfff',base:232},
    {id:'lucky',name:'幸运星',short:'04',color:'#b8a0ff',base:218},
    {id:'extreme',name:'极限车手',short:'05',color:'#ffab70',base:225}
  ];
  const ITEM_LABEL = {nitro:'氮气加速',double:'双倍金币',magnet:'金币磁铁',brake:'紧急刹车'};
  const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
  const move = (v,t,d) => v<t ? Math.min(t,v+d) : Math.max(t,v-d);
  const noise = n => {const a=Math.sin(n*78.233+12.88)*43758.5453;return a-Math.floor(a);};
  const halfW = c => c.type==='traffic'?19:22;
  const halfH = c => c.type==='traffic'?34:37;
  const overlap = (a,b,gap=0) => Math.abs(a.x-b.x)<halfW(a)+halfW(b)+gap && Math.abs(a.y-b.y)<halfH(a)+halfH(b)+gap;
  function rankCars(cars) {
    return [...cars].sort((a,b)=>b.score-a.score||b.overtakes-a.overtakes||a.fines-b.fines||a.lastScoreTime-b.lastScoreTime||a.order-b.order);
  }
  function settle(cars) {
    if(cars.length!==6) throw new Error('Six racers are required');
    const ordered=rankCars(cars);
    const bonuses=[1,.5,.1].map((rate,i)=>Math.round(Math.max(0,ordered[i].score)*rate));
    const adjustments=[...bonuses,-bonuses[2],-bonuses[1],-bonuses[0]];
    return ordered.map((c,i)=>({id:c.id,name:c.name,color:c.color,rank:i+1,score:c.score,
      adjustment:adjustments[i]||0,final:c.score+adjustments[i],overtakes:c.overtakes,fines:c.fines,stops:c.stops,retired:c.retired}));
  }
  // Segment vs expanded pickup bounds: a fast-moving bumper cannot skip a pickup.
  function hitFraction(car,item,magnet=false) {
    const r=item.kind==='coin'?CONFIG.coinRadius:CONFIG.pickupRadius;
    const w=magnet?135:halfW(car)+r, h=magnet?115:halfH(car)+r;
    const x0=car.prevX??car.x,y0=car.prevY??car.y;
    let lo=0,hi=1;
    for(const [start,delta,center,extent] of [[x0,car.x-x0,item.x,w],[y0,car.y-y0,item.y,h]]) {
      if(Math.abs(delta)<1e-9) {if(Math.abs(start-center)>extent)return null;continue;}
      let t1=(center-extent-start)/delta,t2=(center+extent-start)/delta;
      if(t1>t2)[t1,t2]=[t2,t1];lo=Math.max(lo,t1);hi=Math.min(hi,t2);
      if(lo>hi)return null;
    }
    return lo;
  }
  class Race {
    constructor({duration=120,seed=1,world=true}={}) {
      this.duration=[60,120,180].includes(duration)?duration:120;
      this.seed=seed;this.elapsed=0;this.state='playing';this.reason=null;this.result=null;
      this.events=[];this.traffic=[];this.items=[];this.generated=new Set();this.world=world;
      this.worldTimer=0;this.input={left:false,right:false,brake:false};
      const positions=[[-42,220],[-126,260],[126,320],[42,240],[-42,70],[42,90]];
      this.cars=DRIVERS.map((d,i)=>({...d,order:i,type:'racer',x:positions[i][0],goalX:positions[i][0],
        y:positions[i][1],prevX:positions[i][0],prevY:positions[i][1],speed:0,score:0,overtakes:0,fines:0,stops:0,
        lastScoreTime:0,lastStop:-1,item:null,buffs:{},brakeUntil:0,passed:new Set(),stopped:new Set(),
        aiTimer:0,hitUntil:0,retired:false}));
      if(world)this.populate();
    }
    get player(){return this.cars[0];}
    all(){return [...this.cars,...this.traffic];}
    active(car,buff){return (car.buffs[buff]||0)>this.elapsed;}
    phase(index,time=this.elapsed) {
      const cycle=CONFIG.green+CONFIG.yellow+CONFIG.red;
      const t=((time+index*4.7+1)%cycle+cycle)%cycle;
      if(t<CONFIG.green)return {kind:'green',name:'绿灯通行',left:CONFIG.green-t,color:'#63e7b1'};
      if(t<CONFIG.green+CONFIG.yellow)return {kind:'yellow',name:'黄灯减速',left:CONFIG.green+CONFIG.yellow-t,color:'#ffd16b'};
      return {kind:'red',name:'红灯停车',left:cycle-t,color:'#ff717a'};
    }
    upcoming(car) {
      const index=Math.max(0,Math.max(car.lastStop+1,Math.ceil((car.y+halfH(car)-CONFIG.firstSignal)/CONFIG.signalGap)));
      const line=CONFIG.firstSignal+index*CONFIG.signalGap;
      return {index,line,distance:line-car.y-halfH(car),phase:this.phase(index)};
    }
    emit(text,kind='good',car=this.player,amount=0) {
      this.events.push({text,kind,id:car.id,amount,x:car.x,y:car.y,time:this.elapsed});
      if(this.events.length>40)this.events.shift();
    }
    earn(car,base,text) {
      if(car.retired)return;
      const amount=base*(this.active(car,'double')?2:1);
      car.score+=amount;car.lastScoreTime=this.elapsed;
      if(car.id==='player')this.emit(text+' +'+amount,'good',car,amount);
    }
    laneClear(ego,lane,margin=110) {
      return this.all().every(c=>c===ego || (Math.abs(c.x-lane)>=halfW(c)+halfW(ego)+12 &&
        Math.abs((c.goalX??c.x)-lane)>=halfW(c)+halfW(ego)+12) || Math.abs(c.y-ego.y)>margin);
    }
    changeLane(car) {
      const current=CONFIG.lanes.reduce((best,x,i)=>Math.abs(x-car.goalX)<Math.abs(CONFIG.lanes[best]-car.goalX)?i:best,0);
      const choices=[current-1,current+1].filter(i=>i>=0&&i<4&&this.laneClear(car,CONFIG.lanes[i]));
      const space=i=>this.all().filter(c=>c!==car&&Math.abs(c.x-CONFIG.lanes[i])<50&&c.y>car.y)
        .reduce((gap,c)=>Math.min(gap,c.y-car.y),1500);
      choices.sort((a,b)=>space(b)-space(a));
      if(!choices.length)return false;
      car.goalX=CONFIG.lanes[choices[0]];car.aiTimer=.7;return true;
    }
    stepVehicle(car,dt) {
      if(car.retired){car.speed=0;return;}
      const player=car.id==='player',traffic=car.type==='traffic';
      let target=car.base;
      if(!traffic&&this.active(car,'nitro'))target+=100;
      if(car.id==='extreme'&&this.elapsed>this.duration-20)target+=15;
      const up=this.upcoming(car);
      if(player) {
        const steer=Number(this.input.right)-Number(this.input.left);
        car.x=clamp(car.x+steer*225*dt,-CONFIG.roadHalf+halfW(car)+4,CONFIG.roadHalf-halfW(car)-4);
        if(this.input.brake||this.elapsed<car.brakeUntil)target=0;
        car.speed=move(car.speed,target,(target===0?CONFIG.brake:180)*dt);
      } else {
        const front=this.all().filter(c=>c!==car&&c.y>car.y&&c.y-car.y<260&&Math.abs(c.x-(car.goalX??car.x))<halfW(car)+halfW(c)+9)
          .sort((a,b)=>a.y-b.y)[0];
        if(!traffic) {
          car.aiTimer=Math.max(0,car.aiTimer-dt);
          if(front&&car.aiTimer<=0&&front.y-car.y<220&&front.speed<target-10)this.changeLane(car);
          car.x=move(car.x,car.goalX,145*dt);
        }
        if(front&&Math.abs(front.x-(car.goalX??car.x))<halfW(car)+halfW(front)+9) {
          const gap=front.y-car.y-halfH(car)-halfH(front)-12;
          target=Math.min(target,Math.max(0,front.speed+gap*1.4));
        }
        const shouldStop=up.phase.kind==='red'||(up.phase.kind==='yellow'&&up.distance>car.speed*car.speed/(2*420)+15);
        if(shouldStop&&up.distance>=0&&up.distance<450)target=Math.min(target,Math.sqrt(Math.max(0,up.distance-12)*2*360));
        if(!traffic&&this.elapsed<car.brakeUntil)target=0;
        car.speed=move(car.speed,target,420*dt);
        if(!traffic&&car.item) {
          if(car.item==='double'||car.item==='magnet')this.useItem(car);
          else if(car.item==='nitro'&&up.distance>650)this.useItem(car);
          else if(car.item==='brake'&&shouldStop&&up.distance<100&&car.speed>120)this.useItem(car);
        }
      }
      car.y+=Math.max(0,car.speed)*dt;
      // Traffic and AI have the same visible stop line, with a small braking buffer.
      if(!player&&(up.phase.kind==='red'||up.phase.kind==='yellow')&&up.distance>=0&&car.y+halfH(car)>up.line-8 &&
        (up.phase.kind==='red'||up.distance>car.prevSpeed*car.prevSpeed/(2*420)+15)) {
        car.y=Math.max(car.prevY,up.line-halfH(car)-8);car.speed=0;
      }
      if(!traffic&&up.phase.kind==='red'&&up.distance>=0&&up.distance<130&&car.speed<8)car.stopped.add(up.index);
    }
    resolveCollisions() {
      const cars=this.all().sort((a,b)=>b.y-a.y);
      // Separation runs every step; only audiovisual feedback has a cooldown.
      for(let pass=0;pass<12;pass++) {
        let changed=false;
        for(let i=0;i<cars.length;i++)for(let j=i+1;j<cars.length;j++) {
          const a=cars[i],b=cars[j];
          if(!overlap(a,b,1))continue;
          const width=halfW(a)+halfW(b)+1.05,height=halfH(a)+halfH(b)+1.05;
          const wasSide=Math.abs(a.prevX-b.prevX)>=width-1.1&&Math.abs(a.prevY-b.prevY)<height;
          if(wasSide) {
            // Cancel the inward move. Never shove another car across a red line.
            a.x=a.prevX;b.x=b.prevX;
            if(a.id!=='player'&&a.type!=='traffic'){a.goalX=CONFIG.lanes.reduce((x,y)=>Math.abs(y-a.x)<Math.abs(x-a.x)?y:x);a.aiTimer=.4;}
            if(b.id!=='player'&&b.type!=='traffic'){b.goalX=CONFIG.lanes.reduce((x,y)=>Math.abs(y-b.x)<Math.abs(x-b.x)?y:x);b.aiTimer=.4;}
            if(Math.abs(a.x-b.x)<width) {
              const left=a.x<=b.x?a:b,right=left===a?b:a;
              const correction=width-(right.x-left.x);
              left.x-=correction/2;right.x+=correction/2;
            }
          } else {
            const front=a.prevY>b.prevY?a:b,rear=front===a?b:a;
            rear.y=Math.min(rear.y,front.y-height);
            rear.speed=Math.min(rear.speed,front.speed);
          }
          changed=true;
          if((a.id==='player'||b.id==='player')&&this.player.hitUntil<=this.elapsed) {
            this.player.hitUntil=this.elapsed+.8;this.emit('发生碰撞 · 松开方向，寻找空隙','bad');
          }
        }
        if(!changed)break;
      }
    }
    checkSignals(car,dt,startTime) {
      const nose=car.y+halfH(car),previous=car.prevY+halfH(car);
      while(nose>=CONFIG.firstSignal+(car.lastStop+1)*CONFIG.signalGap) {
        const index=++car.lastStop,line=CONFIG.firstSignal+index*CONFIG.signalGap;
        if(previous>line+.001)continue;
        const f=clamp((line-previous)/Math.max(.000001,nose-previous),0,1);
        const phase=this.phase(index,startTime+dt*f);
        if(car.type==='traffic')continue;
        if(phase.kind==='red') {
          car.fines++;car.retired=true;car.speed=0;
          if(car.id==='player'){this.finish('red-light');return;}
          this.emit(car.name+' 闯红灯，停止参赛','bad',car);
        } else if(car.stopped.has(index)) {
          car.stops++;this.earn(car,5,'守法停车奖励');
        }
        car.stopped.delete(index);
      }
    }
    useItem(car=this.player) {
      if(this.state!=='playing'||car.retired||!car.item)return false;
      const kind=car.item;car.item=null;
      if(kind==='brake'){car.speed=0;car.brakeUntil=this.elapsed+1.2;}
      else car.buffs[kind]=this.elapsed+({nitro:4,double:8,magnet:8}[kind]);
      if(car.id==='player')this.emit(ITEM_LABEL[kind]+'已启用','item');
      return true;
    }
    pickups() {
      for(let i=this.items.length-1;i>=0;i--) {
        const item=this.items[i];let owner=null,first=Infinity;
        for(const car of this.cars) {
          if(car.retired)continue;
          const hit=hitFraction(car,item,item.kind==='coin'&&this.active(car,'magnet'));
          if(hit!==null&&hit<first){owner=car;first=hit;}
        }
        if(!owner)continue;
        this.items.splice(i,1);
        if(item.kind==='coin')this.earn(owner,5,'拾取金币');
        else if(owner.item)this.earn(owner,5,'道具槽已满 · 转换金币');
        else {owner.item=item.kind;if(owner.id==='player')this.emit('拾取'+ITEM_LABEL[item.kind]+' · 点击道具使用','item');}
      }
    }
    overtakes() {
      for(const car of this.cars) {
        if(car.retired)continue;
        for(const other of this.all()) {
          if(other===car||car.passed.has(other.id))continue;
          if(car.prevY-halfH(car)<=other.prevY+halfH(other)&&car.y-halfH(car)>other.y+halfH(other)) {
            car.passed.add(other.id);car.overtakes++;
            this.earn(car,other.type==='traffic'?10:20,other.type==='traffic'?'完整超越交通车':'超越'+other.name);
          }
        }
      }
    }
    populate() {
      const racers=this.cars.filter(c=>!c.retired);
      for(const car of racers) {
        const start=Math.max(0,Math.floor((car.y-500)/CONFIG.chunk)),end=Math.floor((car.y+1900)/CONFIG.chunk);
        for(let chunk=start;chunk<=end;chunk++) {
          if(this.generated.has(chunk))continue;
          this.generated.add(chunk);const rnd=k=>noise(this.seed*71+chunk*97+k*19);
          for(let n=0;n<3;n++) {
            const y=chunk*CONFIG.chunk+590+n*340;
            const x=CONFIG.lanes[Math.floor(rnd(n)*4)];
            if(this.all().some(c=>Math.abs(c.y-y)<160&&Math.abs(c.x-x)<60))continue;
            const base=105+rnd(14+n)*42;
            this.traffic.push({id:'traffic-'+chunk+'-'+n,type:'traffic',x,y,goalX:x,prevX:x,prevY:y,speed:base,base,
              lastStop:Math.floor((y+34-CONFIG.firstSignal)/CONFIG.signalGap),color:['#a4c6cf','#f1ece0','#b7cbb2','#d6acac'][Math.floor(rnd(n+8)*4)]});
          }
          const lane=CONFIG.lanes[Math.floor(rnd(30)*4)];
          for(let n=0;n<3;n++) {
            const y=chunk*CONFIG.chunk+(n<2?450+n*85:1000);
            const index=Math.round((y-CONFIG.firstSignal)/CONFIG.signalGap),line=CONFIG.firstSignal+index*CONFIG.signalGap;
            if(index>=0&&Math.abs(y-line)<180)continue;
            this.items.push({id:'item-'+chunk+'-'+n,x:n<2?lane:CONFIG.lanes[Math.floor(rnd(42)*4)],y,
              kind:n<2?'coin':['nitro','double','magnet','brake'][Math.floor(rnd(47)*4)],wave:rnd(n+50)*6});
          }
        }
      }
      // Resources are shared and generated around every racer, independent of the camera.
      const near=y=>racers.some(c=>y>c.y-750&&y<c.y+3600);
      this.traffic=this.traffic.filter(c=>near(c.y));this.items=this.items.filter(i=>near(i.y));
    }
    advance(seconds) {
      if(this.state!=='playing'||!Number.isFinite(seconds)||seconds<=0)return;
      let remaining=Math.min(seconds,this.duration-this.elapsed);
      while(remaining>1e-8&&this.state==='playing') {
        const dt=Math.min(CONFIG.step,remaining);this.step(dt);remaining-=dt;
      }
    }
    step(dt) {
      if(this.state!=='playing')return;
      const start=this.elapsed;this.elapsed=Math.min(this.duration,this.elapsed+dt);
      for(const c of this.all()){c.prevX=c.x;c.prevY=c.y;c.prevSpeed=c.speed;}
      for(const c of this.all())this.stepVehicle(c,dt);
      this.resolveCollisions();
      // Detect violations only after resolved movement, before any score changes this step.
      for(const c of this.all()){this.checkSignals(c,dt,start);if(this.state!=='playing')return;}
      this.overtakes();this.pickups();
      this.worldTimer-=dt;if(this.world&&this.worldTimer<=0){this.populate();this.worldTimer=.6;}
      if(this.elapsed>=this.duration-1e-8){this.elapsed=this.duration;this.finish('time');}
    }
    finish(reason='time') {
      if(this.result)return this.result;
      this.state='ended';this.reason=reason;this.input={left:false,right:false,brake:false};
      this.result=settle(this.cars);return this.result;
    }
    pause(){if(this.state==='playing'){this.state='paused';this.input={left:false,right:false,brake:false};}}
    resume(){if(this.state==='paused')this.state='playing';}
  }
  return {CONFIG,DRIVERS,ITEM_LABEL,Race,rankCars,settle,halfW,halfH,overlap,hitFraction,noise,clamp};
});
