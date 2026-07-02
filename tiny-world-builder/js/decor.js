/* ── леса (InstancedMesh, палитра движка) ───────────────────── */
function buildTrees(){
  const spots=[];
  for(let x=0;x<GRID;x++)for(let z=0;z<GRID;z++){
    const t=tiles[x][z]; if(!t||t.isWater)continue;
    const h=t.height;
    if(h<0.26||h>1.45)continue;                 // лес на лугах и холмах
    const n=NoiseGen.noise(x*0.33+7.1, z*0.33+3.7);
    if(n<0.16)continue;
    let nearCity=false;
    for(const c of CITY_DATA){ if((c[0]-x)**2+(c[1]-z)**2<3.5){nearCity=true;break;} }
    if(nearCity)continue;
    const cnt=n>0.40?2:1;
    for(let k=0;k<cnt;k++){
      spots.push({
        x:x+(Math.random()-0.5)*0.62, z:z+(Math.random()-0.5)*0.62,
        y:t.topY, s:0.75+Math.random()*0.65, dark:Math.random()<0.45
      });
    }
  }
  const N=spots.length; if(!N)return;
  const trunkIM=new T3.InstancedMesh(new T3.BoxGeometry(0.09,0.26,0.09),
    new T3.MeshLambertMaterial({color:0x5c3818}),N);
  const leafIM =new T3.InstancedMesh(new T3.BoxGeometry(0.34,0.30,0.34),
    new T3.MeshLambertMaterial({color:0xffffff}),N);
  const leaf2IM=new T3.InstancedMesh(new T3.BoxGeometry(0.22,0.22,0.22),
    new T3.MeshLambertMaterial({color:0xffffff}),N);
  const m=new T3.Matrix4(), q=new T3.Quaternion(), e=new T3.Euler(), v=new T3.Vector3();
  const cLeaf=new T3.Color(0x5f9e28), cLeafD=new T3.Color(0x47781c);
  spots.forEach((p,i)=>{
    e.set(0,Math.random()*Math.PI,0); q.setFromEuler(e); v.set(p.s,p.s,p.s);
    m.compose(new T3.Vector3(p.x,p.y+0.13*p.s,p.z),q,v); trunkIM.setMatrixAt(i,m);
    m.compose(new T3.Vector3(p.x,p.y+(0.26+0.13)*p.s,p.z),q,v); leafIM.setMatrixAt(i,m);
    m.compose(new T3.Vector3(p.x,p.y+(0.26+0.13+0.24)*p.s,p.z),q,v); leaf2IM.setMatrixAt(i,m);
    const lc=p.dark?cLeafD:cLeaf;
    leafIM.setColorAt(i,lc); leaf2IM.setColorAt(i,p.dark?cLeaf:cLeafD);
  });
  for(const im of [trunkIM,leafIM,leaf2IM]){ im.castShadow=true; im.receiveShadow=true; scene.add(im); }
}

/* ── скалы на горных пиках ──────────────────────────────────── */
function buildPeaks(){
  const spots=[];
  for(let x=0;x<GRID;x++)for(let z=0;z<GRID;z++){
    const t=tiles[x][z]; if(!t||t.isWater)continue;
    if(t.height<1.55)continue;
    const n=NoiseGen.noise(x*0.9+21, z*0.9+13);
    if(n<0.05)continue;
    spots.push({x:x+(Math.random()-0.5)*0.4, z:z+(Math.random()-0.5)*0.4,
      y:t.topY, s:0.7+Math.random()*0.9, snow:t.height>2.0});
  }
  const N=spots.length; if(!N)return;
  const rockIM=new T3.InstancedMesh(new T3.ConeGeometry(0.3,0.55,5),
    new T3.MeshLambertMaterial({color:0xffffff}),N);
  const m=new T3.Matrix4(), q=new T3.Quaternion(), e=new T3.Euler();
  const cRock=new T3.Color(0x8d877b), cSnow=new T3.Color(0xeef1f4);
  spots.forEach((p,i)=>{
    e.set(0,Math.random()*Math.PI,(Math.random()-0.5)*0.18); q.setFromEuler(e);
    m.compose(new T3.Vector3(p.x,p.y+0.22*p.s,p.z),q,new T3.Vector3(p.s,p.s,p.s));
    rockIM.setMatrixAt(i,m);
    rockIM.setColorAt(i,p.snow?cSnow:cRock);
  });
  rockIM.castShadow=true; rockIM.receiveShadow=true; scene.add(rockIM);
}

/* ── воксельные облака: 2 draw calls вместо сотен отдельных Mesh ───────── */
let cloudList=[], cloudMeshes=[], cloudBright=[], cloudDim=[];
const cloudDummy=new T3.Object3D();
function makeCloudPuffs(){
  const count=11+Math.floor(Math.random()*6), out=[];
  for(let i=0;i<count;i++){
    const core=i<4, bright=core||Math.random()<0.62;
    out.push({
      ox:(Math.random()-0.5)*(core?2.6:6.0),
      oy:core?0.25+Math.random()*0.8:Math.random()*1.7,
      oz:(Math.random()-0.5)*(core?1.7:3.8),
      rx:Math.random()*Math.PI,
      ry:Math.random()*Math.PI,
      rz:Math.random()*Math.PI,
      s:core?(0.85+Math.random()*0.7):(0.45+Math.random()*0.65),
      bright
    });
  }
  return out;
}
function writeCloudInstances(bucket, mesh){
  for(let i=0;i<bucket.length;i++){
    const p=bucket[i], c=cloudList[p.cloud];
    cloudDummy.position.set(c.x+p.ox,c.y+p.oy,c.z+p.oz);
    cloudDummy.rotation.set(p.rx,p.ry,p.rz);
    cloudDummy.scale.setScalar(p.s);
    cloudDummy.updateMatrix();
    mesh.setMatrixAt(i,cloudDummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate=true;
}
function buildClouds(){
  for(const c of cloudList)if(c&&c.isObject3D)scene.remove(c);
  for(const m of cloudMeshes)scene.remove(m);
  cloudList=[]; cloudMeshes=[]; cloudBright=[]; cloudDim=[];
  for(let i=0;i<18;i++){
    const cloud={x:Math.random()*(GRID+20)-10,y:16+Math.random()*5,z:Math.random()*GRID,speed:0.35+Math.random()*0.45};
    const idx=cloudList.push(cloud)-1;
    for(const p of makeCloudPuffs())(p.bright?cloudBright:cloudDim).push({...p,cloud:idx});
  }
  const geo=new T3.DodecahedronGeometry(1,0);
  const brightMat=new T3.MeshLambertMaterial({color:0xfdfcf8,transparent:true,opacity:0.88,depthWrite:false});
  const dimMat=new T3.MeshLambertMaterial({color:0xdcd9d0,transparent:true,opacity:0.62,depthWrite:false});
  const brightIM=new T3.InstancedMesh(geo,brightMat,cloudBright.length);
  const dimIM=new T3.InstancedMesh(geo,dimMat,cloudDim.length);
  for(const im of [brightIM,dimIM]){
    im.castShadow=false; im.receiveShadow=false; im.userData.perfGroup='clouds';
    scene.add(im); cloudMeshes.push(im);
  }
  writeCloudInstances(cloudBright,brightIM);
  writeCloudInstances(cloudDim,dimIM);
}
function updateClouds(dt){
  if(!cloudMeshes.length)return;
  for(const c of cloudList){
    c.x+=c.speed*dt;
    if(c.x>GRID+12)c.x=-12;
  }
  writeCloudInstances(cloudBright,cloudMeshes[0]);
  writeCloudInstances(cloudDim,cloudMeshes[1]);
}
