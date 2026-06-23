/* ── 🎖 ГЕРОИ (генералы): 3 слота, призыв за политочки, у каждого 1 пассив + 2 активки ── */
let HERO_SLOTS_MAX=3;   // потолок слотов (клиентский, синкается из balance). HERO_SUMMON_MP — из _rules.gen.js
let heroSlots=[];   // [fid] -> [{id, cd:[активка1,активка2]}] (макс 3); пока использует игрок
let heroBuffs=[];   // {fid,key,add,until} — временные баффы от активок (истекают по gameTime)
const HEROES=[
  {id:'sterling', name:'Маршал Стерлинг', face:'🪖', col:'#3c6e3c', cost:35, abilities:[
    {kind:'passive', icon:'🛡', name:'Несокрушимость', desc:'+20% обороне всех городов', pass:[{key:'def',add:0.20}]},
    {kind:'active', icon:'🧱', name:'Стальная стена', desc:'+120% обороне городов на 18с', cd:50, fx:{type:'buff',key:'def',add:1.2,dur:18}},
    {kind:'active', icon:'🎖', name:'Окопаться', desc:'+18 гарнизона всем твоим городам', cd:40, fx:{type:'garrison',amount:18}},
  ]},
  {id:'hans', name:'Генерал Ханс', face:'🎗', col:'#5a6b7a', cost:40, abilities:[
    {kind:'passive', icon:'⚔', name:'Бронекулак', desc:'+20% атаке армии', pass:[{key:'atk',add:0.20}]},
    {kind:'active', icon:'⚡', name:'Блицкриг', desc:'+70% атаке армии на 16с', cd:55, fx:{type:'buff',key:'atk',add:0.7,dur:16}},
    {kind:'active', icon:'🛞', name:'Танковый клин', desc:'+70% скорости армии на 14с', cd:45, fx:{type:'buff',key:'speed',add:0.7,dur:14}},
  ]},
  {id:'vance', name:'Генерал Вэнс', face:'🪖', col:'#9a8a4a', cost:35, abilities:[
    {kind:'passive', icon:'🏃', name:'Молниеносность', desc:'+25% скорости армии', pass:[{key:'speed',add:0.25}]},
    {kind:'active', icon:'👟', name:'Форсированный марш', desc:'+90% скорости армии на 16с', cd:45, fx:{type:'buff',key:'speed',add:0.9,dur:16}},
    {kind:'active', icon:'📣', name:'Боевой клич', desc:'+50% атаке армии на 18с', cd:50, fx:{type:'buff',key:'atk',add:0.5,dur:18}},
  ]},
  {id:'gold', name:'Канцлер Гольд', face:'💼', col:'#caa24a', cost:45, abilities:[
    {kind:'passive', icon:'💰', name:'Золотой век', desc:'+25% дохода голды', pass:[{key:'eco',add:0.25}]},
    {kind:'active', icon:'🪙', name:'Золотой дождь', desc:'+400 голды мгновенно', cd:40, fx:{type:'gold',amount:400}},
    {kind:'active', icon:'📈', name:'Военные облигации', desc:'+120% дохода голды на 25с', cd:60, fx:{type:'buff',key:'eco',add:1.2,dur:25}},
  ]},
  {id:'volk', name:'Комиссар Вольк', face:'🎖', col:'#8a3f3f', cost:40, abilities:[
    {kind:'passive', icon:'👥', name:'Народная армия', desc:'+25% манпауэра', pass:[{key:'prod',add:0.25}]},
    {kind:'active', icon:'📢', name:'Тотальная мобилизация', desc:'манпауэр до максимума', cd:50, fx:{type:'manpower'}},
    {kind:'active', icon:'🎖', name:'Призыв резерва', desc:'+12 гарнизона всем городам', cd:45, fx:{type:'garrison',amount:12}},
  ]},
  {id:'storm', name:'Маршал Шторм', face:'✈', col:'#3a6fa0', cost:50, abilities:[
    {kind:'passive', icon:'✈', name:'Господство в воздухе', desc:'+25% урона бомб, +20% прочности самолётов', pass:[{key:'bd',add:0.25},{key:'ph',add:0.20}]},
    {kind:'active', icon:'💥', name:'Ковровая бомбардировка', desc:'−40 гарнизона вражескому городу (цель авиации/ближайший)', cd:80, fx:{type:'airstrike',amount:40}},
    {kind:'active', icon:'🛡', name:'Воздушный щит', desc:'+50% прочности самолётов на 20с', cd:60, fx:{type:'buff',key:'ph',add:0.5,dur:20}},
  ]},
];
function heroDef(id){ return HEROES.find(h=>h.id===id); }
// суммарный бонус героев фракции по ключу (пассивы активных героев + временные баффы активок)
function heroAdd(fid,key){
  const hs=heroSlots[fid];
  if((!hs||!hs.length)&&!heroBuffs.length)return 0;
  let s=0;
  if(hs)for(const h of hs){ const d=heroDef(h.id); if(!d)continue;
    for(const ab of d.abilities) if(ab.kind==='passive'&&ab.pass) for(const p of ab.pass) if(p.key===key)s+=p.add; }
  for(const b of heroBuffs) if(b.fid===fid&&b.key===key)s+=b.add;
  return s;
}
// применить эффект активки; вернуть false если применить не удалось (тогда КД не ставим)
function runHeroFx(fid, fx){
  if(fx.type==='buff'){ heroBuffs.push({fid,key:fx.key,add:fx.add,until:gameTime+fx.dur}); return true; }
  if(fx.type==='gold'){ gold[fid]+=fx.amount; return true; }
  if(fx.type==='manpower'){ manpower[fid]=manpowerCap(fid); return true; }
  if(fx.type==='garrison'){ for(const c of cities)if(c.owner===fid){ const cap=c.capacity||(c.units+fx.amount); c.units=Math.min(cap,c.units+fx.amount); } return true; }
  if(fx.type==='airstrike'){
    let tgt=null; const ord=airOrder[fid];
    if(ord&&ord.kind==='bomb'&&ord.city&&cities.includes(ord.city)&&ord.city.owner!==fid&&atWar(fid,ord.city.owner))tgt=ord.city;
    if(!tgt){ const cap=cities.find(c=>c.owner===fid&&c.capital)||cities.find(c=>c.owner===fid);
      let bd=1e18; for(const c of cities){ if(c.owner===fid||!atWar(fid,c.owner))continue;
        const dd=cap?((c.gx-cap.gx)**2+(c.gz-cap.gz)**2):0; if(dd<bd){bd=dd;tgt=c;} } }
    if(!tgt){ if(fid===PLAYER)toast('🚀 Нет цели — нужна война'); return false; }
    tgt.units=Math.max(1,tgt.units-fx.amount); suppressAA(tgt); suppressAA(tgt);
    for(let i=0;i<7;i++){ const ax=tgt.gx+(Math.random()-.5)*1.5, az=tgt.gz+(Math.random()-.5)*1.5; spawnBlast(ax,getTerrainHeight(ax,az)+0.2,az); }
    if(fid===PLAYER)toast(`💥 Удар по ${CITY_NAMES[tgt.idx]}: −${fx.amount} гарнизона`);
    return true;
  }
  return true;
}
// клик по активной способности героя
function activateHeroAbility(fid, h, abIndex){
  const d=heroDef(h.id); if(!d)return; const ab=d.abilities[abIndex]; if(!ab||ab.kind!=='active')return;
  const actives=d.abilities.filter(a=>a.kind==='active'); const ai=actives.indexOf(ab);
  if(!h.cd)h.cd=actives.map(()=>0);
  if(h.cd[ai]>0){ toast(`⏳ ${ab.name}: перезарядка ${Math.ceil(h.cd[ai])}с`); return; }
  if(MP.guest){                            // онлайн: активку применяет СЕРВЕР авторитетно (кулдаун/эффект прилетят в econ)
    const hi=(heroSlots[fid]||[]).indexOf(h); if(hi<0)return;
    MP.cmd({cmd:'hero', h:hi, ab:ai});
    h.cd[ai]=ab.cd;                        // оптимистичный КД; сервер подтвердит/сбросит через econ (или denied)
    toast(`${ab.icon} ${ab.name}`); refreshHeroBar(); return;
  }
  if(!runHeroFx(fid, ab.fx))return;        // не применилось (нет цели) → КД не тратим
  h.cd[ai]=ab.cd;
  toast(`${ab.icon} ${ab.name}`);
  refreshHeroBar();
}
function buildAA(c){
  if(MP.guest){ MP.cmd({cmd:'aa',c:c.idx}); return; }   // гость → команда хосту/серверу
  if(c.owner!==PLAYER)return;
  if(c.occ){toast('🏴 Оккупированный город — нельзя строить ПВО');return;}
  if((c.aa||0)>=AA_MAX){toast('🚀 ПВО уже максимум');return;}
  const cost=aaCost(c);
  if(gold[PLAYER]<cost){toast('Не хватает голды на зенитку');return;}
  if((manpower[PLAYER]||0)<AA_MP){toast(`👥 Не хватает манпауэра (нужно ${AA_MP})`);return;}
  gold[PLAYER]-=cost; manpower[PLAYER]-=AA_MP; c.aa=(c.aa||0)+1;
}
// бомбёжка/обстрел города может выбить зенитку
function suppressAA(c){ if(c&&c.aa>0&&Math.random()<AA_KILL_CHANCE)c.aa=Math.max(0,c.aa-1); }
// ПВО города пытается сбить входящую ракету/бомбу (шанс растёт с числом зениток)
function aaIntercepts(city,owner){ if(!city||city.owner===owner||(city.aa|0)<=0||!atWar(owner,city.owner))return false;
  return Math.random() < 1-Math.pow(1-AA_INTERCEPT, city.aa); }
// вспышка перехвата (бирюзовая, в цвет зениток)
function aaInterceptFX(x,y,z){ const m=new T3.Mesh(new T3.SphereGeometry(0.24,8,6),new T3.MeshBasicMaterial({color:0x7fe3ff,transparent:true,opacity:.95})); m.position.set(x,y,z); scene.add(m); fx.push({mesh:m,life:0.28,max:0.28,grow:4}); }
/* cityAA — в серверном Sim (ПВО городов считает серверный сим) */

let heightMap = []; // global for city positioning

// Country polygons from europe.html
const COUNTRIES=[
  {name:'Британия', polys:[[[-5.5,50],[-3,51.5],[-3,53.5],[-5,54.5],[-2,57.5],[-4,58.6],[-1.5,57.5],[.5,52.8],[1.5,51.5],[-1,50.6]], [[-10.2,51.5],[-10,54.5],[-7,55.3],[-6,54],[-6.2,52.2],[-9,51.4]]]},
  {name:'Франция', polys:[[[-1.5,43.4],[-1,46],[-4.7,48.5],[-1.5,48.6],[2.5,51],[5.2,49],[7.6,48],[7.5,43.9],[3.3,43],[3,42.4]]]},
  {name:'Испания', polys:[[[-8.8,43.4],[-1.5,43.4],[3,42.4],[0.5,40.5],[-0.5,38],[-2.2,36.8],[-5.5,36.3],[-7.3,37],[-7.6,38.5],[-7.4,40.5],[-7.2,42],[-8.8,43.4]], [[2.3,39.3],[3.5,39.4],[3.5,39.9],[2.5,39.95],[2.3,39.5]]]},
  {name:'Португалия', polys:[[[-9.5,38.7],[-8.9,37],[-6.9,37],[-6.5,38.5],[-6.6,40],[-6.9,41.5],[-8.2,42],[-8.9,41.8],[-9.4,40],[-9.4,39]]]},
  {name:'Италия', polys:[[[7.6,44],[12.4,44.2],[13.6,45.6],[13.5,43.6],[16,41.9],[18.4,40.1],[16.6,39.8],[16.6,38],[15.6,38.2],[15.8,40],[14,40.8],[11.2,42.4],[10,44]]]},
  {name:'Германия', polys:[[[7.6,48],[5.9,51],[7,53.6],[9,54.5],[13,54.4],[14,51],[12.5,48.5],[10.5,47.4],[7.5,47.6]]]},
  {name:'Бельгия', polys:[[[3,51],[2.5,51.4],[3.5,53.4],[7,53.5],[6,50.8],[4.3,49.6]]]},
  {name:'Австрия', polys:[[[12.5,48.5],[12,50.3],[15,51],[18.8,49.6],[22,48.5],[22.5,46],[19,45.8],[16.5,45.5],[13.5,46.5],[12.5,47.5]]]},
  {name:'Польша', polys:[[[14,51],[14.2,54],[18.6,54.6],[23.5,54],[24,50.5],[22,49],[19,49.5],[15,51]]]},
  {name:'Норвегия', polys:[[[4.8,58],[4.5,60],[5,62],[7,63.2],[9.5,64.2],[11,65],[13,66],[15.5,67.3],[18.5,68.7],[22,69.8],[27,70.5],[31,70],[28,69],[24,68],[21,67.3],[19,66.5],[17.5,65.5],[16.5,64.3],[16,63],[15.5,61.5],[15,60],[14,58.8],[12,58.3],[9,58],[6.5,57.9]]]},
  {name:'Швеция', polys:[[[12,55.4],[11.5,57],[11.8,58.8],[12.5,60],[13.5,61.5],[15,63],[16.5,64.5],[18.5,66],[21,67],[24,66.5],[23.5,65],[22,63],[20,61],[18.5,59],[17,57.5],[15,56],[13.5,55.4]]]},
  {name:'Финляндия', polys:[[[21,60],[21.5,62],[22.5,64],[24.5,66],[26.5,68],[28.5,69.5],[30.5,68.5],[31,66],[31,63],[29.5,61],[27,60],[24,59.8],[22,59.8]]]},
  {name:'Дания', polys:[[[8,54.3],[8,56.6],[9.2,57.7],[11,57.7],[12.9,56],[12.7,54.6],[10.8,54.2],[9.2,54.2]], [[-7.6,61.7],[-6.3,61.8],[-6.3,62.4],[-7.4,62.4],[-7.7,62]]]},
  {name:'Эстония', polys:[[[23.3,57.8],[24,59.6],[28.2,59.5],[28.2,57.8],[26,57.5],[24,57.5]]]},
  {name:'Латвия', polys:[[[20.9,56.4],[24,58],[28.2,57.8],[28,56],[26,55.7],[22,55.7],[21,56]]]},
  {name:'Литва', polys:[[[21,54.3],[21.5,56.2],[25,56],[26.7,54.4],[24,53.9],[22,54]]]},
  {name:'Балканы', polys:[[[13.5,46.5],[19,45.8],[22.5,46],[23,44],[28.5,44.2],[28,41.4],[24,41],[22,41],[19.8,40.9],[18.5,42.5],[16,43.5],[13.5,45.7]]]},
  {name:'Греция', polys:[[[20.8,39.7],[21.5,40.3],[22.8,40.5],[24,40.9],[26,41],[26.4,40.3],[24.5,39.2],[23.6,38.3],[23.2,37.4],[22.4,36.8],[21.4,36.6],[21,37.6],[20.7,38.7],[20.6,39.2]], [[23.4,35.2],[26.2,34.9],[26.3,35.4],[24,35.5],[23.3,35.4]]]},
  {name:'Украина', polys:[[[23.5,54],[28,56],[33,53],[40,50],[38,47.5],[30,45],[28.5,44.2],[23,44],[24,50.5]]]},
  {name:'Россия', polys:[[[20.5,54.5],[20.5,56],[22,56],[22,54.8]],
    // основное тело + южный рукав (Северный Кавказ), широкий нахлёст с Грузией и Азербайджаном
    [[28,56],[28,59.5],[30,63.5],[35,65.5],[42,66],[47,66],[50,60],[49.5,53],[48.7,49],
     [48.4,46],[48.2,43.5],[47.9,41.6],        // Каспийский берег вниз (Дагестан, на границе Азербайджана)
     [46.5,41.6],[45,41.9],[43.5,42.3],[42,42.6],[40.5,42.7],[39.6,42.8], // хребет Кавказа, заметно ниже границы Грузии
     [38.7,44.3],[38.3,46.6],                  // Черноморский берег (Сочи, Краснодар)
     [39,48.2],[40,50],[33,53]]]},
  // Турция: Фракия (Европа) + Анатолия (Азия), между ними — Босфор/Мраморное море (вода)
  {name:'Турция', polys:[
    [[26,40.9],[26,41.9],[27.5,41.9],[28.8,41.5],[29.2,41.15],[28.5,41.0],[27,40.8]],
    [[29.8,40.0],[31,40.9],[33,41.3],[35.5,41.5],[37.5,41.3],[39.5,41.1],[41.5,41.4],[42.5,40],[44,39.3],[44.8,38.5],[44,37],[42,36.4],[38,36.1],[34,36],[31,36.2],[27.8,36.4],[26.6,37.5],[26.9,39],[28.4,39.8]]
  ]},
  {name:'Грузия', polys:[[[40,43.4],[43,43.7],[46.5,42.3],[46.3,41.4],[44.5,41.1],[42.5,41.0],[41.5,41.0],[40.5,41.4],[40,42.2],[39.9,42.9]]]},
  {name:'Армения', polys:[[[42.8,41.1],[44.5,41.3],[46.3,40.3],[46.2,39],[44.6,38.6],[43.4,39],[42.7,39.8],[42.6,40.5]]]},
  {name:'Азербайджан', polys:[[[45,42.1],[48.5,42.0],[50,40.4],[49.2,38.6],[47,38.5],[46.3,39.4],[46.4,40.5],[45.3,41]]]},
  // заплатки без городов — закрывают дыры между странами (цвет берётся от ближайшего города)
  {name:'Альпы', polys:[[[7.6,48],[7.5,43.9],[10,44],[12.4,44.2],[13.6,45.6],[13.5,46.5],[12.5,47.5],[12.5,48.5],[10.5,47.4]]]},
  // Карпаты / Паннония — Словакия, восток Венгрии, запад Румынии (разлом между Польшей, Центром, Украиной, Балканами)
  {name:'Карпаты', polys:[[[17,47],[18,50.2],[20.5,51],[24,50.8],[27,49.2],[27.6,46],[26,44],[23,43.6],[20,44.2],[17.6,45.2]]]},
  // Лапландия — север Скандинавии + Ботнический залив (стык Норвегии, Швеции, Финляндии)
  {name:'Лапландия', polys:[[[11.5,61],[12,64],[14,67],[17,69],[22,70.4],[28,70.6],[31.5,68.5],[31,64],[29,61.5],[25,61],[20,60.6],[15,60.8],[12.5,60.8]]]},
];

// политические цвета: нейтральные страны — свой цвет, игрок/враг — цвет владельца
const COUNTRY_COLOR={
  'Иберия':0xe0b23a, 'Италия':0x55b84a, 'Германия':0x8a93a0, 'Бельгия':0xe07b2e,
  'Австрия':0xb86fb0, 'Польша':0x7a5bc4, 'Скандинавия':0x3fb0c0, 'Балканы':0xd06838,
  'Украина':0x9ab84a, 'Британия':0x2f7fd0, 'Франция':0x2f7fd0, 'Россия':0xd0463a, 'Турция':0xd0463a,
};
const TERR_PLAYER=new T3.Color(0x2f7fd0), TERR_ENEMY=new T3.Color(0xd0463a), TERR_NEUTRAL=new T3.Color(0x9aa6b2);
const TERR_WHITE=new T3.Color(0xeef1f4);

// точка в полигоне (ray casting)
function pointInPolygon(lon, lat, poly){
  let inside=false;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++){
    const xi=poly[i][0],yi=poly[i][1],xj=poly[j][0],yj=poly[j][1];
    if((yi>lat)!==(yj>lat)&&lon<((xj-xi)*(lat-yi)/(yj-yi)+xi))inside=!inside;
  }
  return inside;
}

// проверить находится ли точка в любой стране
function isInEurope(lon, lat){
  for(const c of COUNTRIES)
    for(const poly of c.polys)
      if(pointInPolygon(lon,lat,poly))return true;
  return false;
}

const WATER_Y = -0.15;
// верхняя точка тайла (на ней стоят города)
function getTerrainHeight(x, z){
  const xi=Math.floor(x), zi=Math.floor(z);
  if(xi<0||zi<0||xi>=GRID||zi>=GRID)return WATER_Y;
  const t = tiles[xi]?.[zi];
  if(t && !t.isWater && t.topY!=null) return t.topY;
  const h = heightMap[xi]?.[zi];
  if(h==null) return WATER_Y;
  return WATER_Y - 0.2 + (0.3 + h);
}

function getHeightAtLonLat(lon, lat){
  // базовая высота равнины (луг)
  let h = 0.35;

  // Альпы (центр-юг): lon=8-13, lat=43-47
  const alpDist = Math.hypot((lon-10.5)/4, (lat-45.5)/2.5);
  h += Math.max(0, 1.2 - alpDist*1.0) * 1.0;

  // Апеннины (Италия): lon=12-15, lat=42-44
  const apDist = Math.hypot((lon-13.5)/2, (lat-43)/1.5);
  h += Math.max(0, 0.8 - apDist*1.2) * 0.7;

  // Пиренеи (запад): lon=-2-3, lat=42-44
  const pyrDist = Math.hypot((lon-0.5)/3, (lat-43)/1.5);
  h += Math.max(0, 0.8 - pyrDist*1.1) * 0.6;

  // Карпаты (восток-центр): lon=20-25, lat=45-49
  const carpDist = Math.hypot((lon-22.5)/3, (lat-47)/2);
  h += Math.max(0, 1.0 - carpDist*1.0) * 0.8;

  // Балканы (восток-юг): lon=18-28, lat=41-45
  const balkDist = Math.hypot((lon-23)/5, (lat-43)/2);
  h += Math.max(0, 0.9 - balkDist*0.9) * 0.6;

  // Скандинавские горы (север): lon=8-20, lat=59-64
  const scandDist = Math.hypot((lon-14)/8, (lat-61.5)/2.5);
  h += Math.max(0, 1.0 - scandDist*0.8) * 0.5;

  // Кавказ (далеко восток): lon=40-45, lat=42-44
  const caucDist = Math.hypot((lon-42.5)/2.5, (lat-43)/1.5);
  h += Math.max(0, 0.8 - caucDist*1.2) * 0.7;

  // холмы/рельеф (несколько октав шума)
  const d1 = NoiseGen.noise(lon/6, lat/6) * 0.30;
  const d2 = NoiseGen.noise(lon/2.5, lat/2.5) * 0.16;
  const d3 = NoiseGen.noise(lon, lat) * 0.08;
  h += d1 + d2 + d3;

  return Math.max(0.12, Math.min(2.8, h));
}

function buildBorders(){
  // нарисовать границы стран линиями
  const points = [];
  const borderCol = new T3.Color(0x444466);

  for(const country of COUNTRIES){
    for(const poly of country.polys){
      for(let i=0;i<poly.length;i++){
        const [lon1, lat1] = poly[i];
        const [lon2, lat2] = poly[(i+1)%poly.length];

        const x1 = (lon1 - LON0) / (LON1 - LON0) * GRID;
        const z1 = (LAT1 - lat1) / (LAT1 - LAT0) * GRID;
        const x2 = (lon2 - LON0) / (LON1 - LON0) * GRID;
        const z2 = (LAT1 - lat2) / (LAT1 - LAT0) * GRID;

        // получить высоту в этих точках
        const h1 = getHeightAtLonLat(lon1, lat1) + 0.1;
        const h2 = getHeightAtLonLat(lon2, lat2) + 0.1;

        points.push(new T3.Vector3(x1, h1, z1));
        points.push(new T3.Vector3(x2, h2, z2));
      }
    }
  }

  const geo = new T3.BufferGeometry().setFromPoints(points);
  const mat = new T3.LineBasicMaterial({color: 0x666688, linewidth: 2, transparent: true, opacity: 0.6});
  borderLines = new T3.LineSegments(geo, mat);
  scene.add(borderLines);
}

// палитра высоты суши: пляж → луг → лес → холм → горы → снег
function landColor(h){
  if(h < 0.22) return new T3.Color(0xd9c89a);      // песок/пляж
  if(h < 0.62) return new T3.Color(0x5f9e40);      // луг (насыщ. зелёный)
  if(h < 1.05) return new T3.Color(0x4d8636);      // тёмная зелень/лес
  if(h < 1.55) return new T3.Color(0x7d7a52);      // предгорье
  if(h < 2.05) return new T3.Color(0x8a8478);      // скалы
  if(h < 2.45) return new T3.Color(0xb7b2a8);      // высокогорье
  return new T3.Color(0xf4f6f8);                    // снег
}

function buildWorld(){
  // маска суши из полигонов стран
  heightMap = [];
  const landMask = [];
  for(let x=0;x<GRID;x++){
    landMask[x]=[];
    for(let z=0;z<GRID;z++){
      const lon = LON0 + ((x+0.5) / GRID) * (LON1 - LON0);
      const lat = LAT1 - ((z+0.5) / GRID) * (LAT1 - LAT0);
      landMask[x][z] = isInEurope(lon, lat);
    }
  }
  // штамп суши 3×3 под каждым городом — порты не тонут в море
  for(const d of CITY_DATA){
    for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++){
      const x=d[0]+dx, z=d[1]+dz;
      if(x>=1&&z>=1&&x<GRID-1&&z<GRID-1)landMask[x][z]=true;
    }
  }
  // высоты суши
  for(let x=0;x<GRID;x++){
    heightMap[x]=[];
    for(let z=0;z<GRID;z++){
      const lon = LON0 + ((x+0.5) / GRID) * (LON1 - LON0);
      const lat = LAT1 - ((z+0.5) / GRID) * (LAT1 - LAT0);
      heightMap[x][z] = landMask[x][z] ? getHeightAtLonLat(lon, lat) : 0;
    }
  }

  // ── единый план воды: огромный, чтобы край ушёл далеко за туман ──
  const waterGeo = new T3.PlaneGeometry(1800, 1800, 140, 140);
  waterGeo.rotateX(-Math.PI/2);
  const waterMat = new T3.ShaderMaterial({
    uniforms: waterShader.uniforms,
    vertexShader: waterShader.vertexShader,
    fragmentShader: waterShader.fragmentShader,
    side: T3.DoubleSide,
  });
  waterMesh = new T3.Mesh(waterGeo, waterMat);
  waterMesh.position.set(GRID/2-0.5, WATER_Y, GRID/2-0.5);
  waterMesh.frustumCulled = false; // огромная плоскость — не отсекать
  scene.add(waterMesh);

  // ── суша: InstancedMesh (верхняя плита + земляной столб) — 2 draw call на 16k тайлов ──
  const landList=[];
  for(let x=0;x<GRID;x++){
    tiles[x]=[];
    for(let z=0;z<GRID;z++){
      if(!landMask[x][z]){
        tiles[x][z] = {terrain:'water', region:null, height:WATER_Y, isWater:true};
        continue;
      }
      landList.push({x,z,h:heightMap[x][z]});
    }
  }
  landTopIM=new T3.InstancedMesh(new T3.BoxGeometry(TILE,0.12,TILE),
    new T3.MeshLambertMaterial({color:0xffffff}), landList.length);
  landPillarIM=new T3.InstancedMesh(new T3.BoxGeometry(TILE,1,TILE),
    new T3.MeshLambertMaterial({color:0x8f7350}), landList.length);
  {
    const m=new T3.Matrix4();
    landList.forEach((o,i)=>{
      const topH=0.3+o.h;
      const topY=WATER_Y-0.2+topH;
      m.identity(); m.makeTranslation(o.x,topY-0.06,o.z);
      landTopIM.setMatrixAt(i,m);
      const ph=Math.max(0.05,topH-0.12);
      m.makeScale(1,ph,1); m.setPosition(o.x,topY-0.12-ph/2,o.z);
      landPillarIM.setMatrixAt(i,m);
      const col=landColor(o.h);
      landTopIM.setColorAt(i,col);
      tiles[o.x][o.z]={instId:i, terrain:'grass', region:null, baseCol:col, height:o.h, topY, isWater:false};
    });
  }
  landTopIM.castShadow=true;  landTopIM.receiveShadow=true;
  landPillarIM.castShadow=true; landPillarIM.receiveShadow=true;
  scene.add(landTopIM); scene.add(landPillarIM);

  // границы стран
  buildBorders();
  // леса, скалы, облака (визуал движка)
  buildTrees();
  buildPeaks();
  buildClouds();
  // граф дорог + их визуал
  buildGraph();
  buildRoads();
}

