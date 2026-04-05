// NutriSnap — app.js
// All data is stored in localStorage under the 'ns_' prefix

const S = {
  get: k => { try { return JSON.parse(localStorage.getItem('ns_' + k)) } catch(e) { return null } },
  set: (k, v) => { try { localStorage.setItem('ns_' + k, JSON.stringify(v)) } catch(e) {} }
};

// ── State ──────────────────────────────────────────────────────────────
let profile    = S.get('profile')  || { age:'', sex:'male', weight:'', height:'', activity:1.55, goal:'maintain' };
let todayKey   = new Date().toISOString().slice(0, 10);
let todayLog   = S.get('log_' + todayKey) || [];
let waterLog   = S.get('water_' + todayKey) || [];
let waterGoal  = S.get('waterGoal') || 2500;
let weightLog  = S.get('weightLog') || [];
let capturedImg = null, currentRes = null;
let bcStream = null, bcTimer = null;
let charts = {};

// ── Image resize (iOS photos can be 12MP+ — cap at 1024px before base64 send) ─
function resizeBase64(dataUrl, maxPx = 1024) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(maxPx / img.width, maxPx / img.height, 1);
      if (scale >= 1) { resolve(dataUrl); return; }   // already small enough
      const canvas = document.createElement('canvas');
      canvas.width  = Math.round(img.width  * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.src = dataUrl;
  });
}

// ── Toast notifications (replaces alert()) ────────────────────────────────────
function showToast(msg, type = 'err') {
  const t = document.createElement('div');
  t.className = 'toast' + (type === 'ok' ? ' ok' : '');
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => { requestAnimationFrame(() => t.classList.add('show')); });
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 300);
  }, 3500);
}

// ── Goal config ────────────────────────────────────────────────────────
const GOALS = {
  bulk:     { label:'Bulking',  sub:'Build muscle mass', color:'#185FA5', dot:'#185FA5', adj:+350, protMult:2.2 },
  maintain: { label:'Maintain', sub:'Stay balanced',     color:'#639922', dot:'#639922', adj:0,    protMult:1.8 },
  cut:      { label:'Cutting',  sub:'Lose body fat',     color:'#E24B4A', dot:'#E24B4A', adj:-500, protMult:2.4 },
};

// ── TDEE / Mifflin-St Jeor ─────────────────────────────────────────────
function calcGoal(p) {
  if (!p.weight || !p.height || !p.age) return null;
  const w = parseFloat(p.weight), h = parseFloat(p.height), a = parseFloat(p.age);
  let bmr = p.sex === 'male'
    ? 10 * w + 6.25 * h - 5 * a + 5
    : 10 * w + 6.25 * h - 5 * a - 161;
  const tdee = Math.round(bmr * parseFloat(p.activity));
  const g = GOALS[p.goal] || GOALS.maintain;
  return { bmr: Math.round(bmr), tdee, kcal: Math.round(tdee + g.adj), prot: Math.round(w * g.protMult) };
}
function getGoalKcal() { const c = calcGoal(profile); return c ? c.kcal : 2000; }
function getProtGoal() { const c = calcGoal(profile); return c ? c.prot : 150; }

// ── Tab switching ──────────────────────────────────────────────────────
function switchTab(t) {
  ['log','water','weight','history','profile'].forEach((s, i) => {
    document.getElementById('tab-' + s).classList.toggle('active', s === t);
    document.querySelectorAll('.tab')[i].classList.toggle('active', s === t);
  });
  if (t === 'history') renderHistCharts();
  if (t === 'profile') { loadProfileUI(); updateTDEE(); }
  if (t === 'weight')  renderWeightChart();
}

// ── Date display ───────────────────────────────────────────────────────
document.getElementById('today-date').textContent =
  new Date().toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' });

// ── Camera / file input ────────────────────────────────────────────────
document.getElementById('file-input').addEventListener('change', e => {
  const file = e.target.files[0]; if (!file) return;
  const r = new FileReader();
  r.onload = async ev => {
    capturedImg = await resizeBase64(ev.target.result);
    document.getElementById('snap-img').src = capturedImg;
    document.getElementById('snap-img').style.display = 'block';
    document.getElementById('cam-ph').style.display = 'none';
    document.getElementById('btn-retake').style.display = 'flex';
    document.getElementById('btn-analyze').style.display = 'flex';
    document.getElementById('btn-cam').style.display = 'none';
    document.getElementById('res-card').classList.remove('show');
  };
  r.readAsDataURL(file);
  e.target.value = '';
});

function retake() {
  capturedImg = null;
  document.getElementById('snap-img').style.display = 'none';
  document.getElementById('cam-ph').style.display = 'flex';
  document.getElementById('btn-retake').style.display = 'none';
  document.getElementById('btn-analyze').style.display = 'none';
  document.getElementById('btn-cam').style.display = 'flex';
  document.getElementById('res-card').classList.remove('show');
  document.getElementById('analyzing').classList.remove('show');
}

// ── AI food photo analysis ─────────────────────────────────────────────
async function analyzeFood() {
  if (!capturedImg) return;
  document.getElementById('analyzing').classList.add('show');
  document.getElementById('analyzing-txt').textContent = 'Analyzing with AI...';
  document.getElementById('res-card').classList.remove('show');
  document.getElementById('btn-analyze').disabled = true;

  const b64 = capturedImg.split(',')[1];
  const mt  = capturedImg.split(';')[0].split(':')[1];

  try {
    const resp = await fetch('https://nutrisnap.moesham3a.workers.dev', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: mt, data: b64 } },
          { type: 'text', text: 'You are a nutrition expert. Analyze this food image and estimate nutritional content. Respond ONLY with a JSON object (no markdown, no backticks, no extra text):\n{"name":"Food Name","calories":420,"protein_g":32,"carbs_g":18,"fat_g":24,"fiber_g":4}\nBe realistic with visible portions. Sum all items if multiple. If not food, set calories to 0.' }
        ]}]
      })
    });
    const data = await resp.json();
    const txt = data.content.find(b => b.type === 'text')?.text || '{}';
    let p;
    try { p = JSON.parse(txt.replace(/```json|```/g, '').trim()); }
    catch(e) { throw new Error('parse'); }
    showResult(p, 'AI vision');
  } catch(e) {
    showToast('Could not analyze image. Please try again.');
  }

  document.getElementById('analyzing').classList.remove('show');
  document.getElementById('btn-analyze').disabled = false;
}

function showResult(p, source) {
  currentRes = p;
  document.getElementById('r-name').textContent = p.name || 'Unknown';
  document.getElementById('r-kcal').textContent  = Math.round(p.calories   || 0) + ' kcal';
  document.getElementById('r-p').textContent     = Math.round(p.protein_g  || 0) + 'g';
  document.getElementById('r-c').textContent     = Math.round(p.carbs_g    || 0) + 'g';
  document.getElementById('r-f').textContent     = Math.round(p.fat_g      || 0) + 'g';
  document.getElementById('r-fi').textContent    = Math.round(p.fiber_g    || 0) + 'g';
  document.getElementById('r-source').textContent = 'Source: ' + source;
  document.getElementById('res-card').classList.add('show');
}

// ── Barcode scanner ────────────────────────────────────────────────────
async function lookupBarcode(code) {
  document.getElementById('analyzing').classList.add('show');
  document.getElementById('analyzing-txt').textContent = 'Looking up barcode ' + code + '...';
  try {
    const resp = await fetch(`https://world.openfoodfacts.org/api/v0/product/${code}.json`);
    const data = await resp.json();
    if (data.status === 1 && data.product) {
      const pr = data.product, nutr = pr.nutriments || {};
      const hasSrv = !!pr.serving_size;
      const suf = hasSrv ? '_serving' : '_100g';
      const per = hasSrv ? 'serving' : '100g';
      showResult({
        name:      pr.product_name || pr.brands || 'Unknown product',
        calories:  Math.round(nutr['energy-kcal' + suf] || nutr['energy-kcal'] || 0),
        protein_g: Math.round((nutr['proteins'         + suf] || nutr.proteins       || 0) * 10) / 10,
        carbs_g:   Math.round((nutr['carbohydrates'    + suf] || nutr.carbohydrates  || 0) * 10) / 10,
        fat_g:     Math.round((nutr['fat'              + suf] || nutr.fat            || 0) * 10) / 10,
        fiber_g:   Math.round((nutr['fiber'            + suf] || nutr.fiber          || 0) * 10) / 10,
      }, 'Open Food Facts (per ' + per + ')');
    } else {
      await lookupBarcodeAI(code);
    }
  } catch(e) {
    await lookupBarcodeAI(code);
  }
  document.getElementById('analyzing').classList.remove('show');
}

async function lookupBarcodeAI(code) {
  try {
    const resp = await fetch('https://nutrisnap.moesham3a.workers.dev', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 400,
        messages: [{ role: 'user', content: `Barcode: ${code}. If you recognize this product, return its nutrition info. Respond ONLY with JSON (no markdown): {"name":"Product Name","calories":200,"protein_g":5,"carbs_g":30,"fat_g":8,"fiber_g":2}. If unknown, estimate based on typical products with this barcode format.` }]
      })
    });
    const data = await resp.json();
    const txt = data.content.find(b => b.type === 'text')?.text || '{}';
    let p;
    try { p = JSON.parse(txt.replace(/```json|```/g, '').trim()); }
    catch(e) { p = { name: 'Unknown product (#' + code + ')', calories:0, protein_g:0, carbs_g:0, fat_g:0, fiber_g:0 }; }
    showResult(p, 'AI estimate');
  } catch(e) {
    showResult({ name: 'Unknown product (#' + code + ')', calories:0, protein_g:0, carbs_g:0, fat_g:0, fiber_g:0 }, 'manual entry');
  }
}

async function estimateMeal() {
  const desc = document.getElementById('meal-desc').value.trim();
  if (!desc) return;

  document.getElementById('btn-estimate').disabled = true;
  document.getElementById('btn-estimate').textContent = 'Estimating...';
  document.getElementById('meal-result').style.display = 'none';

  try {
    const resp = await fetch('https://nutrisnap.moesham3a.workers.dev', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 400,
        messages: [{ role: 'user', content:
          `The user described what they ate: "${desc}"
Estimate the nutritional content. Be realistic about home-cooked and restaurant portions.
Respond ONLY with a JSON object (no markdown, no backticks):
{"name":"Descriptive meal name","calories":520,"protein_g":28,"carbs_g":45,"fat_g":22,"fiber_g":4}` }]
      })
    });

    const data = await resp.json();
    const txt = data.content.find(b => b.type === 'text')?.text || '{}';
    let p;
    try { p = JSON.parse(txt.replace(/```json|```/g, '').trim()); }
    catch(e) { throw new Error('parse'); }

    // populate editable fields
    document.getElementById('me-name').value   = p.name       || desc;
    document.getElementById('me-kcal').value   = Math.round(p.calories   || 0);
    document.getElementById('me-protein').value= Math.round(p.protein_g  || 0);
    document.getElementById('me-carbs').value  = Math.round(p.carbs_g    || 0);
    document.getElementById('me-fat').value    = Math.round(p.fat_g      || 0);
    document.getElementById('me-fiber').value  = Math.round(p.fiber_g    || 0);

    document.getElementById('meal-result').style.display = 'flex';

  } catch(e) {
    showToast('Could not estimate. Please try again.');
  }

  document.getElementById('btn-estimate').disabled = false;
  document.getElementById('btn-estimate').textContent = 'Estimate nutrition';
}

function dismissMealEstimate() {
  document.getElementById('meal-result').style.display = 'none';
  document.getElementById('meal-desc').value = '';
}

function addMealEstimateToLog() {
  const entry = {
    name:      document.getElementById('me-name').value    || 'Manual entry',
    calories:  parseFloat(document.getElementById('me-kcal').value)    || 0,
    protein_g: parseFloat(document.getElementById('me-protein').value) || 0,
    carbs_g:   parseFloat(document.getElementById('me-carbs').value)   || 0,
    fat_g:     parseFloat(document.getElementById('me-fat').value)     || 0,
    fiber_g:   parseFloat(document.getElementById('me-fiber').value)   || 0,
    img:       null,  // no photo for text entries
    id:        Date.now()
  };

  todayLog.push(entry);
  S.set('log_' + todayKey, todayLog);
  saveHistoryDay();
  renderLog();
  updateSummary();
  dismissMealEstimate();
}

async function openScanner() {
  document.getElementById('bc-modal').classList.add('show');
  document.getElementById('bc-status').textContent = 'Starting camera...';
  try {
    bcStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    const video = document.getElementById('bc-video');
    video.srcObject = bcStream;
    document.getElementById('bc-status').textContent = 'Point camera at barcode — or enter manually below';
    tryBarcodeDetection(video);
  } catch(e) {
    document.getElementById('bc-status').textContent = 'Camera not available — use manual entry below';
  }
}

function tryBarcodeDetection(video) {
  if (!('BarcodeDetector' in window)) {
    document.getElementById('bc-status').textContent = 'Auto-detect not supported — enter barcode manually';
    return;
  }
  const det = new BarcodeDetector({ formats: ['ean_13','ean_8','upc_a','upc_e','code_128','code_39'] });
  bcTimer = setInterval(async () => {
    try {
      const codes = await det.detect(video);
      if (codes.length > 0) {
        const code = codes[0].rawValue;
        clearInterval(bcTimer);
        document.getElementById('bc-status').textContent = 'Found: ' + code;
        closeScanner();
        await lookupBarcode(code);
      }
    } catch(e) {}
  }, 500);
}

function closeScanner() {
  document.getElementById('bc-modal').classList.remove('show');
  if (bcTimer)  { clearInterval(bcTimer); bcTimer = null; }
  if (bcStream) { bcStream.getTracks().forEach(t => t.stop()); bcStream = null; }
}

async function lookupManual() {
  const code = document.getElementById('bc-manual-input').value.trim();
  if (!code) return;
  closeScanner();
  await lookupBarcode(code);
}

// ── Food log ───────────────────────────────────────────────────────────
function addToLog() {
  if (!currentRes) return;
  todayLog.push({ ...currentRes, img: capturedImg, id: Date.now() });
  S.set('log_' + todayKey, todayLog);
  saveHistoryDay(); renderLog(); updateSummary(); dismissRes(); retake();
}

function dismissRes() {
  document.getElementById('res-card').classList.remove('show');
  currentRes = null;
}

function removeLog(id) {
  todayLog = todayLog.filter(l => l.id !== id);
  S.set('log_' + todayKey, todayLog);
  saveHistoryDay(); renderLog(); updateSummary();
}

function calcTotals() {
  return todayLog.reduce((a, i) => ({
    kcal: a.kcal + (i.calories   || 0),
    p:    a.p    + (i.protein_g  || 0),
    c:    a.c    + (i.carbs_g    || 0),
    f:    a.f    + (i.fat_g      || 0),
    fi:   a.fi   + (i.fiber_g    || 0)
  }), { kcal:0, p:0, c:0, f:0, fi:0 });
}

function renderLog() {
  const list = document.getElementById('log-list');
  const empty = document.getElementById('log-empty');
  if (!todayLog.length) { empty.style.display = 'block'; list.innerHTML = ''; return; }
  empty.style.display = 'none';
  list.innerHTML = todayLog.map(item => `
    <div class="log-item">
      ${item.img
        ? `<img class="log-thumb" src="${item.img}" alt="${item.name}"/>`
        : `<div class="log-thumb bc-icon">🏷️</div>`}
      <div class="log-info">
        <div class="ln">${item.name}</div>
        <div class="lm">${Math.round(item.protein_g||0)}g P · ${Math.round(item.carbs_g||0)}g C · ${Math.round(item.fat_g||0)}g F</div>
      </div>
      <div class="log-k">${Math.round(item.calories||0)}</div>
      <button class="log-del" onclick="removeLog(${item.id})">✕</button>
    </div>`).join('');
}

function updateSummary() {
  const t = calcTotals(), goal = getGoalKcal(), pGoal = getProtGoal();
  document.getElementById('total-kcal').textContent = Math.round(t.kcal);
  document.getElementById('goal-disp').textContent  = goal;
  document.getElementById('val-p').textContent  = Math.round(t.p)  + 'g';
  document.getElementById('val-c').textContent  = Math.round(t.c)  + 'g';
  document.getElementById('val-f').textContent  = Math.round(t.f)  + 'g';
  document.getElementById('val-fi').textContent = Math.round(t.fi) + 'g';

  const circ = 239, pct = Math.min(t.kcal / goal, 1);
  const col = pct > 1.05 ? '#E24B4A' : pct > 0.9 ? '#BA7517' : '#639922';
  document.getElementById('ring-progress').style.strokeDashoffset = circ - circ * pct;
  document.getElementById('ring-progress').setAttribute('stroke', col);

  const carbGoal = Math.round(getGoalKcal() * 0.45 / 4);   // 45% of kcal from carbs
  document.getElementById('bar-p').style.width  = Math.min(t.p  / pGoal   * 100, 100) + '%';
  document.getElementById('bar-c').style.width  = Math.min(t.c  / carbGoal * 100, 100) + '%';
  document.getElementById('bar-f2').style.width = Math.min(t.f  / 80       * 100, 100) + '%';
  document.getElementById('bar-fi').style.width = Math.min(t.fi / 30       * 100, 100) + '%';
}

function saveHistoryDay() {
  const t = calcTotals();
  let hist = S.get('history') || {};
  hist[todayKey] = { kcal: t.kcal, p: t.p, c: t.c, f: t.f, water: waterLog.reduce((a,i) => a + i.amount, 0) };
  S.set('history', hist);
}

function updateGoalBadge() {
  const g = GOALS[profile.goal] || GOALS.maintain;
  const c = calcGoal(profile);
  document.getElementById('gb-dot').style.background = g.dot;
  document.getElementById('gb-name').textContent = g.label;
  document.getElementById('gb-sub').textContent  = c ? 'Target: ' + c.kcal + ' kcal' : g.sub;
  document.getElementById('gb-kcal').textContent = c ? c.prot + 'g protein' : '—';
  document.getElementById('gb-kcal').style.color  = g.color;
}

// ── Water tracker ──────────────────────────────────────────────────────
function addWater(ml) {
  const now = new Date();
  waterLog.push({ amount: ml, time: now.toTimeString().slice(0, 5), id: Date.now() });
  S.set('water_' + todayKey, waterLog);
  saveHistoryDay(); renderWater();
}

function removeWater(id) {
  waterLog = waterLog.filter(w => w.id !== id);
  S.set('water_' + todayKey, waterLog); saveHistoryDay(); renderWater();
}

function saveWaterGoal() {
  waterGoal = parseInt(document.getElementById('water-goal-input').value) || 2500;
  S.set('waterGoal', waterGoal); renderWater();
}

function renderWater() {
  const total = waterLog.reduce((a, i) => a + i.amount, 0);
  const pct   = Math.min(total / waterGoal, 1);
  document.getElementById('water-total').textContent    = total;
  document.getElementById('water-goal-disp').textContent = waterGoal;
  document.getElementById('water-remain').textContent   = Math.max(waterGoal - total, 0);
  document.getElementById('water-pct').textContent      = Math.round(pct * 100) + '% of goal';
  document.getElementById('water-goal-input').value     = waterGoal;
  document.getElementById('water-ring-prog').style.strokeDashoffset = 264 - 264 * pct;

  const wlist = document.getElementById('water-log-list');
  const we    = document.getElementById('water-empty');
  if (!waterLog.length) { we.style.display = 'block'; wlist.innerHTML = ''; return; }
  we.style.display = 'none';
  wlist.innerHTML = [...waterLog].reverse().map(w => `
    <div class="water-log-item">
      <span class="wt">+ ${w.amount} ml</span>
      <span class="wtime">${w.time}</span>
      <button class="log-del" onclick="removeWater(${w.id})">✕</button>
    </div>`).join('');
}

// ── Weight log ─────────────────────────────────────────────────────────
function logWeight() {
  const val  = parseFloat(document.getElementById('wt-input').value);
  const date = document.getElementById('wt-date').value || todayKey;
  if (!val || val < 20 || val > 400) return;
  weightLog = weightLog.filter(w => w.date !== date);
  weightLog.push({ date, kg: Math.round(val * 10) / 10 });
  weightLog.sort((a, b) => a.date.localeCompare(b.date));
  S.set('weightLog', weightLog);
  document.getElementById('wt-input').value = '';
  renderWeightLog(); renderWeightChart();
}

function removeWeight(date) {
  weightLog = weightLog.filter(w => w.date !== date);
  S.set('weightLog', weightLog); renderWeightLog(); renderWeightChart();
}

function renderWeightLog() {
  const list  = document.getElementById('wt-log-list');
  const empty = document.getElementById('wt-empty');
  if (!weightLog.length) { empty.style.display = 'block'; list.innerHTML = ''; return; }
  empty.style.display = 'none';
  const rev = [...weightLog].reverse();
  list.innerHTML = rev.map((w, i) => {
    const prev = rev[i + 1];
    let diffHtml = '';
    if (prev) {
      const d   = Math.round((w.kg - prev.kg) * 10) / 10;
      const cls = d > 0 ? 'up' : d < 0 ? 'dn' : 'eq';
      diffHtml  = `<span class="wlog-diff ${cls}">${d > 0 ? '+' : ''}${d} kg</span>`;
    }
    return `<div class="weight-log-item">
      <span class="wlog-date">${new Date(w.date + 'T00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}</span>
      <span class="wlog-val">${w.kg} kg</span>
      ${diffHtml}
      <button class="wlog-del" onclick="removeWeight('${w.date}')">✕</button>
    </div>`;
  }).join('');

  if (weightLog.length > 1) {
    const first = weightLog[0].kg, last = weightLog[weightLog.length - 1].kg;
    const diff  = Math.round((last - first) * 10) / 10;
    const days  = Math.round((new Date(weightLog[weightLog.length - 1].date) - new Date(weightLog[0].date)) / 86400000);
    document.getElementById('wt-stats').textContent = `${diff > 0 ? '+' : ''}${diff} kg over ${days} day${days !== 1 ? 's' : ''}`;
  } else {
    document.getElementById('wt-stats').textContent = '';
  }
}

function renderWeightChart() {
  const empty = document.getElementById('wt-chart-empty');
  const canvas = document.getElementById('wt-chart');
  if (weightLog.length < 2) {
    empty.style.display = 'block'; canvas.style.display = 'none'; return;
  }
  empty.style.display = 'none'; canvas.style.display = 'block';

  const labels = weightLog.map(w => new Date(w.date + 'T00:00').toLocaleDateString('en-US', { month:'short', day:'numeric' }));
  const vals   = weightLog.map(w => w.kg);
  const avgs   = vals.map((_, i) => {
    const sl = vals.slice(Math.max(0, i - 6), i + 1);
    return Math.round(sl.reduce((a, b) => a + b, 0) / sl.length * 10) / 10;
  });

  if (charts.wt) charts.wt.destroy();
  charts.wt = new Chart(canvas, {
    type: 'line',
    data: { labels, datasets: [
      { label:'Weight', data:vals, borderColor:'#534AB7', backgroundColor:'rgba(83,74,183,0.08)', borderWidth:2, pointRadius:4, pointBackgroundColor:'#534AB7', tension:0.3, fill:true },
      { label:'7-day avg', data:avgs, borderColor:'#5DCAA5', borderWidth:1.5, pointRadius:0, tension:0.4, borderDash:[4,3] }
    ]},
    options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{ display:false } },
      scales:{
        x:{ grid:{ display:false }, ticks:{ color:'#888', font:{size:11}, maxRotation:45 } },
        y:{ grid:{ color:'rgba(128,128,128,0.1)' }, ticks:{ color:'#888', font:{size:11}, callback: v => v + 'kg' } }
      }
    }
  });
}

// ── History charts ─────────────────────────────────────────────────────
function renderHistCharts() {
  const hist = S.get('history') || {};
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  const labels   = days.map(d => new Date(d + 'T00:00').toLocaleDateString('en-US', { weekday:'short' }));
  const kcals    = days.map(d => Math.round(hist[d]?.kcal  || 0));
  const prots    = days.map(d => Math.round(hist[d]?.p     || 0));
  const carbs    = days.map(d => Math.round(hist[d]?.c     || 0));
  const fats     = days.map(d => Math.round(hist[d]?.f     || 0));
  const waters   = days.map(d => Math.round(hist[d]?.water || 0));
  const goalLine = days.map(() => getGoalKcal());
  const wGoalLine= days.map(() => waterGoal);

  if (charts.hist) charts.hist.destroy();
  charts.hist = new Chart(document.getElementById('hist-chart'), {
    type: 'bar',
    data: { labels, datasets: [
      { label:'Calories', data:kcals, backgroundColor:'#639922', borderRadius:4, barPercentage:0.6 },
      { label:'Goal', data:goalLine, type:'line', borderColor:'#E24B4A', borderWidth:1.5, pointRadius:0, tension:0 }
    ]},
    options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{ display:false } },
      scales:{ x:{ grid:{ display:false }, ticks:{ color:'#888', font:{size:11} } }, y:{ grid:{ color:'rgba(128,128,128,0.1)' }, ticks:{ color:'#888', font:{size:11}, callback: v => v + 'kcal' } } }
    }
  });

  if (charts.macro) charts.macro.destroy();
  charts.macro = new Chart(document.getElementById('macro-chart'), {
    type: 'bar',
    data: { labels, datasets: [
      { label:'Protein', data:prots, backgroundColor:'#639922', borderRadius:3, stack:'a' },
      { label:'Carbs',   data:carbs, backgroundColor:'#BA7517', borderRadius:3, stack:'a' },
      { label:'Fat',     data:fats,  backgroundColor:'#E24B4A', borderRadius:3, stack:'a' }
    ]},
    options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{ display:false } },
      scales:{ x:{ grid:{ display:false }, ticks:{ color:'#888', font:{size:11} } }, y:{ grid:{ color:'rgba(128,128,128,0.1)' }, ticks:{ color:'#888', font:{size:11}, callback: v => v + 'g' }, stacked:true } }
    }
  });

  if (charts.water) charts.water.destroy();
  charts.water = new Chart(document.getElementById('water-hist-chart'), {
    type: 'bar',
    data: { labels, datasets: [
      { label:'Water', data:waters, backgroundColor:'#378ADD', borderRadius:4, barPercentage:0.6 },
      { label:'Goal',  data:wGoalLine, type:'line', borderColor:'#5DCAA5', borderWidth:1.5, pointRadius:0, tension:0 }
    ]},
    options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{ display:false } },
      scales:{ x:{ grid:{ display:false }, ticks:{ color:'#888', font:{size:11} } }, y:{ grid:{ color:'rgba(128,128,128,0.1)' }, ticks:{ color:'#888', font:{size:11}, callback: v => v + 'ml' } } }
    }
  });
}

// ── Profile ────────────────────────────────────────────────────────────
function loadProfileUI() {
  if (profile.age)    document.getElementById('pf-age').value    = profile.age;
  if (profile.weight) document.getElementById('pf-weight').value = profile.weight;
  if (profile.height) document.getElementById('pf-height').value = profile.height;
  document.getElementById('pf-sex').value      = profile.sex;
  document.getElementById('pf-activity').value = profile.activity;
  if (profile.goal) selectGoal(profile.goal, true);
}

function selectGoal(g, silent) {
  ['bulk','maintain','cut'].forEach(k => {
    const el = document.getElementById('go-' + k);
    el.classList.toggle('selected', k === g);
    el.style.borderColor = k === g ? GOALS[k].color : '';
    el.style.background  = k === g ? (k==='bulk'?'#E6F1FB':k==='cut'?'#FCEBEB':'#EAF3DE') : '';
  });
  profile.goal = g;
  if (!silent) updateTDEE();
}

function updateTDEE() {
  const p = {
    age:      document.getElementById('pf-age').value,
    sex:      document.getElementById('pf-sex').value,
    weight:   document.getElementById('pf-weight').value,
    height:   document.getElementById('pf-height').value,
    activity: document.getElementById('pf-activity').value,
    goal:     profile.goal || 'maintain'
  };
  const c = calcGoal(p), box = document.getElementById('tdee-result');
  if (c) {
    box.style.display = 'flex';
    document.getElementById('td-bmr').textContent  = c.bmr  + ' kcal';
    document.getElementById('td-tdee').textContent = c.tdee + ' kcal';
    document.getElementById('td-goal').textContent = c.kcal + ' kcal/day';
    document.getElementById('td-prot').textContent = c.prot + 'g / day';
  } else { box.style.display = 'none'; }
}

['pf-age','pf-weight','pf-height','pf-sex','pf-activity'].forEach(id => {
  document.getElementById(id).addEventListener('input', updateTDEE);
});

function saveProfile() {
  profile = {
    age:      document.getElementById('pf-age').value,
    sex:      document.getElementById('pf-sex').value,
    weight:   document.getElementById('pf-weight').value,
    height:   document.getElementById('pf-height').value,
    activity: parseFloat(document.getElementById('pf-activity').value),
    goal:     profile.goal || 'maintain'
  };
  S.set('profile', profile); updateGoalBadge(); updateSummary(); switchTab('log');
}

// ── Init ───────────────────────────────────────────────────────────────
document.getElementById('wt-date').value = todayKey;
loadProfileUI(); renderLog(); updateSummary(); updateGoalBadge(); renderWater(); renderWeightLog();
