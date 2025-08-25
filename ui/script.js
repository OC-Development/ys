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
    pickup: null,        // {x,y,z}
    destination: null,   // {x,y,z}
    activeKind: 'pickup', // which input is active in customize
    selectedRideType: 'uberx' // selected ride type
  };

  // GTA <-> Leaflet conversions (same scale used قبلًا)
  const worldToLeaflet = (x,y) => ({ lat: y*0.66 + (-5525), lng: x*0.66 + 3755 });
  const leafletToWorld = (lat,lng) => ({ x:(lng-3755)/0.66, y:(lat+5525)/0.66 });

  // ---------- screens ----------
  const scrHome      = $('#screen-home');
  const scrCustomize = $('#screen-customize');
  const scrPick      = $('#screen-pick');

  // ===== Initialize Home Screen =====
  setTimeout(initHomeMap, 100);

  // ===== Ride Type Selection =====
  document.querySelectorAll('.ride-type').forEach(type => {
    type.addEventListener('click', () => {
      document.querySelectorAll('.ride-type').forEach(t => t.classList.remove('active'));
      type.classList.add('active');
      state.selectedRideType = type.dataset.type;
    });
  });

  // ===== Center Location Button =====
  $('#centerLocation').onclick = async () => {
    if (!mapHome) return;
    if (inNui) {
      try {
        const r = await fetchNui('m_taxi:getPlayerCoords');
        if (r && r.x) {
          const c = worldToLeaflet(r.x, r.y);
          mapHome.setView([c.lat, c.lng], 4);
          toast('Centered on your location');
        }
      } catch {
        toast('Could not get your location');
      }
    } else {
      toast('Location centering (browser mode)');
    }
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
  const pickupRow = $('#screen-customize .input-row[data-kind="pickup"]');
  const destRow   = $('#screen-customize .input-row[data-kind="destination"]');
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
        toast('Location set to current position');
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
    // Send the actual request
    if (inNui){
      await fetchNui('m_taxi:request', { 
        from: state.pickup, 
        to: state.destination,
        rideType: state.selectedRideType 
      });
      toast('🚗 Ride requested! Looking for nearby drivers...');
      show('#screen-home');
    } else {
      toast('🚗 Ride requested! (Demo mode)');
      show('#screen-home');
    }
  };

  function ensureCustomizeUI(){
    // hydrate inputs if state has values
    pickupInput.value = state.pickup ? `Pickup: ${state.pickup.x.toFixed(0)}, ${state.pickup.y.toFixed(0)}` : '';
    destInput.value   = state.destination ? `Destination: ${state.destination.x.toFixed(0)}, ${state.destination.y.toFixed(0)}` : '';
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
    $('#pickTitle').textContent = kind==='pickup' ? 'Set pickup location' : 'Set destination';
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
    $('#pickedAddress').textContent = `Coordinates: ${selected.x.toFixed(0)}, ${selected.y.toFixed(0)}`;
  }

  $('#btnPickContinue').onclick = ()=>{
    if (!selected) return;
    const vec = { x:+selected.x.toFixed(2), y:+selected.y.toFixed(2), z:+(cachedZ||30).toFixed(2) };
    if (scrPick.dataset.kind === 'pickup'){
      state.pickup = vec; 
      pickupInput.value = `Pickup: ${vec.x.toFixed(0)}, ${vec.y.toFixed(0)}`;
      toast('✅ Pickup location set');
    } else {
      state.destination = vec; 
      destInput.value = `Destination: ${vec.x.toFixed(0)}, ${vec.y.toFixed(0)}`;
      toast('✅ Destination set');
    }
    show('#screen-customize'); evaluateNext();
  };

  // ===== Quick Destinations =====
  $('#quickHome').onclick = () => {
    toast('🏠 Home address not set. Add it in settings.');
  };

  $('#quickWork').onclick = () => {
    toast('💼 Work address not set. Add it in settings.');
  };

  $('#quickSaved').onclick = () => {
    toast('⭐ No saved places yet.');
  };

  // Theme sync with LB-Phone
  if (typeof onSettingsChange === 'function') onSettingsChange(s=> document.querySelector('.app').dataset.theme = s.display.theme);
  if (typeof getSettings === 'function') getSettings().then(s=> document.querySelector('.app').dataset.theme = s.display.theme);

  // ===== Driver Interface =====
  const btnDriver = document.getElementById('btnDriver');
  const backFromDriver = document.getElementById('backFromDriver');
  const driverListEl = document.getElementById('driverList');

  btnDriver && (btnDriver.onclick = () => {
    show('#screen-driver');
    toast('👨‍💼 Switched to driver mode');
  });
  
  backFromDriver && (backFromDriver.onclick = () => {
    show('#screen-home');
    toast('🚗 Switched to rider mode');
  });

  // Driver state for incoming requests
  const driverState = { rfps: {} }; // jobId -> payload

  function renderDriverList(){
    const entries = Object.values(driverState.rfps);
    if (!entries.length){
      driverListEl.innerHTML = `
        <div style="text-align: center; padding: 40px 20px; color: var(--muted);">
          <div style="font-size: 48px; margin-bottom: 16px;">🚗</div>
          <div style="font-weight: 600; margin-bottom: 8px;">No ride requests</div>
          <div style="font-size: 14px;">Stay online to receive ride requests from passengers</div>
        </div>
      `;
      return;
    }
    
    driverListEl.innerHTML = entries.map(r => {
      const p = r.from, d = r.to;
      const distTxt = (r.distKm != null) ? `${r.distKm} km away` : 'Distance unknown';
      const idShort = (r.jobId || '').slice(-4);
      // Simple price suggestion
      const suggest = Math.max(300, Math.round(150 + 100 * (r.distKm || 2)));
      const eta = Math.max(3, Math.round((r.distKm || 2) * 2 + 2));
      
      return `
        <div class="req-card" data-id="${r.jobId}">
          <div class="req-main">
            <div class="req-title">🚗 Ride Request #${idShort}</div>
            <div class="req-sub">📍 From: ${p.x.toFixed(0)}, ${p.y.toFixed(0)}</div>
            <div class="req-sub">🎯 To: ${d.x.toFixed(0)}, ${d.y.toFixed(0)}</div>
            <div class="req-sub">📏 <strong>${distTxt}</strong></div>
            <div class="req-form">
              <span class="badge">Your Offer</span>
              <input type="number" class="inp-price" min="0" step="10" value="${suggest}" placeholder="Price (DZD)">
              <input type="number" class="inp-eta" min="1" step="1" value="${eta}" placeholder="ETA (min)">
              <button class="btn-send">Send Offer</button>
            </div>
          </div>
          <div class="req-actions">
            <div class="badge">Job: ${r.jobId}</div>
          </div>
        </div>
      `;
    }).join('');

    // Bind buttons
    driverListEl.querySelectorAll('.req-card').forEach(card => {
      const jobId = card.dataset.id;
      card.querySelector('.btn-send').onclick = () => {
        const price = Number(card.querySelector('.inp-price').value || 0);
        const eta = Number(card.querySelector('.inp-eta').value || 5);
        const distKm = driverState.rfps[jobId]?.distKm || 0;
        
        if (fetchNui) {
          fetchNui('m_taxi:driver:submitOffer', { jobId, price, etaMin: eta, distKm });
        }
        
        toast(`💰 Offer sent: $${price} • ${eta} min ETA`);
      };
    });
  }

  // Initialize driver list
  renderDriverList();

  // Listen for messages from client.lua → SendCustomAppMessage
  window.addEventListener('message', (e) => {
    const m = e.data;
    if (!m || !m.type) return;

    if (m.type === 'driver:rfp') {
      const r = m.payload;
      driverState.rfps[r.jobId] = r;
      renderDriverList();
      toast(`🚗 New ride request • ${r.distKm ?? '?'} km away`);
    }

    if (m.type === 'driver:offerDeclined') {
      const id = m.payload?.jobId;
      if (id && driverState.rfps[id]) {
        toast('❌ Your offer was not selected');
      }
    }

    if (m.type === 'driver:offerAccepted') {
      const id = m.payload?.jobId;
      if (id && driverState.rfps[id]) {
        delete driverState.rfps[id];
        renderDriverList();
        toast('✅ Offer accepted! Navigate to pickup location');
      }
    }
  });
};
