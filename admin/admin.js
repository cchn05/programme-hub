import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.111.0/+esm';
import QRCode from 'https://cdn.jsdelivr.net/npm/qrcode@1.5.4/+esm';
import { CONFIG } from '../config.js';

const supabase=createClient(CONFIG.supabaseUrl,CONFIG.supabasePublishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storageKey:'programme-hub-admin-auth'}});
const $=id=>document.getElementById(id);
const state={user:null,profile:null,projects:[],project:null,home:null,schedule:[],notices:[],albums:[],members:[],selectedAlbum:null};
const esc=(s='')=>String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const today=()=>{const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')};
const formData=form=>Object.fromEntries(new FormData(form).entries());
const nullable=v=>v===''?null:v;
const trimTime=v=>v?String(v).slice(0,5):'';
const mb=n=>(n/1024/1024).toFixed(1);

async function init(){
  const {data:{session}}=await supabase.auth.getSession();
  if(!session){showLogin();return;}
  state.user=session.user;
  await checkAdmin();
}
function showLogin(){$('boot').classList.add('hidden');$('setupView').classList.add('hidden');$('adminApp').classList.add('hidden');$('loginView').classList.remove('hidden')}
async function login(){
  const email=$('adminEmail').value.trim(),password=$('adminPassword').value;
  if(!email||!password){setLogin('请输入邮箱和密码。');return}
  $('adminLoginButton').disabled=true;setLogin('正在登录…','ok');
  const {data,error}=await supabase.auth.signInWithPassword({email,password});
  $('adminLoginButton').disabled=false;
  if(error){setLogin(error.message);return}
  state.user=data.user;await checkAdmin();
}
function setLogin(msg,kind=''){$('loginMessage').textContent=msg;$('loginMessage').className=`message ${kind}`}
async function checkAdmin(){
  const {data,error}=await supabase.from('admin_profiles').select('*').eq('user_id',state.user.id).maybeSingle();
  if(error){setLogin(`后台数据表尚未安装或无权访问：${error.message}`);showLogin();return}
  if(!data){showSetup();return}
  state.profile=data;await startAdmin();
}
function showSetup(){
  $('boot').classList.add('hidden');$('loginView').classList.add('hidden');$('adminApp').classList.add('hidden');$('setupView').classList.remove('hidden');
  const name=(state.user.email||'Administrator').split('@')[0];
  $('setupSql').value=`insert into public.admin_profiles (user_id, display_name, is_super_admin)\nvalues ('${state.user.id}', '${name.replaceAll("'","''")}', true)\non conflict (user_id) do update\nset is_super_admin = true;`;
}
async function startAdmin(){$('boot').classList.add('hidden');$('loginView').classList.add('hidden');$('setupView').classList.add('hidden');$('adminApp').classList.remove('hidden');await loadProjects();showSection('overview')}
function showError(error){console.error(error);setStatus(error.message||String(error),true)}
function setStatus(msg,error=false){$('saveStatus').textContent=msg;$('saveStatus').style.color=error?'#ff3b30':'#238636';$('saveStatus').style.background=error?'rgba(255,59,48,.09)':'rgba(35,134,54,.09)'}

async function loadProjects(preferred){
  const {data,error}=await supabase.from('projects').select('*').order('start_date',{ascending:false,nullsFirst:false}).order('created_at',{ascending:false});
  if(error){showError(error);return}
  state.projects=data||[];
  const picker=$('projectPicker');picker.innerHTML=state.projects.map(p=>`<option value="${p.id}">${esc(p.name_zh)}</option>`).join('');
  const id=preferred||state.project?.id||state.projects[0]?.id;
  state.project=state.projects.find(p=>p.id===id)||state.projects[0]||null;
  if(state.project)picker.value=state.project.id;
  await projectChanged();
}
async function projectChanged(){
  if(!state.project){$('topProjectName').textContent='尚未创建项目';$('topProjectSlug').textContent='PROJECT';renderProjectForm(null);renderOverview();return}
  document.documentElement.style.setProperty('--accent',state.project.theme_color||'#007aff');
  $('topProjectName').textContent=state.project.name_zh;$('topProjectSlug').textContent=state.project.slug;$('previewLink').href=projectUrl();
  await loadProjectData();renderAll();
}
async function loadProjectData(){
  const id=state.project.id;setStatus('正在同步…');
  const [h,s,n,a,m]=await Promise.all([
    supabase.from('project_home').select('*').eq('project_id',id).maybeSingle(),
    supabase.from('schedule_items').select('*').eq('project_id',id).order('event_date',{ascending:false}).order('sort_order').order('start_time'),
    supabase.from('notices').select('*').eq('project_id',id).order('is_pinned',{ascending:false}).order('publish_at',{ascending:false}),
    supabase.from('albums').select('*').eq('project_id',id).order('event_date',{ascending:false}).order('sort_order'),
    supabase.from('members').select('*').eq('project_id',id).order('full_name')
  ]);
  for(const r of [h,s,n,a,m])if(r.error)throw r.error;
  state.home=h.data||{};state.schedule=s.data||[];state.notices=n.data||[];state.albums=a.data||[];state.members=m.data||[];
  state.selectedAlbum=state.albums.find(a=>a.id===state.selectedAlbum?.id)||null;
  setStatus('已同步');
}
function renderAll(){renderOverview();renderProjectForm(state.project);renderHome();renderSchedule();renderNotices();renderAlbums();renderMembers();renderShare()}
function renderOverview(){$('metrics').innerHTML=[['今日活动',state.schedule.filter(x=>x.event_date===today()).length],['已发布通知',state.notices.filter(x=>x.is_published).length],['相册',state.albums.length],['成员',state.members.length]].map(x=>`<article class="metric card"><small>${x[0]}</small><strong>${x[1]}</strong></article>`).join('')}

function fillForm(form,obj={}){for(const el of form.elements){if(!el.name)continue;if(el.type==='checkbox')el.checked=Boolean(obj[el.name]);else el.value=obj[el.name]??''}}
function renderProjectForm(project){fillForm($('projectForm'),project||{theme_color:'#007aff',status:'draft',is_public:false});$('deleteProjectButton').classList.toggle('hidden',!project)}
async function saveProject(e){
  e.preventDefault();const f=e.currentTarget,d=formData(f);
  const payload={slug:d.slug.trim().toLowerCase(),name_zh:d.name_zh.trim(),name_en:nullable(d.name_en.trim()),subtitle_zh:nullable(d.subtitle_zh.trim()),subtitle_en:nullable(d.subtitle_en.trim()),theme_color:d.theme_color,start_date:nullable(d.start_date),end_date:nullable(d.end_date),status:d.status,is_public:f.elements.is_public.checked};
  setStatus('正在保存…');let result;
  if(d.id)result=await supabase.from('projects').update(payload).eq('id',d.id).select().single();else result=await supabase.from('projects').insert(payload).select().single();
  if(result.error){showError(result.error);return}
  if(!d.id)await supabase.from('project_home').insert({project_id:result.data.id,welcome_zh:'今天的重要信息，都在这里。',welcome_en:'Everything important for today, in one place.'});
  await loadProjects(result.data.id);setStatus('项目已保存');
}
async function deleteProject(){if(!state.project||!confirm(`确定删除“${state.project.name_zh}”及其全部数据吗？`))return;const {error}=await supabase.from('projects').delete().eq('id',state.project.id);if(error){showError(error);return}state.project=null;await loadProjects()}

function renderHome(){const defaults={show_course:true,show_weather:true,show_notices:true,show_photos:true,weather_city_zh:'上海',weather_city_en:'Shanghai'};fillForm($('homeForm'),{...defaults,...state.home})}
async function saveHome(e){
  e.preventDefault();if(!state.project)return;const f=e.currentTarget,d=formData(f);
  const payload={project_id:state.project.id,welcome_zh:nullable(d.welcome_zh),welcome_en:nullable(d.welcome_en),weather_city_zh:nullable(d.weather_city_zh),weather_city_en:nullable(d.weather_city_en),weather_temperature:nullable(d.weather_temperature),weather_summary_zh:nullable(d.weather_summary_zh),weather_summary_en:nullable(d.weather_summary_en),weather_rain_probability:nullable(d.weather_rain_probability),weather_humidity:nullable(d.weather_humidity),weather_tip_zh:nullable(d.weather_tip_zh),weather_tip_en:nullable(d.weather_tip_en),show_course:f.elements.show_course.checked,show_weather:f.elements.show_weather.checked,show_notices:f.elements.show_notices.checked,show_photos:f.elements.show_photos.checked};
  const {error}=await supabase.from('project_home').upsert(payload);if(error){showError(error);return}state.home=payload;setStatus('首页已保存');
}

function renderSchedule(){const date=$('scheduleFilterDate').value||today();$('scheduleFilterDate').value=date;const rows=state.schedule.filter(x=>x.event_date===date);$('scheduleTable').innerHTML=table(['时间','标题','地点 / 主讲人','状态','操作'],rows.map(x=>[`${trimTime(x.start_time)}${x.end_time?'–'+trimTime(x.end_time):''}`,esc(x.title_zh),esc([x.location_zh,x.speaker_zh].filter(Boolean).join(' · ')),x.is_published?'<span class="badge live">已发布</span>':'<span class="badge">草稿</span>',actions('schedule',x.id)]));bindRowActions()}
function openSchedule(item={}){$('scheduleForm').classList.remove('hidden');fillForm($('scheduleForm'),{event_date:$('scheduleFilterDate').value||today(),sort_order:0,is_published:true,...item});$('scheduleForm').scrollIntoView({behavior:'smooth',block:'start'})}
async function saveSchedule(e){e.preventDefault();const f=e.currentTarget,d=formData(f),payload={project_id:state.project.id,event_date:d.event_date,start_time:nullable(d.start_time),end_time:nullable(d.end_time),title_zh:d.title_zh.trim(),title_en:nullable(d.title_en.trim()),location_zh:nullable(d.location_zh.trim()),location_en:nullable(d.location_en.trim()),speaker_zh:nullable(d.speaker_zh.trim()),speaker_en:nullable(d.speaker_en.trim()),description_zh:nullable(d.description_zh.trim()),description_en:nullable(d.description_en.trim()),sort_order:Number(d.sort_order||0),is_published:f.elements.is_published.checked};const r=d.id?await supabase.from('schedule_items').update(payload).eq('id',d.id):await supabase.from('schedule_items').insert(payload);if(r.error){showError(r.error);return}f.classList.add('hidden');await refresh();setStatus('日程已保存')}
async function copyPrevious(){const target=new Date(`${$('scheduleFilterDate').value||today()}T12:00:00`);target.setDate(target.getDate()-1);const source=target.toISOString().slice(0,10);const items=state.schedule.filter(x=>x.event_date===source);if(!items.length){alert('前一天没有日程。');return}const date=$('scheduleFilterDate').value||today();const payload=items.map(({id,created_at,updated_at,...x})=>({...x,event_date:date,is_published:false}));const {error}=await supabase.from('schedule_items').insert(payload);if(error){showError(error);return}await refresh();setStatus('已复制为草稿')}

function renderNotices(){$('noticeTable').innerHTML=table(['标题','内容','级别','状态','操作'],state.notices.map(x=>[esc(x.title_zh),esc(x.body_zh.slice(0,80)),x.priority===2?'<span class="badge important">重要</span>':x.priority===1?'<span class="badge">提醒</span>':'普通',x.is_published?'<span class="badge live">已发布</span>':'<span class="badge">草稿</span>',actions('notice',x.id)]));bindRowActions()}
function openNotice(item={}){const normalized={priority:0,is_published:true,is_pinned:false,...item,expire_at:item.expire_at?new Date(item.expire_at).toISOString().slice(0,16):''};$('noticeForm').classList.remove('hidden');fillForm($('noticeForm'),normalized)}
async function saveNotice(e){e.preventDefault();const f=e.currentTarget,d=formData(f),payload={project_id:state.project.id,title_zh:d.title_zh.trim(),title_en:nullable(d.title_en.trim()),body_zh:d.body_zh.trim(),body_en:nullable(d.body_en.trim()),priority:Number(d.priority),is_pinned:f.elements.is_pinned.checked,is_published:f.elements.is_published.checked,expire_at:d.expire_at?new Date(d.expire_at).toISOString():null,publish_at:new Date().toISOString()};const r=d.id?await supabase.from('notices').update(payload).eq('id',d.id):await supabase.from('notices').insert(payload);if(r.error){showError(r.error);return}f.classList.add('hidden');await refresh();setStatus('通知已保存')}

function renderAlbums(){$('albumTable').innerHTML=table(['相册','日期','可见范围','状态','操作'],state.albums.map(x=>[esc(x.title_zh),x.event_date||'',esc(x.visibility),x.is_published?'<span class="badge live">已发布</span>':'<span class="badge">草稿</span>',`${actions('album',x.id)} <button class="select-album" data-id="${x.id}">照片</button>`]));bindRowActions();document.querySelectorAll('.select-album').forEach(b=>b.addEventListener('click',()=>selectAlbum(b.dataset.id)));renderPhotoManager()}
function openAlbumEditor(item={}){$('albumForm').classList.remove('hidden');fillForm($('albumForm'),{event_date:today(),sort_order:0,visibility:'member',is_published:false,...item})}
async function saveAlbum(e){e.preventDefault();const f=e.currentTarget,d=formData(f),payload={project_id:state.project.id,title_zh:d.title_zh.trim(),title_en:nullable(d.title_en.trim()),event_date:nullable(d.event_date),sort_order:Number(d.sort_order||0),visibility:d.visibility,is_published:f.elements.is_published.checked};const r=d.id?await supabase.from('albums').update(payload).eq('id',d.id).select().single():await supabase.from('albums').insert(payload).select().single();if(r.error){showError(r.error);return}state.selectedAlbum=r.data;f.classList.add('hidden');await refresh();setStatus('相册已保存')}
async function selectAlbum(id){state.selectedAlbum=state.albums.find(x=>x.id===id);await renderPhotoManager()}
async function renderPhotoManager(){
  const box=$('photoManager');
  if(!state.selectedAlbum){box.innerHTML='<h2>照片管理</h2><p class="muted">先选择一个相册。</p>';return}
  box.innerHTML=`<h2>${esc(state.selectedAlbum.title_zh)}</h2><div class="upload-box"><label>批量上传照片<input id="photoFiles" type="file" accept="image/*" multiple></label><button id="uploadPhotos" class="primary compact">上传</button><p id="uploadProgress" class="muted">建议单张原图不超过 20 MB；系统会自动压缩适合网页展示的照片。</p></div><div id="photoAdminGrid" class="photo-admin-grid"><p class="muted">正在加载…</p></div>`;
  $('uploadPhotos').addEventListener('click',uploadPhotos);
  await loadAdminPhotos();
}
async function loadAdminPhotos(){
  if(!state.selectedAlbum)return;
  const {data,error}=await supabase.from('photos').select('*').eq('album_id',state.selectedAlbum.id).order('sort_order');
  if(error){showError(error);const grid=$('photoAdminGrid');if(grid)grid.innerHTML=`<p class="muted">读取照片失败：${esc(error.message)}</p>`;return}
  for(const p of data){const {data:s,error:signedError}=await supabase.storage.from(CONFIG.photoBucket).createSignedUrl(p.storage_path,3600);p.url=signedError?'':(s?.signedUrl||'')}
  const grid=$('photoAdminGrid');if(!grid)return;
  grid.innerHTML=data.map(p=>`<div class="photo-admin">${p.url?`<img src="${esc(p.url)}" alt="">`:'<div class="muted">无法预览</div>'}<button data-photo-id="${p.id}" data-path="${esc(p.storage_path)}">×</button></div>`).join('')||'<p class="muted">暂无照片。</p>';
  document.querySelectorAll('[data-photo-id]').forEach(b=>b.addEventListener('click',()=>deletePhoto(b.dataset.photoId,b.dataset.path)));
}
function safeName(name){return name.normalize('NFKD').replace(/[^a-zA-Z0-9._-]/g,'-').replace(/-+/g,'-').toLowerCase()||'photo.jpg'}
function timeoutPromise(promise,ms,message){return Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>reject(new Error(message)),ms))])}
async function compressImage(file){
  if(!file.type.startsWith('image/'))throw new Error(`${file.name} 不是图片文件。`);
  if(file.size<=2.5*1024*1024)return file;
  try{
    const bitmap=await createImageBitmap(file);
    const maxSide=2200;
    const scale=Math.min(1,maxSide/Math.max(bitmap.width,bitmap.height));
    const width=Math.max(1,Math.round(bitmap.width*scale));
    const height=Math.max(1,Math.round(bitmap.height*scale));
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0,width,height);bitmap.close?.();
    const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('图片压缩失败')),'image/jpeg',0.84));
    if(blob.size>=file.size)return file;
    return new File([blob],`${file.name.replace(/\.[^.]+$/,'')}.jpg`,{type:'image/jpeg',lastModified:Date.now()});
  }catch(error){
    console.warn('Image compression skipped:',error);
    if(file.size>8*1024*1024)throw new Error(`${file.name} 为 ${mb(file.size)} MB，浏览器无法压缩。请先转为 JPG/PNG 或缩小后再上传。`);
    return file;
  }
}
async function uploadPhotos(){
  const input=$('photoFiles');const button=$('uploadPhotos');const progress=$('uploadProgress');
  const files=[...(input?.files||[])];
  if(!files.length){progress.textContent='请先选择至少一张照片。';return}
  if(!state.project||!state.selectedAlbum){progress.textContent='未选择项目或相册，请重新选择相册。';return}
  const albumId=state.selectedAlbum.id;const projectId=state.project.id;
  button.disabled=true;input.disabled=true;setStatus('正在上传照片…');
  let done=0;
  try{
    for(const original of files){
      progress.textContent=`正在处理 ${done+1}/${files.length}：${original.name}（${mb(original.size)} MB）`;
      const file=await compressImage(original);
      progress.textContent=`正在上传 ${done+1}/${files.length}：${file.name}（${mb(file.size)} MB）`;
      const path=`${projectId}/${albumId}/${Date.now()}-${Math.random().toString(36).slice(2,8)}-${safeName(file.name)}`;
      let up;
      try{
        up=await timeoutPromise(
          supabase.storage.from(CONFIG.photoBucket).upload(path,file,{cacheControl:'3600',upsert:false,contentType:file.type||'image/jpeg'}),
          60000,
          `上传超时：${file.name}。请检查网络后重试。`
        );
      }catch(error){throw error}
      if(up.error)throw new Error(`Storage 上传失败：${up.error.message}`);

      progress.textContent=`正在保存 ${done+1}/${files.length}：${file.name}`;
      const ins=await supabase.from('photos').insert({album_id:albumId,storage_path:path,sort_order:Date.now()+done,is_published:true,uploaded_by:state.user.id});
      if(ins.error){await supabase.storage.from(CONFIG.photoBucket).remove([path]);throw new Error(`照片已上传，但保存记录失败：${ins.error.message}`)}

      if(!state.selectedAlbum.cover_path){
        const cover=await supabase.from('albums').update({cover_path:path}).eq('id',albumId);
        if(cover.error)console.warn('Cover update failed:',cover.error);
        else state.selectedAlbum.cover_path=path;
      }
      done++;
      progress.textContent=`已完成 ${done}/${files.length}`;
    }

    setStatus(`已上传 ${done} 张照片`);
    progress.textContent=`上传成功：${done} 张照片。正在刷新相册…`;
    input.value='';
    await loadProjectData();
    state.selectedAlbum=state.albums.find(a=>a.id===albumId)||null;
    renderOverview();renderAlbums();
    state.selectedAlbum=state.albums.find(a=>a.id===albumId)||null;
    await renderPhotoManager();
    const finalProgress=$('uploadProgress');if(finalProgress)finalProgress.textContent=`上传成功，共 ${done} 张。`;
  }catch(error){
    console.error(error);setStatus(error.message||String(error),true);
    progress.textContent=`上传失败：${error.message||String(error)}`;
    progress.style.color='#ff3b30';
  }finally{
    const currentButton=$('uploadPhotos');const currentInput=$('photoFiles');
    if(currentButton)currentButton.disabled=false;if(currentInput)currentInput.disabled=false;
  }
}
async function deletePhoto(id,path){if(!confirm('删除这张照片？'))return;const rm=await supabase.storage.from(CONFIG.photoBucket).remove([path]);if(rm.error){showError(rm.error);return}const {error}=await supabase.from('photos').delete().eq('id',id);if(error){showError(error);return}await loadAdminPhotos()}

function renderMembers(){$('memberTable').innerHTML=table(['姓名','登录名','分组','身份','状态','操作'],state.members.map(x=>[esc(x.full_name),esc(x.login_name),esc(x.group_name||''),esc(x.member_role||''),x.auth_user_id?'<span class="badge live">已领取</span>':x.is_active?'<span class="badge">未领取</span>':'<span class="badge important">停用</span>',`<div class="row-actions"><button data-reset-member="${x.id}">重置 PIN</button><button data-delete-member="${x.id}">删除</button></div>`]));document.querySelectorAll('[data-reset-member]').forEach(b=>b.addEventListener('click',()=>resetMember(b.dataset.resetMember)));document.querySelectorAll('[data-delete-member]').forEach(b=>b.addEventListener('click',()=>deleteMember(b.dataset.deleteMember)))}
async function addMember(e){e.preventDefault();const d=formData(e.currentTarget);const {error}=await supabase.rpc('create_member_with_pin',{p_project_id:state.project.id,p_full_name:d.full_name.trim(),p_login_name:d.login_name.trim(),p_pin:d.pin.trim(),p_group_name:nullable(d.group_name.trim()),p_member_role:d.member_role.trim()||'student'});if(error){showError(error);return}e.currentTarget.reset();e.currentTarget.elements.member_role.value='student';await refresh();setStatus('成员已添加')}
async function resetMember(id){const pin=prompt('输入新的 4–8 位 PIN：');if(!pin)return;const {error}=await supabase.rpc('reset_member_pin',{p_member_id:id,p_new_pin:pin,p_unclaim:true});if(error){showError(error);return}await refresh();alert('PIN 已重置，原设备登录已解除。')}
async function deleteMember(id){if(!confirm('删除这名成员？'))return;const {error}=await supabase.from('members').delete().eq('id',id);if(error){showError(error);return}await refresh()}
async function importMembers(){
  const lines=$('memberCsv').value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);let count=0;
  for(const [i,line] of lines.entries()){
    const parts=parseCsvLine(line);if(i===0&&/name|姓名/i.test(parts[0]))continue;
    const [name,pin,group,role]=parts;if(!name||!pin)continue;
    const {error}=await supabase.rpc('create_member_with_pin',{p_project_id:state.project.id,p_full_name:name.trim(),p_login_name:name.trim(),p_pin:pin.trim(),p_group_name:nullable(group?.trim()||''),p_member_role:role?.trim()||'student'});
    if(error){alert(`第 ${i+1} 行失败：${error.message}`);return}count++;
  }
  await refresh();alert(`成功导入 ${count} 名成员。`);
}
function parseCsvLine(line){const out=[];let cur='',quote=false;for(let i=0;i<line.length;i++){const c=line[i];if(c==='"'){if(quote&&line[i+1]==='"'){cur+='"';i++}else quote=!quote}else if(c===','&&!quote){out.push(cur);cur=''}else cur+=c}out.push(cur);return out}

function projectUrl(){return `${CONFIG.siteUrl}?project=${encodeURIComponent(state.project?.slug||'')}`}
async function renderShare(){if(!state.project)return;const url=projectUrl();$('shareUrl').value=url;$('openShareUrl').href=url;await QRCode.toCanvas($('qrCanvas'),url,{width:300,margin:2,errorCorrectionLevel:'M'})}
function table(headers,rows){return `<table class="data-table"><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${c??''}</td>`).join('')}</tr>`).join('')||`<tr><td colspan="${headers.length}" class="empty">暂无数据</td></tr>`}</tbody></table>`}
function actions(type,id){return `<div class="row-actions"><button data-edit-type="${type}" data-id="${id}">编辑</button><button data-delete-type="${type}" data-id="${id}">删除</button></div>`}
function bindRowActions(){document.querySelectorAll('[data-edit-type]').forEach(b=>b.addEventListener('click',()=>editItem(b.dataset.editType,b.dataset.id)));document.querySelectorAll('[data-delete-type]').forEach(b=>b.addEventListener('click',()=>deleteItem(b.dataset.deleteType,b.dataset.id)))}
function editItem(type,id){if(type==='schedule')openSchedule(state.schedule.find(x=>x.id===id));if(type==='notice')openNotice(state.notices.find(x=>x.id===id));if(type==='album')openAlbumEditor(state.albums.find(x=>x.id===id))}
async function deleteItem(type,id){const map={schedule:'schedule_items',notice:'notices',album:'albums'};if(!confirm('确定删除？'))return;const {error}=await supabase.from(map[type]).delete().eq('id',id);if(error){showError(error);return}await refresh()}
async function refresh(){await loadProjectData();renderAll()}
function showSection(name){document.querySelectorAll('.section').forEach(s=>s.classList.remove('active'));$(`${name}Section`).classList.add('active');document.querySelectorAll('#adminNav button').forEach(b=>b.classList.toggle('active',b.dataset.section===name));document.querySelector('.sidebar').classList.remove('open');if(name==='share')renderShare()}

$('adminLoginButton').addEventListener('click',login);
$('adminPassword').addEventListener('keydown',e=>{if(e.key==='Enter')login()});
$('copySetupSql').addEventListener('click',async()=>{await navigator.clipboard.writeText($('setupSql').value);$('copySetupSql').textContent='已复制'});
$('retryAdmin').addEventListener('click',checkAdmin);
$('projectPicker').addEventListener('change',async e=>{state.project=state.projects.find(p=>p.id===e.target.value);await projectChanged()});
$('adminNav').addEventListener('click',e=>{const b=e.target.closest('[data-section]');if(b)showSection(b.dataset.section)});
document.querySelectorAll('[data-jump]').forEach(b=>b.addEventListener('click',()=>showSection(b.dataset.jump)));
$('menuButton').addEventListener('click',()=>document.querySelector('.sidebar').classList.toggle('open'));
$('adminLogout').addEventListener('click',async()=>{await supabase.auth.signOut();location.reload()});
$('projectForm').addEventListener('submit',saveProject);
$('newProjectButton').addEventListener('click',()=>renderProjectForm(null));
$('deleteProjectButton').addEventListener('click',deleteProject);
$('homeForm').addEventListener('submit',saveHome);
$('newScheduleButton').addEventListener('click',()=>openSchedule());
$('scheduleForm').addEventListener('submit',saveSchedule);
$('scheduleFilterDate').value=today();
$('scheduleFilterDate').addEventListener('change',renderSchedule);
$('copyPreviousDay').addEventListener('click',copyPrevious);
$('newNoticeButton').addEventListener('click',()=>openNotice());
$('noticeForm').addEventListener('submit',saveNotice);
$('newAlbumButton').addEventListener('click',()=>openAlbumEditor());
$('albumForm').addEventListener('submit',saveAlbum);
document.querySelectorAll('.cancel-editor').forEach(b=>b.addEventListener('click',()=>b.closest('.editor').classList.add('hidden')));
$('memberForm').addEventListener('submit',addMember);
$('importMembers').addEventListener('click',importMembers);
$('copyShareUrl').addEventListener('click',async()=>{await navigator.clipboard.writeText($('shareUrl').value);$('copyShareUrl').textContent='已复制'});
$('downloadQr').addEventListener('click',()=>{const a=document.createElement('a');a.download=`${state.project.slug}-qr.png`;a.href=$('qrCanvas').toDataURL('image/png');a.click()});
init().catch(showError);
