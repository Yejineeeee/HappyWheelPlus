
// ---- basic state ----
let map, watchId=null, currentCountry=null, currentCity=null, currentCourse=null, markers=[];
let currentPoisToken=null;
let pendingPoisToken=null;
let navMode=false;
let followUser=true;
let currentRoute=null; // {coords: [[lon,lat],...], steps:[...]} from ORS
let lastUserLonLat=null;

const POI_META = {
  toilet:   { label: '화장실', emoji: '🚻', color: '#E11D48', kinds: ['toilet'] },
  elevator: { label: '엘리베이터', emoji: '🛗', color: '#0EA5E9', kinds: ['elevator'] },
  bench:    { label: '벤치', emoji: '🪑', color: '#16A34A', kinds: ['bench'] },
  fountain: { label: '음수대', emoji: '🚰', color: '#8B5CF6', kinds: ['fountain','drinking_water','water_fountain'] },
};
const poiState = { toilet:true, elevator:true, bench:true, fountain:true };

// ---- POI source (Overpass/OSM) ----
const OVERPASS_ENABLED_STORE = 'POI_OVERPASS_ENABLED';
// default: enabled for this build
if(localStorage.getItem(OVERPASS_ENABLED_STORE) === null){
  try{ localStorage.setItem(OVERPASS_ENABLED_STORE, '1'); }catch(e){}
}
let overpassTimer=null;
let overpassInFlight=false;
let lastOverpassAt=0;
let lastOverpassKey=null;
let lastOverpassToken=null;

const qs=s=>document.querySelector(s), qsa=s=>document.querySelectorAll(s);
function toast(msg){ const el=document.createElement('div'); el.textContent=msg; el.style.cssText='position:fixed;left:50%;transform:translateX(-50%);bottom:78px;background:#222;color:#fff;padding:10px 14px;border-radius:10px;font-size:12px;opacity:.95;z-index:99'; document.body.appendChild(el); setTimeout(()=>el.remove(),2200); }

// ---- optional LLM (client-side; prototype) ----
const LLM_KEY_STORE = "LLM_KEY";
const LLM_ENDPOINT_STORE = "LLM_ENDPOINT";
const LLM_MODEL_STORE = "LLM_MODEL";
const DEFAULT_LLM_ENDPOINT = "https://api.openai.com/v1/chat/completions";
const DEFAULT_LLM_MODEL = "gpt-4o-mini";
const AI_COURSE_PREFIX = "AI_COURSE_";

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

// LLM settings (optional)
const llmEndpointInput = qs("#llmEndpointInput");
const llmModelInput = qs("#llmModelInput");
const llmKeyInput = qs("#llmKeyInput");
if(llmEndpointInput) llmEndpointInput.value = localStorage.getItem(LLM_ENDPOINT_STORE) || '';
if(llmModelInput) llmModelInput.value = localStorage.getItem(LLM_MODEL_STORE) || '';
if(llmKeyInput) llmKeyInput.value = localStorage.getItem(LLM_KEY_STORE) || '';
const saveLlmBtn = qs("#saveLlmBtn");
if(saveLlmBtn){
  saveLlmBtn.addEventListener("click",()=>{
    if(llmEndpointInput){
      const v = llmEndpointInput.value.trim();
      if(v) localStorage.setItem(LLM_ENDPOINT_STORE, v); else localStorage.removeItem(LLM_ENDPOINT_STORE);
    }
    if(llmModelInput){
      const v = llmModelInput.value.trim();
      if(v) localStorage.setItem(LLM_MODEL_STORE, v); else localStorage.removeItem(LLM_MODEL_STORE);
    }
    if(llmKeyInput){
      const v = llmKeyInput.value.trim();
      if(v) localStorage.setItem(LLM_KEY_STORE, v); else localStorage.removeItem(LLM_KEY_STORE);
    }
    toast("AI 설정이 저장되었습니다");
    if(currentCity) renderCourses();
  });
}

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
  if(id==='v-map'){
    initMap();
    const token = currentCity ? CITY_TOKEN[currentCity] : null;
    if(token) loadPoisForCity(token);
    if(map) setTimeout(()=>map.resize(), 50);
  }
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
  const token=CITY_TOKEN[currentCity];
  const list=FALLBACK_COURSES[token]||[];
  const ul=qs("#courseList");
  const aiPanel=qs("#aiPanel");
  const aiStatus=qs("#aiStatus");
  const hasKey = !!(localStorage.getItem(LLM_KEY_STORE)||"").trim();

  qs("#courseCity").textContent=currentCity+' 추천 코스';
  ul.innerHTML='';

  // AI panel state
  if(aiPanel){
    aiPanel.style.display='block';
    if(!hasKey){
      if(aiStatus) aiStatus.textContent='AI 기능을 사용하려면 메뉴에서 LLM API 키를 저장하세요.';
    } else {
      if(aiStatus) aiStatus.textContent='';
    }
  }

  // AI course (if exists)
  const aiCourse = loadAICourse(token);
  if(aiCourse){
    const li=document.createElement('li'); li.className='item';
    const dist = (typeof aiCourse.distance_km==='number') ? aiCourse.distance_km : parseFloat(aiCourse.distance_km||'');
    const distTxt = Number.isFinite(dist) ? dist.toFixed(1) : '?';
    const why = aiCourse.why ? ` · ${escapeHtml(aiCourse.why)}` : '';
    li.innerHTML = `
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
        <div style="font-weight:800">🤖 ${escapeHtml(aiCourse.name||'AI 맞춤 코스')}</div>
        <span style="font-size:11px;color:#667085;border:1px solid #EAECF0;border-radius:999px;padding:2px 8px;">AI</span>
      </div>
      <div style="color:#667085;font-size:12px">시간 ${escapeHtml(aiCourse.time||'?')} · 거리 ${distTxt}km · 난이도 ${escapeHtml(aiCourse.difficulty||'?')}${why}</div>
    `;
    li.addEventListener('click', ()=>{ currentCourse=aiCourse; drawRouteFromStops(aiCourse); show('v-map'); });
    ul.appendChild(li);
  }

  // Default courses
  list.forEach(c=>{
    const li=document.createElement('li'); li.className='item';
    li.innerHTML=`<div style="font-weight:700">${c.name}</div><div style="color:#667085;font-size:12px">시간 ${c.time} · 거리 ${c.distance_km}km · 난이도 ${c.difficulty}</div>`;
    li.addEventListener('click', ()=>{ currentCourse=c; drawRouteFromStops(c); show('v-map'); });
    ul.appendChild(li);
  });
  if(!ul.children.length){ ul.innerHTML='<li class="item">아직 코스가 없어요.</li>'; }
}

// ---- AI course helpers ----
function escapeHtml(s){
  return String(s??'').replace(/[&<>"']/g, (c)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

function loadAICourse(token){
  try{
    const raw = sessionStorage.getItem(AI_COURSE_PREFIX+token);
    if(!raw) return null;
    const obj = JSON.parse(raw);
    if(!obj || !Array.isArray(obj.stops) || obj.stops.length<2) return null;
    return obj;
  }catch(e){ return null; }
}

function saveAICourse(token, course){
  try{ sessionStorage.setItem(AI_COURSE_PREFIX+token, JSON.stringify(course)); }catch(e){}
}

function clearAICourse(token){
  try{ sessionStorage.removeItem(AI_COURSE_PREFIX+token); }catch(e){}
}

function collectCandidateStops(token){
  const courses = FALLBACK_COURSES[token]||[];
  const uniq = new Map();
  courses.forEach(c=>{
    (c.stops||[]).forEach(s=>{
      const name = (s?.name||'').trim();
      if(!name) return;
      if(!uniq.has(name)) uniq.set(name, {name, lon:s.lon, lat:s.lat});
    });
  });
  return Array.from(uniq.values());
}

function extractJsonFromText(text){
  if(!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if(fenced) text = fenced[1];
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if(start>=0 && end>start) return text.slice(start, end+1);
  return null;
}

async function callLLM(messages){
  const key = (localStorage.getItem(LLM_KEY_STORE)||'').trim();
  if(!key) throw new Error('NO_LLM_KEY');
  const endpoint = (localStorage.getItem(LLM_ENDPOINT_STORE)||'').trim() || DEFAULT_LLM_ENDPOINT;
  const model = (localStorage.getItem(LLM_MODEL_STORE)||'').trim() || DEFAULT_LLM_MODEL;

  const payload = { model, messages, temperature: 0.7 };
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`
    },
    body: JSON.stringify(payload)
  });
  if(!res.ok){
    let t='';
    try{ t = await res.text(); }catch(e){}
    throw new Error(`LLM_HTTP_${res.status}:${t?.slice(0,200)}`);
  }
  return res.json();
}

function matchCandidateStop(name, candidates){
  const n = (name||'').trim().toLowerCase();
  if(!n) return null;
  let exact = candidates.find(c=>c.name.trim().toLowerCase()===n);
  if(exact) return exact;
  // partial match
  let partial = candidates.find(c=>c.name.trim().toLowerCase().includes(n) || n.includes(c.name.trim().toLowerCase()));
  return partial || null;
}

async function generateAICourseForCity(city, token, userRequest){
  const candidates = collectCandidateStops(token);
  if(candidates.length < 3) throw new Error('NOT_ENOUGH_CANDIDATES');

  const system = `너는 휠체어 사용자를 위한 여행 코스 플래너다.\n\n규칙:\n- 반드시 아래 후보 명소 목록에서만 경유지를 선택한다(이름은 그대로).\n- 3~6개의 경유지를 순서대로 선정한다.\n- 출력은 JSON 하나만 반환한다(설명/마크다운/코드펜스 금지).\n- 필드는 다음을 권장한다: name,time,distance_km,difficulty,why,turns,stops.\n- stops는 [{name,why}] 형식이며, 좌표는 내가 후보 목록과 매칭해 채울 것이므로 너는 name을 정확히 써라.\n\n난이도(difficulty)는 쉬움/보통/어려움 중 하나.`;

  const candidateText = candidates.map(c=>`- ${c.name}`).join('\n');
  const user = `도시: ${city}\n요청: ${userRequest}\n\n후보 명소 목록:\n${candidateText}\n\nJSON 예시(형식만 참고):\n{"name":"...","time":"~90분","distance_km":3.2,"difficulty":"쉬움","why":"한 줄 이유","turns":["..."],"stops":[{"name":"...","why":"..."}]}`;

  const data = await callLLM([
    {role:'system', content: system},
    {role:'user', content: user}
  ]);

  const content = data?.choices?.[0]?.message?.content || '';
  const jsonText = extractJsonFromText(content);
  if(!jsonText) throw new Error('LLM_BAD_FORMAT');
  let obj;
  try{ obj = JSON.parse(jsonText); }catch(e){ throw new Error('LLM_BAD_JSON'); }

  const stops = Array.isArray(obj.stops) ? obj.stops : [];
  if(stops.length < 3) throw new Error('LLM_TOO_FEW_STOPS');

  const fixedStops = [];
  for(const s of stops){
    const cand = matchCandidateStop(s?.name, candidates);
    if(!cand) throw new Error('LLM_UNKNOWN_STOP');
    fixedStops.push({ name: cand.name, lon: cand.lon, lat: cand.lat, why: s?.why || '' });
  }

  return {
    name: obj.name || 'AI 맞춤 코스',
    time: obj.time || '~90분',
    distance_km: (typeof obj.distance_km==='number') ? obj.distance_km : parseFloat(obj.distance_km||'') || 0,
    difficulty: obj.difficulty || '쉬움',
    why: obj.why || '',
    turns: Array.isArray(obj.turns) ? obj.turns : (fixedStops.map((s,i)=> i===0 ? s.name : `${fixedStops[i-1].name} → ${s.name}`)),
    stops: fixedStops,
    _meta: { source: 'llm', city, token, generated_at: new Date().toISOString() }
  };
}

// Map
const rasterStyle={"version":8,"sources":{"osm":{"type":"raster","tiles":["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],"tileSize":256,"attribution":"© OpenStreetMap"}},"layers":[{"id":"basemap","type":"raster","source":"osm"}]};
function initMap(){
  if(map) return;
  map = new maplibregl.Map({container:"map",style:rasterStyle,center:[2.333,48.86],zoom:13});
  map.addControl(new maplibregl.NavigationControl(),"top-right");
  map.on("load",()=>{
    map.addSource("route",{type:"geojson",data:{type:"FeatureCollection",features:[]}});
    map.addLayer({id:"route-line",type:"line",source:"route",paint:{"line-color":"#3A66FF","line-width":4}});

    // POIs (wheelchair related convenience)
    map.addSource("pois",{type:"geojson",data:{type:"FeatureCollection",features:[]}});
    Object.entries(POI_META).forEach(([k, meta])=>{
      // circle base
      map.addLayer({
        id:`poi-${k}`,
        type:'circle',
        source:'pois',
        filter:['in',['get','kind'],['literal',meta.kinds]],
        paint:{
          'circle-radius':6,
          'circle-color': meta.color,
          'circle-stroke-color':'#fff',
          'circle-stroke-width':2
        }
      });
      // emoji marker
      map.addLayer({
        id:`poi-${k}-emoji`,
        type:'symbol',
        source:'pois',
        filter:['in',['get','kind'],['literal',meta.kinds]],
        layout:{
          'text-field': meta.emoji,
          'text-size': 13,
          'text-allow-overlap': true,
          'text-ignore-placement': true
        },
        paint:{'text-color':'#fff'}
      });
    });

    // POI click -> popup
    const allPoiLayers = Object.keys(POI_META).map(k=>`poi-${k}`).concat(Object.keys(POI_META).map(k=>`poi-${k}-emoji`));
    allPoiLayers.forEach(layerId=>{
      map.on('mouseenter', layerId, ()=>{ map.getCanvas().style.cursor='pointer'; });
      map.on('mouseleave', layerId, ()=>{ map.getCanvas().style.cursor=''; });
      map.on('click', layerId, (e)=>{
        const f = e?.features?.[0];
        if(!f) return;
        const kind = f.properties?.kind || '';
        const title = f.properties?.title || '편의시설';
        const meta = POI_META[toPoiCategory(kind)] || {label:'POI',emoji:'📍'};
        new maplibregl.Popup({closeButton:true, closeOnClick:true})
          .setLngLat(f.geometry.coordinates)
          .setHTML(`<div style="font-weight:800">${meta.emoji} ${escapeHtml(title)}</div><div style="color:#667085;font-size:12px;margin-top:2px">${escapeHtml(meta.label)}</div>`)
          .addTo(map);
      });
    });

    // initial visibility
    applyPoiVisibility();

    // When Overpass is enabled, refresh POIs when user pans/zooms (throttled)
    map.on('moveend', ()=>{
      if(currentPoisToken && isOverpassEnabled()) scheduleOverpassRefresh(currentPoisToken);
    });

    // if a POI load was requested before the map finished loading
    if(pendingPoisToken){
      const t = pendingPoisToken;
      pendingPoisToken = null;
      loadPoisForCity(t);
    }
  });
}

function toPoiCategory(kind){
  const k = String(kind||'').toLowerCase();
  for(const [cat, meta] of Object.entries(POI_META)){
    if(meta.kinds.map(x=>String(x).toLowerCase()).includes(k)) return cat;
  }
  return null;
}

function isOverpassEnabled(){
  return (localStorage.getItem(OVERPASS_ENABLED_STORE)||'') !== '0';
}

function getOverpassCandidates(){
  return [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.nchc.org.tw/api/interpreter'
  ];
}

function roundNum(n, d){
  const p = Math.pow(10,d);
  return Math.round(n*p)/p;
}

function bboxToKey(bbox){
  // bbox: [west,south,east,north]
  const [w,s,e,n] = bbox;
  return [roundNum(w,3),roundNum(s,3),roundNum(e,3),roundNum(n,3)].join(',');
}

function getPoiQueryBbox(){
  if(!map) return null;
  // Prefer route bbox (expand slightly), otherwise viewport bbox
  let b;
  if(currentRoute?.coords?.length){
    const bb = bboxFromCoords(currentRoute.coords);
    if(bb){
      const w = bb[0][0], s = bb[0][1], e = bb[1][0], n = bb[1][1];
      const pad = 0.01; // ~1km scale depending on latitude
      b = [w-pad, s-pad, e+pad, n+pad];
    }
  }
  if(!b){
    const bounds = map.getBounds();
    b = [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()];
  }
  // Safety: limit very wide queries (avoid 429/timeouts)
  const maxSpan = 0.25; // ~25km-ish
  const spanX = Math.abs(b[2]-b[0]);
  const spanY = Math.abs(b[3]-b[1]);
  if(spanX>maxSpan || spanY>maxSpan){
    const cx = (b[0]+b[2])/2;
    const cy = (b[1]+b[3])/2;
    b = [cx-maxSpan/2, cy-maxSpan/2, cx+maxSpan/2, cy+maxSpan/2];
  }
  return b;
}

async function fetchOverpassPOIs(bbox, opts={}){
  // bbox order for Overpass: (south,west,north,east)
  const [w,s,e,n] = bbox;
  const bboxStr = `${s},${w},${n},${e}`;

  const query = `[out:json][timeout:25];(
    node["amenity"="toilets"](${bboxStr});
    way["amenity"="toilets"](${bboxStr});
    relation["amenity"="toilets"](${bboxStr});

    node["amenity"="bench"](${bboxStr});
    way["amenity"="bench"](${bboxStr});
    relation["amenity"="bench"](${bboxStr});

    node["amenity"="drinking_water"](${bboxStr});
    way["amenity"="drinking_water"](${bboxStr});
    relation["amenity"="drinking_water"](${bboxStr});

    node["highway"="elevator"](${bboxStr});
    way["highway"="elevator"](${bboxStr});
    relation["highway"="elevator"](${bboxStr});
  );out center tags;`;

  const endpoints = getOverpassCandidates();
  let lastErr = null;
  for(const url of endpoints){
    try{
      const res = await fetch(url, {
        method:'POST',
        headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},
        body: new URLSearchParams({data: query}).toString()
      });
      if(!res.ok){
        const t = await res.text().catch(()=> '');
        throw new Error(`HTTP_${res.status}:${t?.slice(0,120)}`);
      }
      const json = await res.json();
      const feats = [];
      const seen = new Set();
      (json?.elements||[]).forEach(el=>{
        const tags = el.tags || {};
        let kind = null;
        if(tags.amenity === 'toilets') kind = 'toilet';
        else if(tags.amenity === 'bench') kind = 'bench';
        else if(tags.amenity === 'drinking_water') kind = 'drinking_water';
        else if(tags.highway === 'elevator') kind = 'elevator';
        if(!kind) return;
        const lon = (el.type==='node') ? el.lon : (el.center?.lon);
        const lat = (el.type==='node') ? el.lat : (el.center?.lat);
        if(typeof lon!=='number' || typeof lat!=='number') return;
        const id = `${el.type}/${el.id}/${kind}`;
        if(seen.has(id)) return;
        seen.add(id);
        const title = tags.name || (kind==='toilet'?'Public Toilet': kind==='bench'?'Bench': kind==='elevator'?'Elevator':'Drinking Water');
        feats.push({
          type:'Feature',
          properties:{
            kind,
            title,
            source:'overpass',
            osm_id: String(el.id||'')
          },
          geometry:{type:'Point',coordinates:[lon,lat]}
        });
      });
      return {type:'FeatureCollection', features: feats};
    }catch(err){
      lastErr = err;
    }
  }
  throw lastErr || new Error('OVERPASS_FAILED');
}

function mergePoiCollections(a,b){
  const out = {type:'FeatureCollection', features: []};
  const seen = new Set();
  const add = (fc)=>{
    (fc?.features||[]).forEach(f=>{
      const k = String(f?.properties?.kind||'');
      const c = f?.geometry?.coordinates;
      if(!k || !Array.isArray(c)) return;
      const key = `${k}|${roundNum(c[0],5)}|${roundNum(c[1],5)}|${f?.properties?.title||''}`;
      if(seen.has(key)) return;
      seen.add(key);
      out.features.push(f);
    });
  };
  add(a); add(b);
  return out;
}

async function loadPoisForCity(token, options={}){
  initMap();
  if(!map) return;
  if(!map.getSource('pois')){ pendingPoisToken = token; return; }
  if(!token) return;
  if(currentPoisToken===token && !options.forceOverpass) return;
  currentPoisToken = token;

  // 1) built-in POIs (if available)
  let base = {type:'FeatureCollection', features:[]};
  try{
    const res = await fetch(`data/pois_${token}.geojson`, {cache:'no-cache'});
    if(res.ok){ base = await res.json(); }
  }catch(e){}

  // 2) Overpass (optional)
  let merged = base;
  if(isOverpassEnabled()){
    try{
      const bbox = getPoiQueryBbox();
      if(bbox && map.getZoom()>=13){
        const key = `${token}|${bboxToKey(bbox)}`;
        const now = Date.now();
        const cacheKey = `OVERPASS_POI_${key}`;

        let over = null;
        if(!options.bypassCache){
          try{
            const raw = sessionStorage.getItem(cacheKey);
            if(raw){
              const obj = JSON.parse(raw);
              if(obj?.t && (now-obj.t) < 5*60*1000 && obj?.data){ over = obj.data; }
            }
          }catch(e){}
        }

        if(!over){
          over = await fetchOverpassPOIs(bbox);
          try{ sessionStorage.setItem(cacheKey, JSON.stringify({t:now,data:over})); }catch(e){}
        }
        merged = mergePoiCollections(base, over);
      }
    }catch(e){
      // keep base
    }
  }

  map.getSource('pois').setData(merged);
  updatePoiChipCounts(merged);

  // schedule ongoing refresh when user pans/zooms
  if(map && isOverpassEnabled()) scheduleOverpassRefresh(token);
}

function scheduleOverpassRefresh(token){
  if(!map || !isOverpassEnabled()) return;
  lastOverpassToken = token;
  if(overpassTimer) clearTimeout(overpassTimer);
  overpassTimer = setTimeout(async ()=>{
    if(!map || overpassInFlight) return;
    if(map.getZoom() < 13) return;
    const now = Date.now();
    if(now - lastOverpassAt < 12000) return; // throttle
    const bbox = getPoiQueryBbox();
    if(!bbox) return;
    const key = `${token}|${bboxToKey(bbox)}`;
    if(key === lastOverpassKey) return;

    lastOverpassAt = now;
    lastOverpassKey = key;
    overpassInFlight = true;
    try{
      const baseRes = await fetch(`data/pois_${token}.geojson`, {cache:'no-cache'}).catch(()=>null);
      let base = {type:'FeatureCollection',features:[]};
      if(baseRes && baseRes.ok){ base = await baseRes.json().catch(()=>base); }
      const over = await fetchOverpassPOIs(bbox);
      const merged = mergePoiCollections(base, over);
      if(map?.getSource('pois')){
        map.getSource('pois').setData(merged);
        updatePoiChipCounts(merged);
      }
    }catch(e){
      // ignore
    }finally{
      overpassInFlight = false;
    }
  }, 900);
}

function updatePoiChipCounts(geo){
  const counts = {toilet:0,elevator:0,bench:0,fountain:0};
  (geo?.features||[]).forEach(f=>{
    const cat = toPoiCategory(f?.properties?.kind);
    if(cat && counts[cat]!=null) counts[cat] += 1;
  });
  qsa('.chip[data-layer]').forEach(btn=>{
    const layer = btn.dataset.layer;
    const meta = POI_META[layer];
    if(!meta) return;
    const n = counts[layer]||0;
    btn.textContent = n>0 ? `${meta.label} (${n})` : `${meta.label}`;
  });
}

function setPoiVisibility(cat, visible){
  poiState[cat] = !!visible;
  if(!map) return;
  const v = visible ? 'visible' : 'none';
  const ids = [`poi-${cat}`, `poi-${cat}-emoji`];
  ids.forEach(id=>{
    if(map.getLayer(id)) map.setLayoutProperty(id,'visibility',v);
  });
}

function applyPoiVisibility(){
  Object.keys(POI_META).forEach(cat=> setPoiVisibility(cat, poiState[cat]));
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

// ORS routing
async function drawRouteFromStops(course){
  initMap();
  // load POIs for selected city
  if(currentCity){
    const token = CITY_TOKEN[currentCity];
    if(token) loadPoisForCity(token);
  }
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

  // keep route state for live navigation
  currentRoute = {
    coords: feat.geometry?.coordinates || coords,
    steps: steps || []
  };
  updateNavBoxStatic();

  map.getSource("route").setData({type:"FeatureCollection",features:[feat]});
  const bb=bboxFromCoords(coords); if(bb) map.fitBounds(bb,{padding:50});
  addStopMarkers(course.stops);
  // turn list
  const list=qs("#turnList"); list.innerHTML="";
  if(steps.length===0 && course.turns){ steps = course.turns.map(t=>({instruction:t})); }
  if(steps.length===0){ qs("#navInfo").textContent="지도를 보며 경로를 따라 이동하세요."; }
  steps.forEach((s, idx)=>{
    const li=document.createElement('li');
    li.dataset.step = String(idx);
    const dist = (typeof s.distance==='number') ? ` · ${Math.round(s.distance)}m` : '';
    li.textContent = `${s.instruction||''}${dist}`;
    list.appendChild(li);
  });
}

// ---- Live navigation ("실제 길안내"에 가까운 동작: 현재 위치 추적 + 다음 안내 표시) ----
function setNavMode(on){
  navMode = !!on;
  const startBtn = qs('#navStartBtn');
  const stopBtn = qs('#navStopBtn');
  if(startBtn) startBtn.disabled = navMode;
  if(stopBtn) stopBtn.disabled = !navMode;
  if(navMode){
    // ensure geolocation watch is active
    startWatch();
    toast('길안내를 시작합니다');
  } else {
    clearTurnHighlight();
    updateNavBoxStatic();
  }
}

function updateNavBoxStatic(){
  const navNow = qs('#navNow');
  const navMeta = qs('#navMeta');
  if(!navNow || !navMeta) return;
  if(!currentRoute || !Array.isArray(currentRoute.steps) || currentRoute.steps.length===0){
    navNow.textContent = '코스를 선택하면 안내가 표시됩니다.';
    navMeta.textContent = '현재 위치를 켜면(메뉴) 진행 상황이 업데이트됩니다.';
    return;
  }
  navNow.textContent = `다음: ${currentRoute.steps[0]?.instruction || '경로를 따라 이동하세요.'}`;
  navMeta.textContent = '“시작”을 누르면 현재 위치 기준으로 진행 안내가 표시됩니다.';
}

function clearTurnHighlight(){
  qsa('#turnList li').forEach(li=>{ li.classList.remove('active-step'); li.classList.remove('done-step'); });
}

function setTurnHighlight(activeIdx){
  qsa('#turnList li').forEach(li=>{
    const idx = parseInt(li.dataset.step||'-1',10);
    li.classList.toggle('done-step', idx>=0 && idx < activeIdx);
    li.classList.toggle('active-step', idx===activeIdx);
  });
}

function haversineKm(a, b){
  const [lon1,lat1]=a, [lon2,lat2]=b;
  const R=6371;
  const toRad=x=>x*Math.PI/180;
  const dLat=toRad(lat2-lat1);
  const dLon=toRad(lon2-lon1);
  const s1=Math.sin(dLat/2), s2=Math.sin(dLon/2);
  const q = s1*s1 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*s2*s2;
  return 2*R*Math.asin(Math.sqrt(q));
}

function nearestRouteIndex(coords, p){
  let bestI=0, best=Infinity;
  // step through points to keep it cheap
  const step = Math.max(1, Math.floor(coords.length/400));
  for(let i=0;i<coords.length;i+=step){
    const d = haversineKm(coords[i], p);
    if(d<best){ best=d; bestI=i; }
  }
  // local refine
  const start = Math.max(0, bestI - step);
  const end = Math.min(coords.length-1, bestI + step);
  for(let i=start;i<=end;i++){
    const d = haversineKm(coords[i], p);
    if(d<best){ best=d; bestI=i; }
  }
  return {idx: bestI, distKm: best};
}

function estimateRemainingKm(coords, fromIdx, toIdx){
  if(toIdx<=fromIdx) return 0;
  let km=0;
  for(let i=fromIdx;i<toIdx;i++) km += haversineKm(coords[i], coords[i+1]);
  return km;
}

function getActiveStepIndexByWaypoints(steps, idxOnLine){
  for(let i=0;i<steps.length;i++){
    const wp = steps[i]?.way_points;
    if(Array.isArray(wp) && wp.length===2){
      if(idxOnLine <= wp[1]) return i;
    }
  }
  return 0;
}

function updateNavProgress(userLonLat){
  if(!navMode) return;
  if(!currentRoute || !Array.isArray(currentRoute.coords) || currentRoute.coords.length<2) return;
  const coords = currentRoute.coords;
  const steps = currentRoute.steps||[];

  const navNow = qs('#navNow');
  const navMeta = qs('#navMeta');
  if(!navNow || !navMeta) return;

  const nearest = nearestRouteIndex(coords, userLonLat);
  const idxOnLine = nearest.idx;
  const distToRouteM = Math.round(nearest.distKm*1000);

  // follow user on map
  if(map && followUser){
    map.easeTo({center:userLonLat, zoom: Math.max(map.getZoom(), 15), duration: 300});
  }

  let stepIdx = 0;
  let remainKm = 0;
  if(steps.length>0 && Array.isArray(steps[0]?.way_points)){
    stepIdx = getActiveStepIndexByWaypoints(steps, idxOnLine);
    const wp = steps[stepIdx]?.way_points;
    const endIdx = Array.isArray(wp) ? wp[1] : idxOnLine;
    remainKm = estimateRemainingKm(coords, idxOnLine, Math.min(endIdx, coords.length-1));
  } else {
    // fallback: no waypoint info (offline). Highlight based on proximity to stops is not available here.
    stepIdx = 0;
    remainKm = 0;
  }

  const instr = steps[stepIdx]?.instruction || '경로를 따라 이동하세요.';
  navNow.textContent = `다음: ${instr}`;

  if(distToRouteM > 60){
    navMeta.textContent = `경로에서 약 ${distToRouteM}m 벗어났습니다. 지도를 확인해 주세요.`;
  } else {
    const remainM = Math.round(remainKm*1000);
    const remainTxt = remainM>0 ? ` · 다음 안내까지 약 ${remainM}m` : '';
    navMeta.textContent = `경로 근처(오차 ${distToRouteM}m)${remainTxt}`;
  }

  setTurnHighlight(stepIdx);
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

// Overpass/OSM POI toggle
const overpassToggle = qs('#overpassToggle');
if(overpassToggle){
  overpassToggle.checked = (localStorage.getItem(OVERPASS_ENABLED_STORE)||'') !== '0';
  overpassToggle.addEventListener('change', (e)=>{
    const on = !!e.target.checked;
    try{ localStorage.setItem(OVERPASS_ENABLED_STORE, on ? '1' : '0'); }catch(err){}
    toast(on ? 'OSM POI 수집을 켰습니다' : 'OSM POI 수집을 껐습니다');
    // refresh current city POIs
    if(currentCity){
      const token = CITY_TOKEN[currentCity];
      if(token) loadPoisForCity(token, {forceOverpass:true});
    }
  });
}
function startWatch(){
  if(!("geolocation" in navigator)) return alert("이 기기에서 위치 기능을 사용할 수 없습니다.");
  if(watchId) return;
  watchId = navigator.geolocation.watchPosition(pos=>{
    const {latitude, longitude} = pos.coords;
    lastUserLonLat = [longitude, latitude];
    const point = { type:"FeatureCollection", features:[{type:"Feature", properties:{}, geometry:{type:"Point", coordinates:[longitude, latitude]}}] };
    if(!map) initMap();
    if(!map.getSource("me")){
      map.addSource("me",{type:"geojson",data:point});
      map.addLayer({id:"me",type:"circle",source:"me",paint:{"circle-radius":6,"circle-color":"#2D9CDB","circle-stroke-color":"#fff","circle-stroke-width":2}});
    } else { map.getSource("me").setData(point); }

    // live navigation update
    updateNavProgress(lastUserLonLat);
  }, err=>{
    alert("위치 권한을 허용해 주세요."); const lt=qs("#locToggle"); if(lt) lt.checked=false; stopWatch();
  }, {enableHighAccuracy:true, maximumAge:5000, timeout:10000});
}
function stopWatch(){ if(watchId){ navigator.geolocation.clearWatch(watchId); watchId=null; } if(map?.getLayer("me")){ map.removeLayer("me"); map.removeSource("me"); } }

// Tabs
qsa(".tab").forEach(t=> t.addEventListener("click", ()=> show(t.dataset.to)));

// Init flow
document.addEventListener('DOMContentLoaded', ()=>{
  // render countries
  const grid=qs("#countryGrid"); grid.innerHTML='';
  Object.entries(MODEL).forEach(([name,info])=>{
    const b=document.createElement('button'); b.className='card'; b.innerHTML=`<div class="title">${info.emoji} ${name}</div><div class="sub">${info.cities.join(' · ')}</div>`;
    b.addEventListener('click', ()=>{ currentCountry=name; renderCities(name); show('v-cities'); });
    grid.appendChild(b);
  });

  // POI filter chips (map overlay)
  qsa('.chip[data-layer]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const cat = btn.dataset.layer;
      if(!POI_META[cat]) return;
      const next = !poiState[cat];
      btn.classList.toggle('on', next);
      setPoiVisibility(cat, next);
    });
  });

  // Manual POI refresh (Overpass)
  const poiRefreshBtn = qs('#poiRefreshBtn');
  if(poiRefreshBtn){
    poiRefreshBtn.addEventListener('click', ()=>{
      if(!currentCity) return toast('도시/코스를 먼저 선택해 주세요');
      const token = CITY_TOKEN[currentCity];
      if(!token) return;
      loadPoisForCity(token, {forceOverpass:true, bypassCache:true});
    });
  }

  // Navigation controls
  const navStartBtn = qs('#navStartBtn');
  const navStopBtn = qs('#navStopBtn');
  if(navStartBtn) navStartBtn.addEventListener('click', ()=> setNavMode(true));
  if(navStopBtn) navStopBtn.addEventListener('click', ()=> setNavMode(false));
  if(navStopBtn) navStopBtn.disabled = true;

  updateNavBoxStatic();

  // AI panel actions
  const genBtn = qs("#aiGenerateBtn");
  const clearBtn = qs("#aiClearBtn");
  const aiStatus = qs("#aiStatus");
  const aiPrompt = qs("#aiPrompt");
  if(genBtn){
    genBtn.addEventListener('click', async ()=>{
      if(!currentCity){ toast('도시를 먼저 선택하세요'); return; }
      const token = CITY_TOKEN[currentCity];
      const req = (aiPrompt?.value||'').trim();
      if(!req){ toast('원하는 조건을 입력하세요'); return; }
      const hasKey = !!(localStorage.getItem(LLM_KEY_STORE)||"").trim();
      if(!hasKey){ toast('메뉴에서 LLM API 키를 저장하세요'); closeDrawer(); drawer.classList.add('open'); scrim.classList.add('show'); return; }

      genBtn.disabled = true; if(clearBtn) clearBtn.disabled = true;
      if(aiStatus) aiStatus.textContent = 'AI가 코스를 생성 중입니다...';
      try{
        const course = await generateAICourseForCity(currentCity, token, req);
        saveAICourse(token, course);
        if(aiStatus) aiStatus.textContent = '완료. 목록에서 🤖 코스를 선택해 지도로 확인하세요.';
        renderCourses();
      }catch(e){
        console.error(e);
        if(aiStatus) aiStatus.textContent = 'AI 코스 생성에 실패했습니다. 기본 추천 코스를 이용해 주세요.';
        toast('AI 호출 실패(네트워크/CORS/키 확인)');
      }finally{
        genBtn.disabled = false; if(clearBtn) clearBtn.disabled = false;
      }
    });
  }
  if(clearBtn){
    clearBtn.addEventListener('click', ()=>{
      if(!currentCity) return;
      const token = CITY_TOKEN[currentCity];
      clearAICourse(token);
      if(aiStatus) aiStatus.textContent = 'AI 코스를 삭제했습니다.';
      renderCourses();
    });
  }

  show('v-home');
  setTimeout(()=>initMap(), 200);
});
