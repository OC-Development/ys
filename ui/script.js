// Boot only inside LB-Phone
window.DzRideBoot = function () {
  // If someone opened in browser, still show (no NUI calls)
  const inNui = typeof fetchNui === 'function';

  // ---------- helpers ----------
const $ = (q, el=document) => el.querySelector(q);
const show = (sel) => {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('show'));
  const t = document.querySelector(sel);
  if (t) t.classList.add('show');
};



  function toast(msg, ms=2200){
    const t = document.createElement('div');
    t.className = 'mtx-toast'; t.textContent = msg;
    document.body.appendChild(t); requestAnimationFrame(()=>t.classList.add('show'));
    setTimeout(()=>{ t.classList.remove('show'); setTimeout(()=>t.remove(), 300); }, ms);
  }
  function popup(title, description){
    const payload = { title: String(title||'Info'), description: String(description||''), buttons:[{title:'OK'}] };
    if (typeof setPopUp === 'function') return setPopUp(payload);
    if (globalThis.components?.setPopUp) return globalThis.components.setPopUp(payload);
    toast(description || title);
  }

  // ---------- state ----------
  const state = {
    phone: '',
    pickup: null,        // {x,y,z}
    destination: null,   // {x,y,z}
    activeKind: 'pickup' // which radio is active in customize
  };

  // GTA <-> Leaflet conversions (same scale used قبلًا)
  const worldToLeaflet = (x,y) => ({ lat: y*0.66 + (-5525), lng: x*0.66 + 3755 });
  const leafletToWorld = (lat,lng) => ({ x:(lng-3755)/0.66, y:(lat+5525)/0.66 });

  // ---------- screens ----------
  const scrWelcome   = $('#screen-welcome');
  const scrHome      = $('#screen-home');
  const scrCustomize = $('#screen-customize');
  const scrPick      = $('#screen-pick');

  // ===== Welcome
  $('#btnWelcomeNext').onclick = () => {
    state.phone = $('#phone').value.trim();
    show('#screen-home');
    setTimeout(initHomeMap, 0);
  };

  // ===== Home map
  let mapHome;
  async function initHomeMap(){
    if (mapHome) return;
    const crs = L.CRS.Simple; crs.scale = (z)=> (Math.pow(2,z)/Math.pow(2,3)*0.25);
    const tiles = L.tileLayer('./styleAtlas/{z}/{x}/{y}.png', { minZoom:0, maxZoom:5, noWrap:true, tms:true });
    mapHome = L.map('homeMap', { maxZoom:5, minZoom:3, layers:[tiles], crs, center:[-5525,3755], zoom:4, attributionControl:false, zoomControl:false, maxBounds:L.latLngBounds([[-8192,0],[0,8192]]), preferCanvas:true });
    // center to player if we can
    if (inNui){
      try{ const r = await fetchNui('m_taxi:getPlayerCoords'); if (r && r.x) { const c = worldToLeaflet(r.x,r.y); mapHome.setView([c.lat,c.lng], 4); } } catch {}
    }
  }

  $('#btnOpenCustomize').onclick = () => {
    show('#screen-customize');
    ensureCustomizeUI();
  };

  // ===== Customize
  const pickupRow = $('#screen-customize .radio-input[data-kind="pickup"]');
  const destRow   = $('#screen-customize .radio-input[data-kind="destination"]');
  const pickupInput = $('#pickupInput');
  const destInput   = $('#destInput');

  function setActive(kind){
    state.activeKind = kind;
    pickupRow.classList.toggle('active', kind==='pickup');
    destRow.classList.toggle('active',   kind==='destination');
  }

  pickupRow.addEventListener('click',  (e)=>{ if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'BUTTON') setActive('pickup'); });
  destRow.addEventListener('click',    (e)=>{ if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'BUTTON') setActive('destination'); });

  $('#backFromCustomize').onclick = () => show('#screen-home');

  $('#setPickupMap').onclick = ()=>{ setActive('pickup'); openPickMap('pickup'); };
  $('#setDestMap').onclick   = ()=>{ setActive('destination'); openPickMap('destination'); };

  $('#useCurrent').onclick = async ()=>{
    if (!inNui) return toast('NUI only');
    try{
      const r = await fetchNui('m_taxi:getPlayerCoords');
      if (r && r.x){
        const vec = { x:+r.x.toFixed(2), y:+r.y.toFixed(2), z:+r.z.toFixed(2) };
        if (state.activeKind==='pickup'){ state.pickup=vec; pickupInput.value = `${vec.x},${vec.y},${vec.z}`; }
        else { state.destination=vec; destInput.value = `${vec.x},${vec.y},${vec.z}`; }
        evaluateNext();
      }
    }catch{ popup('Cannot get current position'); }
  };

  $('#chooseOnMap').onclick = ()=> openPickMap(state.activeKind);

  function evaluateNext(){
    const ready = !!(state.pickup && state.destination);
    $('#btnCustomizeNext').classList.toggle('disabled', !ready);
  }

  $('#btnCustomizeNext').onclick = async ()=>{
    if ($('#btnCustomizeNext').classList.contains('disabled')) return;
    // أرسل الطلب فعليًا
    if (inNui){
      await fetchNui('m_taxi:request', { from: state.pickup, to: state.destination });
      toast('Ride requested. Waiting for drivers…');
    } else {
      toast('Simulated request (browser).');
    }
  };

  function ensureCustomizeUI(){
    // hydrate inputs if state has values
    pickupInput.value = state.pickup ? `${state.pickup.x},${state.pickup.y},${state.pickup.z}` : '';
    destInput.value   = state.destination ? `${state.destination.x},${state.destination.y},${state.destination.z}` : '';
    evaluateNext();
  }

  // ===== Pick on map (full)
  let mapPick, selected, cachedZ = 30.0;
  async function initPickMap(){
    if (mapPick) return;
    const crs = L.CRS.Simple; crs.scale = (z)=> (Math.pow(2,z)/Math.pow(2,3)*0.25);
    const tiles = L.tileLayer('./styleAtlas/{z}/{x}/{y}.png', { minZoom:0, maxZoom:5, noWrap:true, tms:true });
    mapPick = L.map('pickMap', { maxZoom:5, minZoom:3, layers:[tiles], crs, center:[-5525,3755], zoom:4, attributionControl:false, zoomControl:true, maxBounds:L.latLngBounds([[-8192,0],[0,8192]]), preferCanvas:true });
    mapPick.on('move', updatePickedAddress);
  }

  async function openPickMap(kind){
    $('#pickTitle').textContent = kind==='pickup' ? 'Choose your pickup' : 'Choose your destination';
    show('#screen-pick');
    await initPickMap();
    // center on player or existing value
    if (kind==='pickup' && state.pickup){
      const c = worldToLeaflet(state.pickup.x,state.pickup.y); mapPick.setView([c.lat,c.lng], 4);
    } else if (kind==='destination' && state.destination){
      const c = worldToLeaflet(state.destination.x,state.destination.y); mapPick.setView([c.lat,c.lng], 4);
    } else if (inNui){
      try{ const r=await fetchNui('m_taxi:getPlayerCoords'); if(r&&r.x){ const c=worldToLeaflet(r.x,r.y); mapPick.setView([c.lat,c.lng],4); cachedZ=r.z; } }catch{}
    }
    mapPick.invalidateSize();
    scrPick.dataset.kind = kind;
    updatePickedAddress();
  }

  $('#backFromPick').onclick = ()=> show('#screen-customize');

  function updatePickedAddress(){
    const center = mapPick.getCenter();
    selected = leafletToWorld(center.lat, center.lng);
    $('#pickedAddress').textContent = `x: ${selected.x.toFixed(2)}, y: ${selected.y.toFixed(2)}`;
  }

  $('#btnPickContinue').onclick = ()=>{
    if (!selected) return;
    const vec = { x:+selected.x.toFixed(2), y:+selected.y.toFixed(2), z:+(cachedZ||30).toFixed(2) };
    if (scrPick.dataset.kind === 'pickup'){
      state.pickup = vec; pickupInput.value = `${vec.x},${vec.y},${vec.z}`;
    } else {
      state.destination = vec; destInput.value = `${vec.x},${vec.y},${vec.z}`;
    }
    show('#screen-customize'); evaluateNext();
  };

  // Theme sync with LB-Phone
  if (typeof onSettingsChange === 'function') onSettingsChange(s=> document.querySelector('.app').dataset.theme = s.display.theme);
  if (typeof getSettings === 'function') getSettings().then(s=> document.querySelector('.app').dataset.theme = s.display.theme);


  const btnDriver     = document.getElementById('btnDriver');
const backFromDriver= document.getElementById('backFromDriver');
const driverListEl  = document.getElementById('driverList');

btnDriver     && (btnDriver.onclick      = () => show('#screen-driver'));
backFromDriver&& (backFromDriver.onclick = () => show('#screen-home'));

// حالة الطلبات الواردة
const driverState = { rfps: {} }; // jobId -> payload

function renderDriverList(){
  const entries = Object.values(driverState.rfps);
  if (!entries.length){
    driverListEl.innerHTML = `<div class="req-sub" style="padding:12px">No requests yet. Stay on duty to receive rides.</div>`;
    return;
  }
  driverListEl.innerHTML = entries.map(r => {
    const p = r.from, d = r.to;
    const distTxt = (r.distKm != null) ? `${r.distKm} km from you` : '—';
    const idShort = (r.jobId || '').slice(-4);
    // اقتراح سعر بسيط (تقدر تغيّره)
    const suggest = Math.max(300, Math.round(150 + 100 * (r.distKm || 2)));
    const eta = Math.max(3, Math.round((r.distKm || 2) * 2 + 2));
    return `
      <div class="req-card" data-id="${r.jobId}">
        <div class="req-main">
          <div class="req-title">Request #${idShort}</div>
          <div class="req-sub">Pickup: ${p.x.toFixed(0)},${p.y.toFixed(0)}  →  Drop: ${d.x.toFixed(0)},${d.y.toFixed(0)}</div>
          <div class="req-sub">Distance: <b>${distTxt}</b></div>
          <div class="req-form">
            <span class="badge">Offer</span>
            <input type="number" class="inp-price" min="0" step="10" value="${suggest}" placeholder="Price (DZD)">
            <input type="number" class="inp-eta"   min="1" step="1"  value="${eta}"     placeholder="ETA (min)">
            <button class="btn pri btn-send">Send Offer</button>
          </div>
        </div>
        <div class="req-actions">
          <div class="badge">job: ${r.jobId}</div>
        </div>
      </div>
    `;
  }).join('');

  // ربط الأزرار
  driverListEl.querySelectorAll('.req-card').forEach(card=>{
    const jobId = card.dataset.id;
    card.querySelector('.btn-send').onclick = ()=>{
      const price = Number(card.querySelector('.inp-price').value || 0);
      const eta   = Number(card.querySelector('.inp-eta').value   || 5);
      const distKm = driverState.rfps[jobId]?.distKm || 0;
      fetchNui && fetchNui('m_taxi:driver:submitOffer', { jobId, price, etaMin: eta, distKm });
      toast('Offer sent');
    };
  });
}

// استلام رسائل من client.lua → SendCustomAppMessage
window.addEventListener('message', (e)=>{
  const m = e.data;
  if (!m || !m.type) return;

  if (m.type === 'driver:rfp'){
    const r = m.payload;
    driverState.rfps[r.jobId] = r;
    renderDriverList();
    // نوتيف خفيف
    toast(`New request • ${r.distKm ?? '?'} km`);
  }

  if (m.type === 'driver:offerDeclined'){
    const id = m.payload?.jobId;
    if (id && driverState.rfps[id]) {
      // ما نمسح الطلب تمامًا—يمكن تبغى ترسل عرض جديد لو ما تم اختيار أحد بعد
      // لكن هنا بنحط badge بسيطة
      toast('Your offer was not selected');
    }
  }
});

};



// ===== Driver screen =====
