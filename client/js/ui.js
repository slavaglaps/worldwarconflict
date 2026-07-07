/* ── окно «Политика»: обзор всех фракций и дипломатии ────────── */
let polWinOpen=false, polRows={}, polSig='';
const hex6=c=>'#'+c.toString(16).padStart(6,'0');
function relSignature(){return FACTIONS.map(f=>relation(PLAYER,f.id)).join('|');}
const RSTAT={war:['Противник','#ff6a52'],ally:['Союзник','#7fe0a6'],neutral:['Нейтралитет','#8a9a82']};
let polMaxPow=1;
function relInfo(fid){
  const rel=relation(PLAYER,fid);
  if(rel==='war'){const cd=warCountdown(PLAYER,fid);return {cls:'war',txt:'⚔ ВОЙНА',sub:cd>0?`⏳ ${Math.ceil(cd)}с`:'✓'};}
  if(rel==='ally')return {cls:'ally',txt:'🤝 СОЮЗ',sub:''};
  const tl=truceLeft(PLAYER,fid);
  return {cls:'neutral',txt:'НЕЙТРАЛИТЕТ',sub:tl>0?`🕊 ${Math.ceil(tl)}с`:'—'};
}
function _polNC(fid){return cities.filter(c=>c.owner===fid).length;}
function _polArmy(fid){return Math.round(cities.filter(c=>c.owner===fid).reduce((s,c)=>s+c.units,0));}
function _powBar(fid){const pow=factionPower(fid);return Math.max(6,Math.min(100,pow/(polMaxPow||pow)*100));}
function buildPolRow(fid){
  const f=FACTIONS[fid], rel=relation(PLAYER,fid), ri=relInfo(fid), rs=RSTAT[rel];
  const pow=factionPower(fid);
  const barCol=rel==='war'?'#e0533f':rel==='ally'?'#4fc77a':'#3aa6ff';
  const row=document.createElement('div'); row.className='pRow'; row.dataset.rel=rel;
  row.innerHTML=
    `<div class="fcell"><div class="hflag">${flagHexSVG(f.country,46)}</div>`+
      `<div><div class="nm">${f.country}</div><div class="rstat" style="color:${rs[1]}">${rs[0]}</div></div></div>`+
    `<div class="ctr pwr"><div class="pnum">${pow}</div><div class="pbar"><i class="pbari" style="width:${_powBar(fid)}%;background:${barCol}"></i></div></div>`+
    `<div class="ctr big cCity">${_polNC(fid)}</div>`+
    `<div class="ctr big cArmy">${_polArmy(fid)}</div>`+
    `<div class="ctr"><span class="relbadge ${ri.cls}">${ri.txt}</span><div class="relsub">${ri.sub}</div></div>`+
    `<div class="acts"></div>`;
  const acts=row.querySelector('.acts');
  const ab=(cls,t,c,fn,title)=>{const b=document.createElement('div');b.className='ab '+cls;b.innerHTML=`<div class="t">${t}</div>`+(c?`<div class="c">${c}</div>`:'');if(title)b.title=title;b.onclick=()=>{fn();buildPolWindow();};acts.appendChild(b);};
  const abIcon=(cls,ic,title)=>{const b=document.createElement('div');b.className='ab icon '+cls+' dis';b.textContent=ic;if(title)b.title=title;acts.appendChild(b);};
  if(rel==='neutral'){
    ab('war','Война',`${POLIT_WAR} 🏛`,()=>declareWar(fid),'Объявить войну');
    ab('ally','Союз',`${POLIT_ALLY} 🏛`,()=>formAlliance(fid),'Заключить союз');
    ab('sup','Помощь','',()=>sendSupport(fid),'Отправить поддержку');
  } else if(rel==='war'){
    abIcon('ally','🤝','Союз недоступен во время войны');
    ab('peace','Мир',`${POLIT_PEACE} 🏛`,()=>openPeaceDialog(fid),'Переговоры о мире');
  } else if(rel==='ally'){
    ab('war','Война',`${POLIT_WAR} 🏛`,()=>{if(!politEnough(POLIT_WAR))return;setRelation(PLAYER,fid,'neutral');declareWar(fid);},'Война + разрыв союза');
    ab('sup','Разрыв',`${POLIT_BREAK} 🏛`,()=>breakAlliance(fid),'Расторгнуть союз');
    ab('sup','Помощь','',()=>sendSupport(fid),'Отправить поддержку');
  }
  return row;
}
function buildPolWindow(){
  document.getElementById('polPts').textContent=Math.floor(politPts[PLAYER]||0);
  const list=document.getElementById('polList'); list.innerHTML=''; polRows={};
  const others=FACTIONS.filter(f=>f.id!==PLAYER&&cities.some(c=>c.owner===f.id));
  polMaxPow=factionPower(PLAYER); for(const f of others)polMaxPow=Math.max(polMaxPow,factionPower(f.id));
  const order=r=>r==='war'?0:r==='ally'?1:2;
  others.sort((a,b)=>{
    const ra=order(relation(PLAYER,a.id)), rb=order(relation(PLAYER,b.id));
    return ra!==rb?ra-rb:factionPower(b.id)-factionPower(a.id);
  });
  for(const f of others){const row=buildPolRow(f.id);polRows[f.id]=row;list.appendChild(row);}
  polSig=relSignature();
}
function refreshPol(){
  if(!polWinOpen)return;
  document.getElementById('polPts').textContent=Math.floor(politPts[PLAYER]||0);
  polMaxPow=factionPower(PLAYER); for(const fid in polRows)polMaxPow=Math.max(polMaxPow,factionPower(+fid));
  // фоном обновляем числа; строку пересобираем ТОЛЬКО при смене нашего отношения (иначе теряются клики)
  for(const fid in polRows){
    const id=+fid, row=polRows[fid], rel=relation(PLAYER,id);
    if(row.dataset.rel!==rel){ const nrow=buildPolRow(id); polRows[fid]=nrow; row.replaceWith(nrow); continue; }
    const pn=row.querySelector('.pnum'); if(pn)pn.textContent=factionPower(id);
    const bar=row.querySelector('.pbari'); if(bar)bar.style.width=_powBar(id)+'%';
    const cc=row.querySelector('.cCity'); if(cc)cc.textContent=_polNC(id);
    const ca=row.querySelector('.cArmy'); if(ca)ca.textContent=_polArmy(id);
    const sub=row.querySelector('.relsub'); if(sub)sub.textContent=relInfo(id).sub;
  }
}
function openPol(){polWinOpen=true;buildPolWindow();document.getElementById('polWin').style.display='flex';}
function closePol(){polWinOpen=false;document.getElementById('polWin').style.display='none';}
document.getElementById('sbPol').onclick=()=>{polWinOpen?closePol():openPol();};
document.getElementById('polClose').onclick=closePol;
document.getElementById('polWin').addEventListener('click',e=>{if(e.target.id==='polWin')closePol();});

/* ── 🎖 ГЕРОИ: панель слотов + окно призыва ─────────────────── */
// тултип по способности (переиспользуем #techTip)
function showHeroTip(ev,ab){ const t=document.getElementById('techTip'); if(!t)return;
  t.innerHTML=`<b>${ab.icon} ${ab.name}</b><div class="te">${ab.desc}</div><div class="ts2">${ab.kind==='active'?`Активная · КД ${ab.cd}с`:'Пассивная — всегда активна'}</div>`;
  t.style.display='block'; moveHeroTip(ev); }
function moveHeroTip(ev){ const t=document.getElementById('techTip'); if(!t||t.style.display==='none')return;
  const r=ev?.currentTarget?.getBoundingClientRect?.();
  const cx=Number.isFinite(ev?.clientX)?ev.clientX:(r?r.left+r.width/2:innerWidth/2);
  const cy=Number.isFinite(ev?.clientY)?ev.clientY:(r?r.top+r.height/2:innerHeight/2);
  const w=t.offsetWidth||286, h=t.offsetHeight||90;
  let x=cx+16, y=cy-h-14;
  if(x+w>innerWidth-8)x=cx-w-16;
  if(y<8)y=cy+16;
  t.style.left=Math.max(8,x)+'px'; t.style.top=Math.max(8,Math.min(innerHeight-h-8,y))+'px'; }
function hideHeroTip(){ const t=document.getElementById('techTip'); if(t)t.style.display='none'; }
const HERO_RARITY={
  sterling:{label:'Легендарный',marks:'◆◆◆',col:'#d4a64d'},
  hans:{label:'Редкий',marks:'◆◆',col:'#5d9cc7'},
  vance:{label:'Эпический',marks:'◆◆◆',col:'#8a62c9'},
  gold:{label:'Обычный',marks:'◆',col:'#9aa1a8'},
  volk:{label:'Эпический',marks:'◆◆◆',col:'#8a62c9'},
  storm:{label:'Мифический',marks:'◆◆◆',col:'#d56e42'},
};
function bindHeroAbilityTip(el,ab){
  el.title=`${ab.name} — ${ab.desc}`;
  el.tabIndex=0;
  for(const e of ['mouseenter','pointerenter','focus'])el.addEventListener(e,ev=>showHeroTip(ev,ab));
  for(const e of ['mousemove','pointermove'])el.addEventListener(e,moveHeroTip);
  for(const e of ['mouseleave','pointerleave','blur'])el.addEventListener(e,hideHeroTip);
}
// полная пересборка панели (только при смене состава героев / рестарте — не в тике!)
function buildHeroBar(){
  const bar=document.getElementById('heroBar'); if(!bar)return; bar.innerHTML='';
  const hs=heroSlots[PLAYER]||[];
  for(const h of hs){
    const d=heroDef(h.id); if(!d)continue;
    const slot=document.createElement('div'); slot.className='heroSlot';
    const abrow=document.createElement('div'); abrow.className='abrow';
    const actives=d.abilities.filter(a=>a.kind==='active');
    h._abEls={};
    for(const ab of d.abilities){
      const el=document.createElement('div'); el.className='ab'+(ab.kind==='passive'?' passive':''); el.textContent=ab.icon;
      bindHeroAbilityTip(el,ab);
      if(ab.kind==='active'){
        const ai=actives.indexOf(ab);
        const cdov=document.createElement('div'); cdov.className='cd'; cdov.style.display='none'; el.appendChild(cdov);
        el.addEventListener('click',()=>{hideHeroTip();activateHeroAbility(PLAYER,h,d.abilities.indexOf(ab));});
        h._abEls[ai]=el;
      }
      abrow.appendChild(el);
    }
    const av=document.createElement('div'); av.className='av'; av.style.background=d.col; av.textContent=d.face; av.title=d.name;
    slot.appendChild(abrow); slot.appendChild(av); bar.appendChild(slot);
  }
  if(hs.length<HERO_SLOTS_MAX){                // есть свободный слот → кнопка призыва (и в онлайне тоже)
    const slot=document.createElement('div'); slot.className='heroSlot';
    const sp=document.createElement('div'); sp.className='abrow';
    const av=document.createElement('div'); av.className='av add'; av.textContent='+'; av.title='Призвать героя за манпауэр';
    av.addEventListener('click',openHeroPick);
    slot.appendChild(sp); slot.appendChild(av); bar.appendChild(slot);
  }
  refreshHeroBar();
}
// лёгкое обновление в тике: только оверлеи перезарядки (кликабельные элементы НЕ пересоздаём)
function refreshHeroBar(){
  const hs=heroSlots[PLAYER]||[];
  for(const h of hs){ if(!h._abEls)continue; const d=heroDef(h.id); if(!d)continue;
    const actives=d.abilities.filter(a=>a.kind==='active');
    for(let ai=0;ai<actives.length;ai++){ const el=h._abEls[ai]; if(!el)continue;
      const cd=(h.cd&&h.cd[ai])||0; const ov=el.querySelector('.cd'); if(!ov)continue;
      if(cd>0){ov.style.display='flex';ov.textContent=Math.ceil(cd);}else ov.style.display='none'; } }
}
function buildHeroPick(){
  const list=document.getElementById('heroList'); if(!list)return; list.innerHTML='';
  const hs=heroSlots[PLAYER]||[]; const owned=new Set(hs.map(h=>h.id)); const free=hs.length<HERO_SLOTS_MAX;
  const mp=document.getElementById('heroMp'); if(mp)mp.textContent=Math.floor(manpower[PLAYER]||0);
  const fs=document.getElementById('heroFreeSlots'); if(fs)fs.textContent=Math.max(0,HERO_SLOTS_MAX-hs.length);
  const ms=document.getElementById('heroMaxSlots'); if(ms)ms.textContent=HERO_SLOTS_MAX;
  for(const d of HEROES){
    const rarity=HERO_RARITY[d.id]||{label:'Герой',marks:'◆',col:d.col};
    const row=document.createElement('div'); row.className='hpick heroCardPick'; row.style.setProperty('--hero-col',d.col);
    row.style.setProperty('--rarity-col',rarity.col);
    if(d.portrait){ row.classList.add('hasPortrait'); row.style.setProperty('--hero-img',`url("${d.portrait}")`); }
    if(owned.has(d.id))row.classList.add('owned');
    if(!free&&!owned.has(d.id))row.classList.add('locked');
    const portrait=document.createElement('div'); portrait.className='heroPortrait';
    portrait.innerHTML=`<div class="heroRarity">${rarity.label}</div><div class="heroMarks">${rarity.marks}</div><div class="heroFace">${d.face}</div><div class="heroGlow"></div>`;
    const body=document.createElement('div'); body.className='body';
    const passive=d.abilities.find(a=>a.kind==='passive')||d.abilities[0];
    body.innerHTML=`<div class="nm">${d.name}</div><div class="heroRole"><span>${passive.icon}</span>${passive.name}</div>`;
    const abs=document.createElement('div'); abs.className='abs';
    for(const ab of d.abilities){
      const el=document.createElement('div'); el.className='heroPickAb '+(ab.kind==='passive'?'passive':'active');
      el.innerHTML=`<span>${ab.icon}</span>`;
      bindHeroAbilityTip(el,ab);
      el.addEventListener('click',ev=>{ ev.stopPropagation(); showHeroTip(ev,ab); });
      abs.appendChild(el);
    }
    body.appendChild(abs);
    const btn=document.createElement('button'); btn.className='summon';
    if(owned.has(d.id)){ btn.textContent='✓ Призван'; btn.classList.add('dis'); }
    else { btn.innerHTML=`Призвать · 👥 ${HERO_SUMMON_MP}`; if(!free||(manpower[PLAYER]||0)<HERO_SUMMON_MP)btn.classList.add('dis');
      btn.addEventListener('click',()=>summonHero(d.id)); }
    row.appendChild(portrait); row.appendChild(body); row.appendChild(btn); list.appendChild(row);
  }
}
function summonHero(id){
  const hs=heroSlots[PLAYER]||(heroSlots[PLAYER]=[]);
  if(hs.length>=HERO_SLOTS_MAX){toast(`Все слоты героев заняты (${HERO_SLOTS_MAX})`);return;}
  if(hs.some(h=>h.id===id)){toast('Этот герой уже призван');return;}
  if((manpower[PLAYER]||0)<HERO_SUMMON_MP){toast(`👥 Не хватает манпауэра (нужно ${HERO_SUMMON_MP})`);return;}
  if(MP.guest){ MP.cmd({cmd:'summon', id}); toast('🎖 Призыв…'); return; }   // онлайн: сервер спишет манпауэр и пришлёт обновлённые слоты в balance
  const d=heroDef(id); if(!d)return;
  manpower[PLAYER]-=HERO_SUMMON_MP;
  hs.push({id, cd:d.abilities.filter(a=>a.kind==='active').map(()=>0)});
  toast(`🎖 Призван ${d.name}`);
  buildHeroBar(); buildHeroPick();
}
function openHeroPick(){ buildHeroPick(); document.getElementById('heroWin').style.display='flex'; }
function closeHeroPick(){ document.getElementById('heroWin').style.display='none'; }
document.getElementById('heroClose').onclick=closeHeroPick;
document.getElementById('heroWin').addEventListener('click',e=>{if(e.target.id==='heroWin')closeHeroPick();});

// переговоры о мире (игрок предлагает)
document.getElementById('peacePropose').onclick=proposePeace;
document.getElementById('peacePropose').textContent=`Предложить мир (${POLIT_PEACE}🏛)`; // один раз: кнопку не мутируем в рефреше (иначе теряются клики)
document.getElementById('peaceCancel').onclick=closePeace;
document.getElementById('ptLandBtn').onclick=e=>{
  e.stopPropagation();
  if(!occCount(PLAYER,peaceTarget)){peaceLand=false;refreshPeaceDialog();return;}
  peaceLand=!peaceLand;
  refreshPeaceDialog();
};
// условия мира — делегирование на карточке (refresh не пересобирает кнопки → клики не теряются)
document.getElementById('peaceCard').addEventListener('click',e=>{
  const b=e.target.closest('button[data-r]'); if(!b)return;
  if(b.dataset.r==='land')return;
  else { const d=b.dataset.d; let v=b.dataset.r==='money'?peaceMoney:peaceRepar;
    v = d==='max'?100:Math.max(0,Math.min(100,v+(+d)));
    if(b.dataset.r==='money')peaceMoney=v; else peaceRepar=v; }
  refreshPeaceDialog();
});
document.getElementById('peaceWin').addEventListener('click',e=>{if(e.target.id==='peaceWin')closePeace();});
// предложение мира от ИИ
document.getElementById('peaceOfferYes').onclick=acceptPlayerPeace;
document.getElementById('peaceOfferNo').onclick=declinePlayerPeace;
document.getElementById('peaceResultOk').onclick=closePeaceResult;
document.getElementById('peaceResult').addEventListener('click',e=>{if(e.target.id==='peaceResult')closePeaceResult();});

['diploCard','peaceCard','peaceOfferCard','peaceResultCard','warNotifCard'].forEach(id=>{
  const el=document.getElementById(id);
  if(!el)return;
  ['pointerdown','pointerup','mousedown','mouseup','click','dblclick'].forEach(type=>{
    el.addEventListener(type,e=>e.stopPropagation());
  });
});

/* ── ИИ и конец игры — в серверном Sim (бывшие aiUpdate/aiActFaction/checkEnd удалены) ── */
let factionTimer=[];
