// ---- basic state ----
let map, watchId=null, currentCountry=null, currentCity=null, currentCourse=null, markers=[];
const qs=s=>document.querySelector(s), qsa=s=>document.querySelectorAll(s);
function toast(msg){ const el=document.createElement('div'); el.textContent=msg; el.style.cssText='position:fixed;left:50%;transform:translateX(-50%);bottom:78px;background:#222;color:#fff;padding:10px 14px;border-radius:10px;font-size:12px;opacity:.95;z-index:99'; document.body.appendChild(el); setTimeout(()=>el.remove(),2200); }
function esc(s){ return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

// ---- POI constants & helpers (Wheelmap/OSM 편의시설) ----
const OVERPASS = 'https://overpass-api.de/api/interpreter';
const POI_SOURCES = {
  toilet:   'poi-toilet',
  elevator: 'poi-elevator',
  bench:    'poi-bench',
  fountain: 'poi-fountain',
};
const POI_COLOR = {
  'poi-toilet':   '#1e90ff',
  'poi-elevator': '#7c3aed',
  'poi-bench':    '#22c55e',
  'poi-fountain': '#0ea5e9',
};
const isOn = key => document.querySelector(`.chip.on[data-layer="${key}"]`);

// ---- datasets ----
const MODEL={
  "영국": {emoji:"🕰️", cities:["런던"]},
  "프랑스": {emoji:"🗼", cities:["파리"]},
  "스위스": {emoji:"⛰️", cities:["루체른","베른","인터라켄"]},
  "이탈리아": {emoji:"⛪", cities:["밀라노","베네치아","피렌체","로마"]},
};
const CITY_TOKEN={"런던":"london","파리":"paris","루체른":"lucerne","베른":"bern","인터라켄":"interlaken","밀라노":"milan","베네치아":"venice","피렌체":"florence","로마":"rome"};

// fallback samples for offline/file://
const FALLBACK_COURSES = {"london": [{"name": "사우스뱅크 무계단 루프", "time": "~90분", "distance_km": 3.8, "difficulty": "쉬움", "turns": ["타워 브리지 남단 → 강변 산책로", "버러 마켓 → 글로브", "테이트 모던 광장", "밀레니엄 브리지 북단 → 세인트 폴"], "stops": [{"lon": -0.0754, "lat": 51.5055, "name": "타워 브리지"}, {"lon": -0.091, "lat": 51.505, "name": "버러 마켓"}, {"lon": -0.097, "lat": 51.507, "name": "테이트 모던"}, {"lon": -0.0984, "lat": 51.5138, "name": "세인트 폴 대성당"}]}, {"name": "웨스트민스터–세인트 제임스–트라팔가", "time": "~80분", "distance_km": 3.0, "difficulty": "쉬움", "turns": ["웨스트민스터 브리지", "세인트 제임스 파크", "트라팔가 광장"], "stops": [{"lon": -0.123, "lat": 51.5, "name": "웨스트민스터 브리지"}, {"lon": -0.134, "lat": 51.504, "name": "세인트 제임스 파크"}, {"lon": -0.128, "lat": 51.507, "name": "트라팔가 광장"}]}], "paris": [{"name": "루브르–뛸르리–오랑주리", "time": "~60분", "distance_km": 2.0, "difficulty": "쉬움", "turns": ["루브르 피라미드", "뛸르리 중앙 보행로", "오랑주리"], "stops": [{"lon": 2.335, "lat": 48.861, "name": "루브르 박물관"}, {"lon": 2.327, "lat": 48.862, "name": "뛸르리 정원"}, {"lon": 2.321, "lat": 48.864, "name": "오랑주리 미술관"}]}, {"name": "노트르담–시테섬–퐁네프", "time": "~75분", "distance_km": 2.6, "difficulty": "쉬움", "turns": ["시테섬 순환 산책", "퐁네프 북단 → 루브르 방면"], "stops": [{"lon": 2.3499, "lat": 48.853, "name": "노트르담 대성당"}, {"lon": 2.341, "lat": 48.857, "name": "시테섬 북단 산책로"}, {"lon": 2.339, "lat": 48.8577, "name": "퐁네프"}]}], "lucerne": [{"name": "호반–카펠교–중앙역", "time": "~45분", "distance_km": 1.8, "difficulty": "쉬움", "turns": ["호반 산책로", "카펠교", "중앙역"], "stops": [{"lon": 8.31, "lat": 47.051, "name": "루체른 호반"}, {"lon": 8.307, "lat": 47.052, "name": "카펠교"}, {"lon": 8.308, "lat": 47.05, "name": "루체른 중앙역"}]}], "bern": [{"name": "아르강 전망–분수–연방의사당", "time": "~50분", "distance_km": 2.0, "difficulty": "쉬움", "stops": [{"lon": 7.451, "lat": 46.948, "name": "뮌스터 테라스"}, {"lon": 7.447, "lat": 46.948, "name": "분수/아케이드"}, {"lon": 7.445, "lat": 46.947, "name": "연방의사당 전망"}]}], "interlaken": [{"name": "회퍼브루케–호헤마트 공원", "time": "~50분", "distance_km": 2.0, "difficulty": "쉬움", "stops": [{"lon": 7.862, "lat": 46.686, "name": "호헤마트 공원"}, {"lon": 7.856, "lat": 46.686, "name": "아레강 다리(회퍼브루케)"}]}], "milan": [{"name": "두오모–갤러리아", "time": "~40분", "distance_km": 1.2, "difficulty": "쉬움", "stops": [{"lon": 9.191, "lat": 45.464, "name": "두오모 대성당"}, {"lon": 9.189, "lat": 45.466, "name": "비토리오 에마누엘레 2세 갤러리아"}]}, {"name": "스포르체스코 성–브레라", "time": "~70분", "distance_km": 2.3, "difficulty": "쉬움", "stops": [{"lon": 9.179, "lat": 45.47, "name": "스포르체스코 성"}, {"lon": 9.187, "lat": 45.472, "name": "브레라 지구"}]}], "venice": [{"name": "두칼레–산 마르코", "time": "~45분", "distance_km": 1.0, "difficulty": "보통", "stops": [{"lon": 12.339, "lat": 45.434, "name": "두칼레 궁전"}, {"lon": 12.338, "lat": 45.434, "name": "산 마르코 대성당"}]}, {"name": "리알토–산 폴로", "time": "~60분", "distance_km": 1.6, "difficulty": "보통", "stops": [{"lon": 12.335, "lat": 45.438, "name": "리알토 다리"}, {"lon": 12.333, "lat": 45.437, "name": "산 폴로"}]}], "florence": [{"name": "두오모–시뇨리아", "time": "~60분", "distance_km": 1.8, "difficulty": "보통", "stops": [{"lon": 11.257, "lat": 43.773, "name": "두오모"}, {"lon": 11.254, "lat": 43.771, "name": "공화국 광장"}, {"lon": 11.255, "lat": 43.769, "name": "시뇨리아 광장"}]}, {"name": "우피치–베키오 다리–피티궁", "time": "~75분", "distance_km": 2.1, "difficulty": "보통", "stops": [{"lon": 11.255, "lat": 43.768, "name": "우피치 미술관"}, {"lon": 11.253, "lat": 43.767, "name": "베키오 다리"}, {"lon": 11.25, "lat": 43.765, "name": "피티 궁전"}]}], "rome": [{"name": "나보나–판테온", "time": "~60분", "distance_km": 2.0, "difficulty": "쉬움", "stops": [{"lon": 12.473, "lat": 41.9, "name": "나보나 광장"}, {"lon": 12.476, "lat": 41.899, "name": "판테온"}]}, {"name": "포로 로마노 주변 산책", "time": "~80분", "distance_km": 2.5, "difficulty": "보통", "stops": [{"lon": 12.484, "lat": 41.892, "name": "포로 로마노 동쪽 입구"}, {"lon": 12.492, "lat": 41.89, "name": "콜로세움 북측"}]}]};

// ---- drawer & init ----
const drawer=qs("#drawer"), scrim=qs("#scrim");
qs("#menuBtn").addEventListener("click",()=>{drawer.classList.add("open");scrim.classList.add("show")});
qs("#closeDrawer").addEventListener("click",closeDrawer); scrim.addEventListener("click",closeDrawer);
function closeDrawer(){drawer.classList.remove("open");scrim.classList.remove("show")}

const orsKeyInput=qs("#orsKeyInput"); const savedKey=localStorage.getItem("ORS_KEY"); if(savedKey) orsKeyInput.value=savedKey;
qs("#saveKeyBtn").addEventListener("click",()=>{ localStorage.setItem("ORS_KEY", orsKeyInput.value.trim()); toast("저장되었습니다"); });

async function resetApp(){
  try{ if('caches' in window){ const keys=await caches.keys(); await Promise.all(keys.map(k=>caches.delete(k))); } if('serviceWorker' in navigator){ const regs=await navigator.serviceWorker.getRegistrations(); await Promise.all(regs.map(r=>r.unregister())); } }catch(e){}
  try{ localStorage.clear(); sessionStorage.clear(); }catch(e){}
  location.reload();
}
qs("#resetAppBtn").addEventListener("click", resetApp);

// Views
function show(id){
  qsa('.view').forEach(v=>v.classList.add('hidden'));
  qs('#'+id).classList.remove('hidden');
  qsa('.tab').forEach(t=>t.classList.remove('active'));
  const tab=qs(`.tab[data-to="${id}"]`); if(tab) tab.classList.add('active');
  if(id==='v-map' && map){ setTimeout(()=>map.resize(), 50); }
  qs("#backBtn").style.visibility=(id==='v-home')?'hidden':'visible';
}
qs("#backBtn").addEventListener("click", ()=>{ history.back(); show('v-home'); });

// Render countries/cities/courses
function renderCountries(){
  const g=qs("#countryGrid"); g.innerHTML='';
  Object.entries(MODEL).forEach(([name,info])=>{
    const b=document.createElement('button'); b.className='card'; b.innerHTML=`<div class="title">${info.emoji} ${name}</div><div class="sub">${info.cities.join(' · ')}</div>`;
    b.addEventListener('click', ()=>{ currentCountry=name; renderCities(name); show('v-cities'); });
    g.appendChild(b);
  });
  if(!g.children.length){ g.innerHTML='<div style="color:#667085">국가 목록을 불러오지 못했습니다. 메뉴(≡)에서 캐시 초기화를 눌러주세요.</div>'; }
}
function renderCities(country){
  qs("#citiesTitle").textContent=`${country}의 도시 선택`;
  const g=qs("#cityGrid"); g.innerHTML='';
  MODEL[country].cities.forEach(city=>{
    const b=document.createElement('button'); b.className='card'; b.innerHTML=`<div class="title">📍 ${city}</div><div class="sub">추천 코스 보기</div>`;
    b.addEventListener('click', ()=>{ currentCity=city; renderCourses(); show('v-courses'); });
    g.appendChild(b);
  });
}
function renderCourses(){
  const token=CITY_TOKEN[currentCity]; const list=FALLBACK_COURSES[token]||[];
  qs("#courseCity").textContent=currentCity+' 추천 코스';
  const ul=qs("#courseList"); ul.innerHTML='';
  list.forEach(c=>{
    const li=document.createElement('li'); li.className='item';
    li.innerHTML=`<div style="font-weight:700">${c.name}</div><div style="color:#667085;font-size:12px">시간 ${c.time} · 거리 ${c.distance_km}km · 난이도 ${c.difficulty}</div>`;
    li.addEventListener('click', ()=>{ currentCourse=c; drawRouteFromStops(c); show('v-map'); });
    ul.appendChild(li);
  });
  if(!ul.children.length){ ul.innerHTML='<li class="item">아직 코스가 없어요.</li>'; }
}

// Map
const rasterStyle={"version":8,"sources":{"osm":{"type":"raster","tiles":["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],"tileSize":256,"attribution":"© OpenStreetMap"}},"layers":[{"id":"basemap","type":"raster","source":"osm"}]};
function initMap(){
  if(map) return;
  map = new maplibregl.Map({container:"map",style:rasterStyle,center:[2.333,48.86],zoom:13});
  map.addControl(new maplibregl.NavigationControl(),"top-right");
  map.on("load",()=>{
    // 경로
    map.addSource("route",{type:"geojson",data:{type:"FeatureCollection",features:[]}});
    map.addLayer({id:"route-line",type:"line",source:"route",paint:{"line-color":"#3A66FF","line-width":4}});

    // --- 편의시설 POI 소스/레이어 등록 ---
    const empty = { type:'FeatureCollection', features:[] };
    Object.values(POI_SOURCES).forEach(id=>{
      if(!map.getSource(id)) map.addSource(id, { type:'geojson', data: empty });
    });
    Object.entries(POI_SOURCES).forEach(([key,id])=>{
      if(map.getLayer(id)) return;
      map.addLayer({
        id,
        type: 'circle',
        source: id,
        paint: {
          'circle-radius': 5,
          'circle-color': POI_COLOR[id],
          'circle-stroke-width': 1.2,
          'circle-stroke-color': '#fff'
        },
        layout: { 'visibility': 'visible' }
      });
    });

    // 최초 로드 & 지도 이동 후 갱신
    updatePois();
    map.on('moveend', updatePois);

    // (선택) 클릭 팝업
    Object.values(POI_SOURCES).forEach(id=>{
      map.on('click', id, (e)=>{
       // 레이어 id → 한글 라벨
        const kor = id==='poi-toilet'   ? '화장실'
                  : id==='poi-elevator'? '엘리베이터'
                  : id==='poi-bench'   ? '벤치'
                  : id==='poi-fountain'? '음수대'
                  : '편의시설';

         // OSM tags.name(있으면 부제목으로 표시)
        const p = e.features?.[0]?.properties || {};
        const tags = p.tags ? (typeof p.tags === 'string' ? JSON.parse(p.tags) : p.tags) : {};
        const nm = tags && tags.name ? esc(tags.name) : '';

        const html = nm
        ? `<div style="font-weight:700">${kor}</div><div style="color:#667085;font-size:12px">${nm}</div>`
        : `<div style="font-weight:700">${kor}</div>`;

        new maplibregl.Popup().setLngLat(e.lngLat).setHTML(html).addTo(map);
      });
      map.on('mouseenter', id, ()=> map.getCanvas().style.cursor='pointer');
      map.on('mouseleave', id, ()=> map.getCanvas().style.cursor='');
    });

  });
}
function bboxFromCoords(coords){
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  coords.forEach(([x,y])=>{ if(x<minX)minX=x; if(y<minY)minY=y; if(x>maxX)maxX=x; if(y>maxY)maxY=y; });
  return [[minX,minY],[maxX,maxY]];
}
function clearMarkers(){ markers.forEach(m=>m.remove()); markers=[]; }
function addStopMarkers(stops){
  clearMarkers();
  stops.forEach((s,i)=>{
    const el=document.createElement('div'); el.className='marker-stop';
    const label = s.name ? s.name : `스톱 ${i+1}`;
    el.innerHTML = `<span class="em">⭐</span>${label}`;
    const lngLat = Array.isArray(s) ? s : [s.lon, s.lat];
    const mk=new maplibregl.Marker({element:el, anchor:'bottom'}).setLngLat(lngLat).addTo(map);
    markers.push(mk);
  });
}

// Overpass에서 편의시설 불러오기
async function updatePois(){
  if(!map) return;
  const b = map.getBounds();
  const bbox = `${b.getSouth()},${b.getWest()},${b.getNorth()},${b.getEast()}`;

  const parts = [];
  if(isOn('toilet'))   parts.push(`node["amenity"="toilets"](${bbox});`);
  if(isOn('elevator')) parts.push(`node["highway"="elevator"](${bbox});`);
  if(isOn('bench'))    parts.push(`node["amenity"="bench"](${bbox});`);
  if(isOn('fountain')) parts.push(`node["amenity"="drinking_water"](${bbox});`);

  if(!parts.length){
    Object.values(POI_SOURCES).forEach(id=>{
      map.getSource(id)?.setData({type:'FeatureCollection', features:[]});
    });
    return;
  }

  const ql = `
    [out:json][timeout:25];
    (
      ${parts.join('\n')}
    );
    out body 200;
  `.trim();

  try{
    const res = await fetch(OVERPASS, { method:'POST', body: 'data=' + encodeURIComponent(ql) });
    const json = await res.json();
    const feats = (json.elements||[]).map(n => ({
      type: 'Feature',
      geometry: { type:'Point', coordinates:[n.lon, n.lat] },
      properties: { id: n.id, tags: n.tags || {} }
    }));

    const fc = (filter) => ({ type:'FeatureCollection', features:feats.filter(filter) });
    map.getSource('poi-toilet')  ?.setData(fc(f=>f.properties.tags.amenity === 'toilets'));
    map.getSource('poi-elevator')?.setData(fc(f=>f.properties.tags.highway === 'elevator'));
    map.getSource('poi-bench')   ?.setData(fc(f=>f.properties.tags.amenity === 'bench'));
    map.getSource('poi-fountain')?.setData(fc(f=>f.properties.tags.amenity === 'drinking_water'));
  }catch(e){
    console.warn('Overpass error', e);
  }
}

// ORS routing
async function drawRouteFromStops(course){
  initMap();
  const coords = course.stops.map(s=> Array.isArray(s)? s : [s.lon, s.lat]);
  const orsKey = localStorage.getItem("ORS_KEY")||"";
  let feat=null, steps=[];
  if(orsKey){
    try{
      const res = await fetch('https://api.openrouteservice.org/v2/directions/wheelchair/geojson', {
        method:'POST',
        headers:{'Authorization': orsKey, 'Content-Type':'application/json'},
        body: JSON.stringify({coordinates: coords, instructions: true, options:{avoid_features:['steps']}, extra_info:['surface','steepness']})
      });
      if(!res.ok) throw 0;
      const data=await res.json();
      feat = data.features[0];
      steps = (feat.properties?.segments?.[0]?.steps)||[];
    }catch(e){
      toast('실시간 경로 실패: 임시 경로로 표시합니다');
    }
  }else{
    toast('ORS 키가 없어서 임시 경로로 표시합니다');
  }
  if(!feat){
    feat = {type:"Feature", properties:{name:course.name}, geometry:{type:"LineString", coordinates:coords}};
    steps = course.turns?.map(t=>({instruction:t})) || [];
  }
  map.getSource("route").setData({type:"FeatureCollection",features:[feat]});
  const bb=bboxFromCoords(coords); if(bb) map.fitBounds(bb,{padding:50});
  addStopMarkers(course.stops);
  // turn list
  const list=qs("#turnList"); list.innerHTML="";
  if(steps.length===0 && course.turns){ steps = course.turns.map(t=>({instruction:t})); }
  if(steps.length===0){ qs("#navInfo").textContent="지도를 보며 경로를 따라 이동하세요."; }
  steps.forEach(s=>{ const li=document.createElement('li'); li.textContent=s.instruction; list.appendChild(li); });
}

// Dynamic layout sizing
function applyLayoutSizes(){
  const header = document.querySelector('.app-header'); const tabbar = document.querySelector('.tabbar');
  const hh = (header?.offsetHeight||56) + 'px'; const th = (tabbar?.offsetHeight||64) + 'px';
  document.documentElement.style.setProperty('--header-h', hh);
  document.documentElement.style.setProperty('--tabbar-h', th);
}
window.addEventListener('resize', ()=>{ applyLayoutSizes(); if(map){ setTimeout(()=>map.resize(), 50); } });
window.addEventListener('orientationchange', ()=>{ setTimeout(()=>{ applyLayoutSizes(); if(map){ map.resize(); } }, 200); });
document.addEventListener('DOMContentLoaded', applyLayoutSizes);

// Geolocation
const locToggle=qs("#locToggle"); if(locToggle){locToggle.addEventListener("change",e=>{if(e.target.checked){startWatch()}else{stopWatch()}})}
function startWatch(){
  if(!("geolocation" in navigator)) return alert("이 기기에서 위치 기능을 사용할 수 없습니다.");
  if(watchId) return;
  watchId = navigator.geolocation.watchPosition(pos=>{
    const {latitude, longitude} = pos.coords;
    const point = { type:"FeatureCollection", features:[{type:"Feature", properties:{}, geometry:{type:"Point", coordinates:[longitude, latitude]}}] };
    if(!map) initMap();
    if(!map.getSource("me")){
      map.addSource("me",{type:"geojson",data:point});
      map.addLayer({id:"me",type:"circle",source:"me",paint:{"circle-radius":6,"circle-color":"#2D9CDB","circle-stroke-color":"#fff","circle-stroke-width":2}});
    } else { map.getSource("me").setData(point); }
  }, err=>{
    alert("위치 권한을 허용해 주세요."); const lt=qs("#locToggle"); if(lt) lt.checked=false; stopWatch();
  }, {enableHighAccuracy:true, maximumAge:5000, timeout:10000});
}
function stopWatch(){ if(watchId){ navigator.geolocation.clearWatch(watchId); watchId=null; } if(map?.getLayer("me")){ map.removeLayer("me"); map.removeSource("me"); } }

// Tabs
qsa(".tab").forEach(t=> t.addEventListener("click", ()=> show(t.dataset.to)));

// Chip toggle → layer visibility & refresh
qsa('.chip').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    btn.classList.toggle('on');
    const key = btn.getAttribute('data-layer');      // toilet/elevator/bench/fountain
    const layerId = 'poi-' + key;
    const on = btn.classList.contains('on');
    if(map?.getLayer(layerId)){
      map.setLayoutProperty(layerId, 'visibility', on ? 'visible' : 'none');
    }
    updatePois();
  });
});

// Init flow
document.addEventListener('DOMContentLoaded', ()=>{
  // render countries
  const grid=qs("#countryGrid"); grid.innerHTML='';
  Object.entries(MODEL).forEach(([name,info])=>{
    const b=document.createElement('button'); b.className='card'; b.innerHTML=`<div class="title">${info.emoji} ${name}</div><div class="sub">${info.cities.join(' · ')}</div>`;
    b.addEventListener('click', ()=>{ currentCountry=name; renderCities(name); show('v-cities'); });
    grid.appendChild(b);
  });
  show('v-home');
  setTimeout(()=>initMap(), 200);
});
