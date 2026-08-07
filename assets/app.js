import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.111.0/+esm';
import { CONFIG } from '../config.js';

const supabase = createClient(CONFIG.supabaseUrl, CONFIG.supabasePublishableKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'programme-hub-student-auth' }
});

const $ = (id) => document.getElementById(id);
const state = {
  lang: localStorage.getItem('ph-lang') || 'zh',
  projects: [],
  member: null,
  project: null,
  home: null,
  schedule: [],
  notices: [],
  albums: [],
  photos: new Map(),
  liveWeather: null,
  weatherLocation: null,
  weatherTimer: null
};

const translations = {
  zh:{todayCourse:'今日课程',weather:'今日天气',latestNotices:'最新通知',todayPhotos:'今日照片',home:'首页',schedule:'日程',notices:'通知',photos:'照片',profile:'我的'},
  en:{todayCourse:"Today’s Course",weather:"Today’s Weather",latestNotices:'Latest Notices',todayPhotos:"Today’s Photos",home:'Home',schedule:'Schedule',notices:'Notices',photos:'Photos',profile:'Me'}
};

const t = (zh,en) => state.lang === 'zh' ? zh : (en || zh);
const esc = (s='') => String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const localDate = (d=new Date()) => {
  const y=d.getFullYear();
  const m=String(d.getMonth()+1).padStart(2,'0');
  const day=String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
};

async function init(){
  try{
    await loadProjects();
    const { data:{ session } } = await supabase.auth.getSession();
    if(session){
      const { data: member } = await supabase
        .from('members')
        .select('id,project_id,full_name,group_name,member_role,projects(*)')
        .eq('auth_user_id',session.user.id)
        .eq('is_active',true)
        .maybeSingle();
      if(member){
        state.member=member;
        state.project=member.projects;
        await enterApp();
        return;
      }
    }
    showLogin();
  }catch(error){
    showFatal(error);
  }
}

async function loadProjects(){
  const { data, error } = await supabase
    .from('projects')
    .select('id,slug,name_zh,name_en,subtitle_zh,subtitle_en,theme_color,status')
    .eq('status','published')
    .order('start_date',{ascending:false});
  if(error) throw new Error(`无法读取项目：${error.message}。请确认已运行 supabase/schema.sql。`);

  state.projects=data||[];
  const select=$('projectSelect');
  select.innerHTML='';
  for(const p of state.projects){
    const o=document.createElement('option');
    o.value=p.slug;
    o.textContent=t(p.name_zh,p.name_en);
    select.appendChild(o);
  }
  const requested=new URLSearchParams(location.search).get('project');
  if(requested && state.projects.some(p=>p.slug===requested)) select.value=requested;
  if(!state.projects.length) $('loginMessage').textContent='目前没有已发布项目。请先在管理后台创建并发布项目。';
}

function showLogin(){
  $('boot').classList.add('hidden');
  $('appView').classList.add('hidden');
  $('loginView').classList.remove('hidden');
}

function showFatal(error){
  $('boot').textContent=error.message || String(error);
  $('boot').style.color='#ff3b30';
}

async function loginMember(){
  const button=$('loginButton');
  const name=$('memberName').value.trim();
  const pin=$('memberPin').value.trim();
  const slug=$('projectSelect').value;
  if(!slug||!name||!pin){
    setLoginMessage('请选择项目，并输入姓名和 PIN。');
    return;
  }

  button.disabled=true;
  setLoginMessage('正在验证…','ok');
  try{
    let { data:{ session } }=await supabase.auth.getSession();
    if(!session){
      const { error }=await supabase.auth.signInAnonymously();
      if(error) throw new Error(`匿名登录未启用：${error.message}`);
    }

    const { data, error }=await supabase.rpc('claim_member',{
      p_project_slug:slug,
      p_login_name:name,
      p_pin:pin
    });
    if(error) throw error;

    const { data: member, error:memberError }=await supabase
      .from('members')
      .select('id,project_id,full_name,group_name,member_role,projects(*)')
      .eq('id',data.member_id)
      .single();
    if(memberError) throw memberError;

    state.member=member;
    state.project=member.projects;
    setLoginMessage('验证成功。','ok');
    await enterApp();
  }catch(error){
    setLoginMessage(humanError(error));
  }finally{
    button.disabled=false;
  }
}

function humanError(error){
  const m=error?.message||String(error);
  if(/Invalid name or PIN/i.test(m)) return '姓名或 PIN 不正确，请按名单信息重新输入。';
  if(/already been claimed/i.test(m)) return '该成员账号已在另一台设备领取，请联系管理员重置。';
  return m;
}

function setLoginMessage(text,kind=''){
  $('loginMessage').textContent=text;
  $('loginMessage').className=`message ${kind}`;
}

async function enterApp(){
  document.documentElement.style.setProperty('--accent',state.project.theme_color||'#007aff');
  $('loginView').classList.add('hidden');
  $('boot').classList.add('hidden');
  $('appView').classList.remove('hidden');

  await loadProjectData();
  renderAll();
  showPage('home');

  refreshLiveWeather();
  startWeatherRefresh();
}

async function loadProjectData(){
  const id=state.project.id;
  const [homeRes,scheduleRes,noticeRes,albumRes]=await Promise.all([
    supabase.from('project_home').select('*').eq('project_id',id).maybeSingle(),
    supabase.from('schedule_items').select('*').eq('project_id',id).eq('is_published',true).order('event_date').order('sort_order').order('start_time'),
    supabase.from('notices').select('*').eq('project_id',id).eq('is_published',true).order('is_pinned',{ascending:false}).order('priority',{ascending:false}).order('publish_at',{ascending:false}),
    supabase.from('albums').select('*').eq('project_id',id).eq('is_published',true).order('event_date',{ascending:false}).order('sort_order')
  ]);

  for(const r of [homeRes,scheduleRes,noticeRes,albumRes]) if(r.error) throw r.error;

  state.home=homeRes.data||{};
  state.schedule=scheduleRes.data||[];
  state.notices=noticeRes.data||[];
  state.albums=albumRes.data||[];
  state.liveWeather=null;
  state.weatherLocation=null;
  $('scheduleDate').value=localDate();
  await hydrateAlbumCovers();
}

async function hydrateAlbumCovers(){
  for(const album of state.albums){
    album.cover_url='';
    if(album.cover_path){
      const { data }=await supabase.storage.from(CONFIG.photoBucket).createSignedUrl(album.cover_path,3600);
      album.cover_url=data?.signedUrl||'';
    }
  }
}

function renderAll(){
  const p=state.project;
  const h=state.home||{};

  $('projectName').textContent=t(p.name_zh,p.name_en);
  $('projectLabel').textContent=t(p.subtitle_zh||'PROGRAMME',p.subtitle_en||'PROGRAMME');
  $('dateText').textContent=new Intl.DateTimeFormat(state.lang==='zh'?'zh-CN':'en-US',{
    month:'long',day:'numeric',weekday:'long'
  }).format(new Date());

  const hour=new Date().getHours();
  const greet=state.lang==='zh'
    ? (hour<12?'早上好':hour<18?'下午好':'晚上好')
    : (hour<12?'Good morning':hour<18?'Good afternoon':'Good evening');

  $('greetingText').textContent=`${greet}，${state.member.full_name}`;
  $('welcomeText').textContent=t(
    h.welcome_zh||'今天的重要信息，都在这里。',
    h.welcome_en||'Everything important for today, in one place.'
  );

  renderTranslations();
  renderCourse();
  renderWeather();
  renderNotices();
  renderAlbums();
  renderSchedule();
  renderProfile();

  // Homepage modules are controlled directly from Admin → 首页.
  $('courseCard').classList.toggle('hidden',h.show_course===false);
  $('weatherCard').classList.toggle('hidden',h.show_weather===false);
  $('noticeCard').classList.toggle('hidden',h.show_notices===false);
  $('albumCard').classList.toggle('hidden',h.show_photos===false);
}

function renderTranslations(){
  document.querySelectorAll('[data-i18n]').forEach(el=>{
    const key=el.dataset.i18n;
    el.textContent=translations[state.lang][key]||key;
  });
  $('languageButton').textContent=state.lang==='zh'?'EN':'中';
}

function formatTime(item){
  const trim=(s)=>s?String(s).slice(0,5):'';
  return item.end_time?`${trim(item.start_time)}–${trim(item.end_time)}`:trim(item.start_time);
}

function renderCourse(){
  const item=state.schedule.find(x=>x.event_date===localDate());
  $('courseEmpty').classList.toggle('hidden',!!item);
  $('courseContent').classList.toggle('hidden',!item);
  if(!item)return;
  $('courseTime').textContent=formatTime(item);
  $('courseTitle').textContent=t(item.title_zh,item.title_en);
  $('courseSpeaker').textContent=item.speaker_zh||item.speaker_en?`👤 ${t(item.speaker_zh,item.speaker_en)}`:'';
  $('courseLocation').textContent=item.location_zh||item.location_en?`⌖ ${t(item.location_zh,item.location_en)}`:'';
}

const weatherCodes={
  0:['晴','Clear sky'],
  1:['晴间多云','Mainly clear'],
  2:['多云','Partly cloudy'],
  3:['阴','Overcast'],
  45:['有雾','Fog'],
  48:['雾凇','Rime fog'],
  51:['小毛毛雨','Light drizzle'],
  53:['毛毛雨','Drizzle'],
  55:['较强毛毛雨','Dense drizzle'],
  56:['轻微冻毛毛雨','Light freezing drizzle'],
  57:['冻毛毛雨','Freezing drizzle'],
  61:['小雨','Light rain'],
  63:['中雨','Rain'],
  65:['大雨','Heavy rain'],
  66:['轻微冻雨','Light freezing rain'],
  67:['冻雨','Freezing rain'],
  71:['小雪','Light snow'],
  73:['中雪','Snow'],
  75:['大雪','Heavy snow'],
  77:['米雪','Snow grains'],
  80:['小阵雨','Light showers'],
  81:['阵雨','Showers'],
  82:['强阵雨','Heavy showers'],
  85:['小阵雪','Light snow showers'],
  86:['强阵雪','Heavy snow showers'],
  95:['雷雨','Thunderstorm'],
  96:['雷雨伴小冰雹','Thunderstorm with hail'],
  99:['强雷雨伴冰雹','Severe thunderstorm with hail']
};

function weatherDescription(code){
  const item=weatherCodes[Number(code)]||['天气情况','Weather'];
  return t(item[0],item[1]);
}

function weatherAdvice(w){
  const zh=[];
  const en=[];

  if(Number(w.high)>=35 || Number(w.apparent)>=35){
    zh.push('天气炎热，注意防暑并及时补水。');
    en.push('Hot conditions today. Stay hydrated and avoid prolonged heat exposure.');
  }

  if(Number(w.rain)>=60){
    zh.push('降雨概率较高，建议携带雨具。');
    en.push('Rain is likely. Bring an umbrella.');
  }else if(Number(w.rain)>=35){
    zh.push('有降雨可能，出门可备雨具。');
    en.push('Showers are possible. Consider bringing an umbrella.');
  }

  if(Number(w.uv)>=8){
    zh.push('紫外线较强，户外活动注意防晒。');
    en.push('UV levels are high. Use sun protection outdoors.');
  }

  return t(zh.join(' '),en.join(' '));
}

function renderWeather(){
  const h=state.home||{};
  const w=state.liveWeather;
  $('weatherCity').textContent=t(h.weather_city_zh||'上海',h.weather_city_en||'Shanghai');

  if(w){
    $('weatherTemperature').textContent=`${Math.round(w.temperature)}°`;
    $('weatherSummary').textContent=`${weatherDescription(w.code)} · ${t('最高','H')} ${Math.round(w.high)}° / ${t('最低','L')} ${Math.round(w.low)}°`;
    $('weatherRain').textContent=(state.lang==='zh'?'降雨 ':'Rain ')+`${Math.round(w.rain)}%`;
    $('weatherHumidity').textContent=(state.lang==='zh'?'湿度 ':'Humidity ')+`${Math.round(w.humidity)}%`;
    const advice=weatherAdvice(w);
    const source=t('天气数据：Open-Meteo · 自动更新','Weather: Open-Meteo · Auto-updated');
    $('weatherTip').textContent=advice?`${advice} ${source}`:source;
    return;
  }

  // Manual values remain only as a fallback if the live weather service is unavailable.
  $('weatherTemperature').textContent=h.weather_temperature||'--°';
  $('weatherSummary').textContent=t(h.weather_summary_zh||'正在获取实时天气…',h.weather_summary_en||'Loading live weather…');
  $('weatherRain').textContent=(state.lang==='zh'?'降雨 ':'Rain ')+(h.weather_rain_probability||'--');
  $('weatherHumidity').textContent=(state.lang==='zh'?'湿度 ':'Humidity ')+(h.weather_humidity||'--');
  $('weatherTip').textContent=t(h.weather_tip_zh||'',h.weather_tip_en||'');
}

async function resolveWeatherLocation(){
  const h=state.home||{};
  const query=(h.weather_city_en||h.weather_city_zh||'Shanghai').trim();
  if(state.weatherLocation?.query===query) return state.weatherLocation;

  const url=`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&language=en&format=json`;
  const response=await fetch(url,{cache:'no-store'});
  if(!response.ok) throw new Error(`Weather geocoding failed (${response.status})`);
  const payload=await response.json();
  const place=payload.results?.[0];
  if(!place) throw new Error(`Weather city not found: ${query}`);

  state.weatherLocation={
    query,
    latitude:place.latitude,
    longitude:place.longitude,
    timezone:place.timezone||'auto'
  };
  return state.weatherLocation;
}

async function refreshLiveWeather(){
  const h=state.home||{};
  if(h.show_weather===false) return;

  try{
    const loc=await resolveWeatherLocation();
    const params=new URLSearchParams({
      latitude:String(loc.latitude),
      longitude:String(loc.longitude),
      current:'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code',
      daily:'temperature_2m_max,temperature_2m_min,precipitation_probability_max,uv_index_max',
      timezone:'auto',
      forecast_days:'1',
      temperature_unit:'celsius'
    });

    const response=await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`,{cache:'no-store'});
    if(!response.ok) throw new Error(`Weather request failed (${response.status})`);
    const data=await response.json();

    state.liveWeather={
      temperature:Number(data.current?.temperature_2m),
      apparent:Number(data.current?.apparent_temperature),
      humidity:Number(data.current?.relative_humidity_2m),
      code:Number(data.current?.weather_code),
      high:Number(data.daily?.temperature_2m_max?.[0]),
      low:Number(data.daily?.temperature_2m_min?.[0]),
      rain:Number(data.daily?.precipitation_probability_max?.[0]??0),
      uv:Number(data.daily?.uv_index_max?.[0]??0),
      updatedAt:new Date()
    };

    renderWeather();
  }catch(error){
    console.warn('Live weather unavailable; using manual fallback.',error);
    state.liveWeather=null;
    renderWeather();
  }
}

function startWeatherRefresh(){
  if(state.weatherTimer) clearInterval(state.weatherTimer);
  state.weatherTimer=setInterval(refreshLiveWeather,15*60*1000);
}

function renderNotices(){
  const itemHtml=state.notices.slice(0,3).map(n=>`<div class="list-item"><span class="dot ${n.priority===2?'important':''}"></span><div><h3>${esc(t(n.title_zh,n.title_en))}</h3><p>${esc(t(n.body_zh,n.body_en))}</p></div></div>`).join('')||`<div class="empty">${t('暂无通知。','No notices.')}</div>`;
  $('homeNotices').innerHTML=itemHtml;
  $('noticeList').innerHTML=state.notices.map(n=>`<article class="notice-box card"><span class="tag ${n.priority===2?'important':''}">${n.priority===2?t('重要','IMPORTANT'):n.priority===1?t('提醒','REMINDER'):t('通知','NOTICE')}</span><h2>${esc(t(n.title_zh,n.title_en))}</h2><p>${esc(t(n.body_zh,n.body_en))}</p><time>${new Date(n.publish_at).toLocaleString(state.lang==='zh'?'zh-CN':'en-US')}</time></article>`).join('')||`<div class="empty card">${t('暂无通知。','No notices.')}</div>`;
}

function albumMarkup(album){
  const bg=album.cover_url?`<img src="${esc(album.cover_url)}" alt="">`:'';
  return `<article class="album-cover" data-album="${album.id}">${bg}<div class="album-caption"><strong>${esc(t(album.title_zh,album.title_en))}</strong><small>${album.event_date||''}</small></div></article>`;
}

function renderAlbums(){
  const html=state.albums.map(albumMarkup).join('')||`<div class="empty">${t('暂无已发布相册。','No published albums.')}</div>`;
  $('homeAlbums').innerHTML=html;
  $('albumList').innerHTML=html;
  document.querySelectorAll('[data-album]').forEach(el=>el.addEventListener('click',()=>openAlbum(el.dataset.album)));
}

function renderSchedule(){
  const date=$('scheduleDate').value||localDate();
  const items=state.schedule.filter(x=>x.event_date===date);
  $('scheduleList').innerHTML=items.map(x=>`<div class="timeline-row"><div class="timeline-time">${esc(formatTime(x))}</div><div class="timeline-axis"></div><div class="timeline-content"><h3>${esc(t(x.title_zh,x.title_en))}</h3><p>${esc([t(x.location_zh,x.location_en),t(x.speaker_zh,x.speaker_en)].filter(Boolean).join(' · '))}</p></div></div>`).join('')||`<div class="empty">${t('这一天暂无已发布日程。','No published schedule for this date.')}</div>`;
}

function renderProfile(){
  $('profileAvatar').textContent=(state.member.full_name[0]||'U').toUpperCase();
  $('profileName').textContent=state.member.full_name;
  $('profileMeta').textContent=[t(state.project.name_zh,state.project.name_en),state.member.group_name,state.member.member_role].filter(Boolean).join(' · ');
}

async function openAlbum(albumId){
  const album=state.albums.find(a=>a.id===albumId);
  if(!album)return;
  $('albumList').classList.add('hidden');
  $('photoViewer').classList.remove('hidden');
  $('viewerTitle').textContent=t(album.title_zh,album.title_en);
  $('photoList').innerHTML='<div class="empty">正在加载…</div>';

  let photos=state.photos.get(albumId);
  if(!photos){
    const { data,error }=await supabase.from('photos').select('*').eq('album_id',albumId).eq('is_published',true).order('sort_order');
    if(error){
      $('photoList').innerHTML=`<div class="empty">${esc(error.message)}</div>`;
      return;
    }
    photos=data||[];
    for(const photo of photos){
      const {data:signed}=await supabase.storage.from(CONFIG.photoBucket).createSignedUrl(photo.storage_path,3600);
      photo.url=signed?.signedUrl||'';
    }
    state.photos.set(albumId,photos);
  }

  $('photoList').innerHTML=photos.map(p=>`<figure><img src="${esc(p.url)}" loading="lazy" alt="${esc(t(p.caption_zh,p.caption_en)||'活动照片')}"><figcaption>${esc(t(p.caption_zh,p.caption_en)||'')}</figcaption></figure>`).join('')||`<div class="empty">${t('相册中暂无照片。','No photos in this album.')}</div>`;
  showPage('photos');
}

function showPage(name){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  $(`${name}Page`).classList.add('active');
  document.querySelectorAll('[data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page===name));
  scrollTo(0,0);
}

async function logout(){
  if(state.weatherTimer){
    clearInterval(state.weatherTimer);
    state.weatherTimer=null;
  }
  await supabase.auth.signOut();
  state.member=null;
  state.project=null;
  state.liveWeather=null;
  state.weatherLocation=null;
  $('memberPin').value='';
  showLogin();
}

$('loginButton').addEventListener('click',loginMember);
$('memberPin').addEventListener('keydown',e=>{if(e.key==='Enter')loginMember();});
$('languageButton').addEventListener('click',()=>{
  state.lang=state.lang==='zh'?'en':'zh';
  localStorage.setItem('ph-lang',state.lang);
  renderAll();
});
$('logoutButton').addEventListener('click',logout);
$('scheduleDate').addEventListener('change',renderSchedule);
$('closeViewer').addEventListener('click',()=>{
  $('photoViewer').classList.add('hidden');
  $('albumList').classList.remove('hidden');
});
document.querySelectorAll('[data-page]').forEach(b=>b.addEventListener('click',()=>showPage(b.dataset.page)));
document.querySelectorAll('[data-page-link]').forEach(b=>b.addEventListener('click',()=>showPage(b.dataset.pageLink)));

init();
