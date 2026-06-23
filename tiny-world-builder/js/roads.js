/* ── граф дорог: равнины/перевалы/переправы ─────────────────── */
// SQUAD_SPEED, PASS_MULT, FERRY_MULT, MAX_LINK (карта ×2: дистанции вдвое больше) — из _rules.gen.js
// FIGHT_RATE, SIEGE_ATK, SIEGE_DEF (урон/сек: поле, штурм, оборона города) — из _rules.gen.js
const EDGES=[], ADJ=new Map(), EDGE_BY_KEY=new Map();
const CITY_INDEX_BY_NAME={}; CITY_LIST.forEach((c,i)=>CITY_INDEX_BY_NAME[c[0]]=i);
// ключевые морские пути: Ла-Манш, Ирландское море, Балтика, Адриатика
const FERRY_LINKS=[['Лондон','Париж'],['Дублин','Манчестер'],['Дублин','Глазго'],
  ['Копенгаген','Гамбург'],['Копенгаген','Осло'],['Мальмё','Копенгаген'],['Стокгольм','Хельсинки'],
  ['Неаполь','Афины'],
  // острова и переправы новых стран
  ['Пальма','Барселона'],['Пальма','Валенсия'],
  ['Торсхавн','Берген'],['Торсхавн','Орхус'],
  ['Таллин','Хельсинки'],['Стокгольм','Таллин'],
  ['Палермо','Неаполь'],['Стамбул','Бурса'],
  ['Ираклион','Афины'],['Афины','Салоники'],['Афины','Измир'],
  ['Махачкала','Баку']];

const edgeKey=(a,b)=>a<b?a+'_'+b:b+'_'+a;
const getEdge=(a,b)=>EDGE_BY_KEY.get(edgeKey(a,b));
const cityPos=i=>({x:CITY_DATA[i][0], z:CITY_DATA[i][1]});

// промер рельефа по прямой между городами
function classifyLink(a,b){
  const A=cityPos(a),B=cityPos(b);
  const len=Math.hypot(B.x-A.x,B.z-A.z);
  const steps=Math.max(2,Math.ceil(len/0.5));
  let maxH=0, run=0, runBest=0;
  for(let s=0;s<=steps;s++){
    const x=Math.round(A.x+(B.x-A.x)*s/steps), z=Math.round(A.z+(B.z-A.z)*s/steps);
    const t=tiles[x]?.[z];
    if(!t||t.isWater){run++; runBest=Math.max(runBest,run);}
    else {run=0; maxH=Math.max(maxH,t.height);}
  }
  return {waterLen: runBest*(len/steps), maxH};
}

function addEdge(a,b,type){
  const key=edgeKey(a,b); if(EDGE_BY_KEY.has(key))return;
  const A=cityPos(a),B=cityPos(b);
  const len=Math.hypot(B.x-A.x,B.z-A.z);
  const mult=type==='pass'?PASS_MULT:type==='ferry'?FERRY_MULT:1;
  // полилиния по рельефу (на уровне земли)
  const steps=Math.max(2,Math.ceil(len/0.6));
  const pts=[];
  for(let s=0;s<=steps;s++){
    const x=A.x+(B.x-A.x)*s/steps, z=A.z+(B.z-A.z)*s/steps;
    pts.push(new T3.Vector3(x,getTerrainHeight(x,z),z));
  }
  const e={a,b,type,len,mult,time:len/(SQUAD_SPEED*mult),pts};
  EDGES.push(e); EDGE_BY_KEY.set(key,e);
  if(!ADJ.has(a))ADJ.set(a,[]); if(!ADJ.has(b))ADJ.set(b,[]);
  ADJ.get(a).push({to:b,e}); ADJ.get(b).push({to:a,e});
}

function buildGraph(){
  const N=CITY_DATA.length;
  for(let a=0;a<N;a++)for(let b=a+1;b<N;b++){
    const A=cityPos(a),B=cityPos(b);
    const d=Math.hypot(B.x-A.x,B.z-A.z);
    if(d>MAX_LINK)continue;
    // прунинг: если есть город-посредник заметно ближе к обоим — прямой связи нет
    let skip=false;
    for(let c=0;c<N&&!skip;c++){
      if(c===a||c===b)continue;
      const C=cityPos(c);
      if(Math.max(Math.hypot(C.x-A.x,C.z-A.z),Math.hypot(B.x-C.x,B.z-C.z))<d*0.92)skip=true;
    }
    if(skip)continue;
    const {waterLen,maxH}=classifyLink(a,b);
    if(waterLen>13)continue;                // открытое море — пути нет (карта ×2)
    if(waterLen>=3.2)addEdge(a,b,'ferry');  // заметная вода — переправа
    else addEdge(a,b,maxH>0.85?'pass':'road'); // высокие горы — перевал
  }
  // паромы-вайтлист (приоритет: даже если авто-классификация дала дорогу — делаем паром)
  for(const [n1,n2] of FERRY_LINKS){
    const a=CITY_INDEX_BY_NAME[n1],b=CITY_INDEX_BY_NAME[n2];
    if(a==null||b==null)continue;
    const ex=getEdge(a,b);
    if(ex){ ex.type='ferry'; ex.mult=FERRY_MULT; ex.time=ex.len/(SQUAD_SPEED*FERRY_MULT); }
    else addEdge(a,b,'ferry');
  }
  // связность: оторванные компоненты пришиваем ближайшей переправой
  const seen=new Set([0]), q=[0];
  while(q.length){const u=q.pop();for(const n of (ADJ.get(u)||[]))if(!seen.has(n.to)){seen.add(n.to);q.push(n.to);}}
  for(let i=0;i<N;i++){
    if(seen.has(i))continue;
    let best=-1,bd=1e9;
    for(const j of seen){
      const A=cityPos(i),B=cityPos(j);
      const d=Math.hypot(B.x-A.x,B.z-A.z);
      if(d<bd){bd=d;best=j;}
    }
    if(best>=0){
      addEdge(i,best,'ferry');
      const q2=[i]; seen.add(i);
      while(q2.length){const u=q2.pop();for(const n of (ADJ.get(u)||[]))if(!seen.has(n.to)){seen.add(n.to);q2.push(n.to);}}
    }
  }
}

/* ── визуал дорог: брусчатка на суше, буйки на переправах ───── */
function buildRoads(){
  const pavers=[],buoys=[];
  for(const e of EDGES){
    for(let i=1;i<e.pts.length-1;i++){
      const p=e.pts[i],n=e.pts[i+1];
      const t=tiles[Math.round(p.x)]?.[Math.round(p.z)];
      if(!t||t.isWater){ if(i%2===0)buoys.push(p); }
      else pavers.push({p,ang:Math.atan2(n.z-p.z,n.x-p.x),pass:e.type==='pass'});
    }
  }
  if(pavers.length){
    const im=new T3.InstancedMesh(new T3.BoxGeometry(0.34,0.045,0.15),
      new T3.MeshLambertMaterial({color:0xffffff}),pavers.length);
    const m=new T3.Matrix4(),qt=new T3.Quaternion(),eu=new T3.Euler(),one=new T3.Vector3(1,1,1);
    const cR=new T3.Color(0xd6c79b),cP=new T3.Color(0x9b9588);
    pavers.forEach((o,i)=>{
      eu.set(0,-o.ang,0); qt.setFromEuler(eu);
      m.compose(new T3.Vector3(o.p.x,o.p.y+0.03,o.p.z),qt,one);
      im.setMatrixAt(i,m); im.setColorAt(i,o.pass?cP:cR);
    });
    im.receiveShadow=true; scene.add(im);
  }
  if(buoys.length){
    const im=new T3.InstancedMesh(new T3.BoxGeometry(0.12,0.1,0.12),
      new T3.MeshLambertMaterial({color:0xf4f7fa}),buoys.length);
    const m=new T3.Matrix4();
    buoys.forEach((p,i)=>{m.makeTranslation(p.x,WATER_Y+0.05,p.z);im.setMatrixAt(i,m);});
    scene.add(im);
  }
}

/* ── поиск пути (Дейкстра): чужие узлы объезжаем по возможности ── */
function findPath(aIdx,bIdx,owner){
  // цель достижима только если своя (подкрепление) или с ней война (атака)
  const destOwner=cities[bIdx].owner;
  if(destOwner!==owner&&!atWar(owner,destOwner))return null;
  const N=cities.length;
  const dist=new Array(N).fill(Infinity), prev=new Array(N).fill(-1), done=new Array(N).fill(false);
  dist[aIdx]=0;
  for(;;){
    let u=-1,best=Infinity;
    for(let i=0;i<N;i++)if(!done[i]&&dist[i]<best){best=dist[i];u=i;}
    if(u<0||u===bIdx)break;
    done[u]=true;
    for(const n of (ADJ.get(u)||[])){
      if(done[n.to])continue;
      const no=cities[n.to].owner;
      let w=n.e.time;
      if(n.to!==bIdx){
        // промежуточные узлы: своя/союзная — проход; война — стоп (штраф); нейтрал — нельзя
        if(canPass(owner,no)){}
        else if(atWar(owner,no))w+=60;
        else continue; // нейтральная страна — прохода нет
      }
      if(dist[u]+w<dist[n.to]){dist[n.to]=dist[u]+w;prev[n.to]=u;}
    }
  }
  if(dist[bIdx]===Infinity)return null;
  const path=[]; for(let v=bIdx;v!==-1;v=prev[v])path.unshift(cities[v]);
  return {path, time:dist[bIdx]};
}

/* ── DOM-подписи: позиция через transform (без layout-reflow), запись содержимого только при изменении ──
   — иначе при вращении камеры 130+ подписей пересобирались/релейаутились каждый кадр и «багались» */
function posLab(lab,x,y){ const t=`translate(${Math.round(x)}px,${Math.round(y)}px) translate(-50%,-50%)`; if(lab._t!==t){lab._t=t;lab.style.transform=t;} }
function setLabHTML(lab,html){ if(lab._h!==html){lab._h=html;lab.innerHTML=html;} }
function setLabText(lab,txt){ if(lab._x!==txt){lab._x=txt;lab.textContent=txt;} }
function setLabColor(lab,col){ if(lab._c!==col){lab._c=col;lab.style.color=col;} }
function showLab(lab,on){ if(lab._v!==on){lab._v=on;lab.style.display=on?'block':'none';} }

