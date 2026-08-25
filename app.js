// ================================
// APP STATE
// ================================

const SESSION_KEY = 'trainingEvaluationParticipantSessionOSMV2';

const AppState = {
  route: (window.APP_BOOTSTRAP && window.APP_BOOTSTRAP.route) || 'home',
  certificateToken: (window.APP_BOOTSTRAP && window.APP_BOOTSTRAP.certificateToken) || '',
  config: null,
  session: loadParticipantSession(),
  tests: { PRE: null, POST: null },
  evaluation: null,
  lastResult: null,
  loadingCount: 0,
  modalResolver: null
};

document.addEventListener('DOMContentLoaded', initApp);

async function initApp() {
  bindGlobalEvents();
  navigateTo(AppState.route, false);
  await loadAppConfig();
  updateSessionControls();
  if (AppState.route === 'verify') await verifyPublicCertificate();
  else if (AppState.route === 'certificate') await openCertificatePage(false);
  else if (['pre-test', 'post-test', 'result', 'evaluation'].includes(AppState.route)) await resumeParticipant();
}

async function loadAppConfig() {
  setLoading(true, 'กำลังเชื่อมต่อระบบ...');
  try {
    const config = await runServer('getPublicAppConfig');
    AppState.config = config;
    renderAppConfig(config);
    configureRegistrationForm(config);

    if (!config.ok) {
      setSystemStatus('warning', 'ยังไม่ได้ติดตั้งระบบ');
      showToast(config.message || 'กรุณารัน setupSystem()', 'warning');
      return;
    }
    setSystemStatus('success', 'ระบบพร้อมใช้งาน');
  } catch (error) {
    handleError(error, 'ไม่สามารถโหลดการตั้งค่าระบบ');
    setSystemStatus('danger', 'เชื่อมต่อระบบไม่สำเร็จ');
  } finally {
    setLoading(false);
  }
}

function renderAppConfig(config) {
  setText('appName', config.appName || 'ระบบประเมินผลการฝึกอบรม อสม.');
  setText('footerAppName', config.appName || 'ระบบประเมินผลการฝึกอบรม อสม.');
  setText('appVersion', 'Version ' + (config.version || '—'));
  setText('organizationText', config.organization || 'ยังไม่ได้ระบุหน่วยงานจัดอบรม');

  if (config.theme) {
    document.documentElement.style.setProperty('--primary', config.theme.primary || '#6C63FF');
    document.documentElement.style.setProperty('--secondary', config.theme.secondary || '#22B8CF');
  }

  const course = config.course;
  if (course) {
    setText('courseTitle', course.title || 'ไม่ระบุชื่อหลักสูตร');
    setText('courseDescription', course.description || '');
  }

  const batch = Array.isArray(config.batches) && config.batches.length ? config.batches[0] : null;
  setText('batchName', batch ? batch.batchName : 'ยังไม่มีรุ่นที่เปิดใช้งาน');
  setText('trainingDate', batch ? formatTrainingDateRange(batch.trainingDate, batch.trainingEndDate) : '—');
  setText('venue', batch ? batch.venue : '—');

  const startButton = document.getElementById('startButton');
  if (startButton) startButton.disabled = !config.ok || !config.registrationOpen;
}

function configureRegistrationForm(config) {
  const courseSelect = document.getElementById('registrationCourse');
  const batchSelect = document.getElementById('registrationBatch');
  if (!courseSelect || !batchSelect) return;

  courseSelect.innerHTML = '';
  if (config.course) {
    courseSelect.appendChild(createOption(config.course.courseId, config.course.title, true));
  } else {
    courseSelect.appendChild(createOption('', 'ยังไม่มีหลักสูตรที่เปิดใช้งาน', true));
  }

  batchSelect.innerHTML = '';
  if (!Array.isArray(config.batches) || !config.batches.length) {
    batchSelect.appendChild(createOption('', 'ยังไม่มีรุ่นอบรมที่เปิดรับ', true));
    batchSelect.disabled = true;
    return;
  }
  config.batches.forEach((batch, index) => {
    const label = [batch.batchName, formatTrainingDateRange(batch.trainingDate, batch.trainingEndDate), batch.venue]
      .filter(Boolean).join(' · ');
    batchSelect.appendChild(createOption(batch.batchId, label, index === 0));
  });
  batchSelect.disabled = false;
  loadRosterMoos();
}

function createOption(value, label, selected) {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = label;
  option.selected = Boolean(selected);
  return option;
}

async function loadRosterMoos() {
  const mooSelect = document.getElementById('registrationMoo');
  const communitySelect = document.getElementById('registrationCommunity');
  if (!mooSelect || !communitySelect) return;
  resetSelect(communitySelect, 'เลือกหมู่ก่อน', true);
  resetRosterVerification();
  resetSelect(mooSelect, 'กำลังโหลดรายชื่อ...', true);
  try {
    const response = await runServer('getRosterRegistrationOptions', {});
    resetSelect(mooSelect, 'เลือกหมู่', false);
    (response.moos || []).forEach(moo => mooSelect.appendChild(createOption(moo, 'หมู่ ' + moo, false)));
  } catch (error) {
    resetSelect(mooSelect, 'โหลดรายชื่อไม่สำเร็จ', true);
    handleError(error, 'ไม่สามารถโหลดรายชื่อ อสม. ได้');
  }
}

async function loadRosterCommunities() {
  const moo = document.getElementById('registrationMoo').value;
  const communitySelect = document.getElementById('registrationCommunity');
  resetRosterVerification();
  if (!moo) { resetSelect(communitySelect, 'เลือกหมู่ก่อน', true); return; }
  resetSelect(communitySelect, 'กำลังโหลดชุมชน...', true);
  try {
    const response = await runServer('getRosterRegistrationOptions', { moo: moo });
    resetSelect(communitySelect, 'เลือกชุมชน', false);
    (response.communities || []).forEach(name => communitySelect.appendChild(createOption(name, name, false)));
  } catch (error) {
    resetSelect(communitySelect, 'โหลดชุมชนไม่สำเร็จ', true);
    handleError(error, 'ไม่สามารถโหลดชุมชนได้');
  }
}

async function loadRosterNames() {
  const moo = document.getElementById('registrationMoo').value;
  const community = document.getElementById('registrationCommunity').value;
  resetRosterVerification();
  if (!moo || !community) return;
  try {
    const response = await runServer('getRosterRegistrationOptions', { moo: moo, community: community });
    setText('rosterVerificationStatus', response.message || 'กรอกเบอร์โทรศัพท์เพื่อค้นหารายชื่อ');
  } catch (error) {
    handleError(error, 'ไม่สามารถตรวจสอบรายชื่อในชุมชนได้');
  }
}

function resetRosterVerification() {
  const ref = document.getElementById('registrationRosterRef');
  const name = document.getElementById('registrationMatchedName');
  if (ref) ref.value = '';
  if (name) name.value = '';
  setText('rosterVerificationStatus', 'กรุณาเลือกหมู่ ชุมชน และกรอกเบอร์โทรศัพท์ก่อน');
}

async function verifyRosterIdentityClient() {
  const moo = document.getElementById('registrationMoo').value;
  const community = document.getElementById('registrationCommunity').value;
  const phone = document.getElementById('registrationPhone').value.trim();
  if (!moo || !community || !/^0[0-9]{8,9}$/.test(phone)) {
    showToast('กรุณาเลือกหมู่ ชุมชน และกรอกเบอร์โทรศัพท์เต็ม', 'warning');
    return;
  }
  setButtonBusy('verifyRosterButton', true, 'กำลังตรวจสอบ...');
  try {
    const response = await runServer('verifyRosterIdentity', { moo: moo, community: community, phone: phone });
    if (!response.matched) {
      resetRosterVerification();
      setText('rosterVerificationStatus', response.message || 'ไม่พบรายชื่อที่ตรงกัน');
      showToast(response.message || 'ไม่พบรายชื่อที่ตรงกัน', 'warning');
      return;
    }
    document.getElementById('registrationRosterRef').value = response.rosterRef;
    document.getElementById('registrationMatchedName').value = response.displayName;
    setText('rosterVerificationStatus', 'ยืนยันรายชื่อสำเร็จ');
    showToast('พบรายชื่อ ' + response.displayName, 'success');
  } catch (error) {
    resetRosterVerification();
    handleError(error, 'ตรวจสอบรายชื่อไม่สำเร็จ');
  } finally {
    setButtonBusy('verifyRosterButton', false, 'ค้นหาและยืนยันรายชื่อ');
  }
}

function resetSelect(select, label, disabled) {
  select.innerHTML = '';
  select.appendChild(createOption('', label, true));
  select.disabled = Boolean(disabled);
}

// ================================
// SERVER API
// ================================

function runServer(functionName, ...args) {
  const actionMap = Object.freeze({
    getRosterRegistrationOptions: 'roster.options',
    verifyRosterIdentity: 'roster.verify',
    registerParticipant: 'participant.register',
    submitRosterRequest: 'roster.request',
    findParticipantRegistrations: 'participant.find',
    resumeParticipantRegistration: 'participant.resume',
    getParticipantProgress: 'participant.progress',
    startPreTest: 'test.pre.start',
    submitPreTest: 'test.pre.submit',
    startPostTest: 'test.post.start',
    submitPostTest: 'test.post.submit',
    getEvaluationQuestions: 'evaluation.questions',
    submitEvaluation: 'evaluation.submit',
    checkCertificateEligibility: 'certificate.eligibility',
    issueCertificate: 'certificate.issue',
    getParticipantCertificate: 'certificate.get',
    verifyCertificate: 'certificate.verify'
  });
  if (functionName === 'getPublicAppConfig') return apiJsonp('public.config');
  if (!actionMap[functionName]) {
    return Promise.reject(new Error('หน้า GitHub ไม่มีสิทธิ์เรียกคำสั่งผู้ดูแล: ' + functionName));
  }
  return apiPost(actionMap[functionName], args[0] || {});
}

function getApiUrl_() {
  const value = String(window.TRAINING_APP_CONFIG && window.TRAINING_APP_CONFIG.GAS_API_URL || '').trim();
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(value)) {
    throw new Error('ยังไม่ได้ตั้งค่า GAS_API_URL ในไฟล์ config.js');
  }
  return value;
}

function getApiClientId_() {
  const key = 'trainingOsmApiClientIdV1';
  let value = '';
  try { value = localStorage.getItem(key) || ''; } catch (error) { console.warn(error); }
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(value)) {
    value = (window.crypto && crypto.randomUUID)
      ? crypto.randomUUID().replace(/-/g, '')
      : String(Date.now()) + Math.random().toString(36).slice(2);
    try { localStorage.setItem(key, value); } catch (error) { console.warn(error); }
  }
  return value;
}

function apiJsonp(action) {
  return new Promise((resolve, reject) => {
    let apiUrl;
    try { apiUrl = getApiUrl_(); } catch (error) { reject(error); return; }
    const callbackName = '__trainingApi_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    const script = document.createElement('script');
    const timeoutMs = Number(window.TRAINING_APP_CONFIG.REQUEST_TIMEOUT_MS || 30000);
    const cleanup = () => {
      window.clearTimeout(timer);
      script.remove();
      try { delete window[callbackName]; } catch (error) { window[callbackName] = undefined; }
    };
    window[callbackName] = envelope => {
      cleanup();
      if (envelope && envelope.ok) resolve(envelope.result);
      else reject(new Error(envelope && envelope.error && envelope.error.message || 'API ตอบกลับไม่สำเร็จ'));
    };
    script.onerror = () => { cleanup(); reject(new Error('เชื่อมต่อ Public API ไม่สำเร็จ')); };
    const timer = window.setTimeout(() => { cleanup(); reject(new Error('Public API ใช้เวลานานเกินกำหนด')); }, timeoutMs);
    script.src = apiUrl + '?api=' + encodeURIComponent(action) + '&callback=' + encodeURIComponent(callbackName);
    document.head.appendChild(script);
  });
}

function apiPost(action, payload) {
  return new Promise((resolve, reject) => {
    let apiUrl;
    try { apiUrl = getApiUrl_(); } catch (error) { reject(error); return; }
    const requestId = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random();
    const frame = document.createElement('iframe');
    const form = document.createElement('form');
    const field = document.createElement('input');
    const frameName = 'training_api_' + requestId.replace(/[^A-Za-z0-9_]/g, '');
    const timeoutMs = Number(window.TRAINING_APP_CONFIG.REQUEST_TIMEOUT_MS || 30000);
    frame.name = frameName;
    frame.hidden = true;
    frame.setAttribute('aria-hidden', 'true');
    form.method = 'POST';
    form.action = apiUrl;
    form.target = frameName;
    form.hidden = true;
    field.type = 'hidden';
    field.name = 'request';
    field.value = JSON.stringify({
      action: action,
      payload: payload || {},
      requestId: requestId,
      clientId: getApiClientId_(),
      origin: window.location.origin,
      transport: 'iframe'
    });
    form.appendChild(field);
    const cleanup = deferFrameRemoval => {
      window.clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      form.remove();
      // GAS injects gas-hub.js into HtmlService responses. Removing its iframe
      // during initialisation can race with its MutationObserver.
      if (deferFrameRemoval) window.setTimeout(() => frame.remove(), 500);
      else frame.remove();
    };
    const onMessage = event => {
      const envelope = event.data;
      if (!envelope || envelope.requestId !== requestId) return;
      let trustedGoogleOrigin = false;
      try {
        const eventUrl = new URL(event.origin);
        const host = eventUrl.hostname.toLowerCase();
        trustedGoogleOrigin = eventUrl.protocol === 'https:' && (
          host === 'script.google.com' ||
          host === 'script.googleusercontent.com' ||
          host.endsWith('-script.googleusercontent.com')
        );
      } catch (error) { trustedGoogleOrigin = false; }
      // Apps Script IFRAME sandbox can expose an opaque `null` origin. It is
      // accepted only after the unguessable per-request UUID matches.
      if (!trustedGoogleOrigin && event.origin !== 'null') return;
      cleanup(true);
      if (envelope.ok) resolve(envelope.result);
      else reject(new Error(envelope.error && envelope.error.message || 'API ตอบกลับไม่สำเร็จ'));
    };
    window.addEventListener('message', onMessage);
    const timer = window.setTimeout(() => { cleanup(false); reject(new Error('Public API ใช้เวลานานเกินกำหนด')); }, timeoutMs);
    document.body.appendChild(frame);
    document.body.appendChild(form);
    form.submit();
  });
}

function normalizeServerError(error) {
  if (error instanceof Error) return error;
  const message = error && error.message ? error.message : String(error || 'เกิดข้อผิดพลาด');
  return new Error(message.replace(/^Exception:\s*/, ''));
}

// ================================
// NAVIGATION
// ================================

function navigateTo(route, updateHistory = true) {
  const routes = ['home', 'resume', 'registration', 'pre-test', 'post-test', 'result', 'evaluation', 'certificate', 'verify'];
  const safeRoute = routes.includes(route) ? route : 'home';
  AppState.route = safeRoute;

  document.querySelectorAll('[data-page]').forEach(section => {
    const active = section.dataset.page === safeRoute;
    section.hidden = !active;
    section.classList.toggle('is-active', active);
  });
  updateStepper(safeRoute);

  if (updateHistory && window.history && window.history.pushState) {
    const url = new URL(window.location.href);
    url.searchParams.set('page', safeRoute);
    window.history.pushState({ route: safeRoute }, '', url.toString());
  }

  const main = document.getElementById('mainContent');
  if (main) main.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function updateStepper(route) {
  const stepOrder = ['registration', 'pre-test', 'post-test', 'evaluation', 'certificate'];
  let current = route === 'home' ? 0 : stepOrder.indexOf(route);
  if (route === 'result') {
    current = AppState.lastResult && AppState.lastResult.evaluationCompleted ? 3 :
      (AppState.lastResult && AppState.lastResult.mode === 'POST' ? 2 : 1);
  }
  if (current < 0) current = 0;

  document.querySelectorAll('[data-step]').forEach((element, index) => {
    element.classList.toggle('is-active', current >= 0 && index === current);
    element.classList.toggle('is-complete', current >= 0 && index < current);
    if (index === current) element.setAttribute('aria-current', 'step');
    else element.removeAttribute('aria-current');
  });
}

// ================================
// REGISTRATION
// ================================

async function submitRegistration(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  if (!AppState.config || !AppState.config.course) {
    showToast('ยังไม่มีหลักสูตรที่เปิดใช้งาน', 'warning');
    return;
  }

  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());
  if (!payload.rosterRef) {
    showToast('กรุณากดค้นหาและยืนยันรายชื่อก่อนลงทะเบียน', 'warning');
    return;
  }
  payload.courseId = AppState.config.course.courseId;
  payload.batchId = String(formData.get('batchId') || '');
  payload.consent = formData.get('consent') === 'true';
  if (AppState.session) payload.registrationId = AppState.session.registrationId;

  setLoading(true, 'กำลังบันทึกการลงทะเบียน...');
  setButtonBusy('registerSubmitButton', true, 'กำลังลงทะเบียน...');
  try {
    const response = await runServer('registerParticipant', payload);
    if (!response.ok) {
      showToast(response.message || 'ไม่สามารถลงทะเบียนได้', response.duplicate ? 'warning' : 'danger', 6500);
      return;
    }
    saveParticipantSession(response.session);
    showToast(response.message, 'success');
    await startTest('PRE');
  } catch (error) {
    handleError(error, 'ลงทะเบียนไม่สำเร็จ');
  } finally {
    setButtonBusy('registerSubmitButton', false, 'ลงทะเบียนและเริ่ม Pre-test');
    setLoading(false);
  }
}

function toggleRosterRequestForm(show) {
  const registration = document.getElementById('registrationForm');
  const request = document.getElementById('rosterRequestForm');
  if (!registration || !request) return;
  registration.hidden = Boolean(show);
  request.hidden = !show;
  if (show) {
    const moo = document.getElementById('registrationMoo').value;
    const community = document.getElementById('registrationCommunity').value;
    if (moo) request.elements.moo.value = moo;
    if (community) request.elements.community.value = community;
    request.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

async function submitRosterRequestClient(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());
  payload.courseId = AppState.config && AppState.config.course ? AppState.config.course.courseId : '';
  payload.batchId = document.getElementById('registrationBatch').value;
  payload.consent = formData.get('consent') === 'true';
  setButtonBusy('submitRosterRequestButton', true, 'กำลังส่งคำขอ...');
  setLoading(true, 'กำลังบันทึกคำขอ...');
  try {
    const response = await runServer('submitRosterRequest', payload);
    showToast(response.message, response.ok ? 'success' : 'warning', 7500);
    if (response.ok) {
      form.reset();
      toggleRosterRequestForm(false);
    }
  } catch (error) {
    handleError(error, 'ส่งคำขอเพิ่มรายชื่อไม่สำเร็จ');
  } finally {
    setButtonBusy('submitRosterRequestButton', false, 'ส่งคำขอ');
    setLoading(false);
  }
}

async function resumeParticipant() {
  if (!AppState.session) {
    navigateTo('registration');
    return;
  }
  setLoading(true, 'กำลังตรวจสอบความคืบหน้า...');
  try {
    const progress = await runServer('getParticipantProgress', AppState.session);
    if (!progress || !progress.nextStep) {
      throw new Error('ไม่ได้รับข้อมูลความคืบหน้าจากระบบ กรุณา Deploy Code.gs และ Js.html เป็นเวอร์ชันเดียวกัน');
    }
    if (progress.nextStep === 'pre-test') {
      await startTest('PRE');
      return;
    }
    if (progress.nextStep === 'post-test') {
      renderProgressResult(progress);
      navigateTo('result');
      return;
    }
    if (progress.nextStep === 'evaluation' && AppState.route === 'evaluation') {
      renderProgressResult(progress);
      await startEvaluation();
      return;
    }
    if (progress.nextStep === 'certificate' || AppState.route === 'certificate') {
      await openCertificatePage(false);
      return;
    }
    renderProgressResult(progress);
    navigateTo('result');
  } catch (error) {
    if (/ข้อมูลการลงทะเบียนไม่ถูกต้อง|ถูกยกเลิก|ไม่พบข้อมูลการลงทะเบียน/.test(error.message || '')) {
      clearParticipantSession();
    }
    handleError(error, 'ไม่สามารถเรียกคืนรายการเดิมได้');
    navigateTo(AppState.session ? 'resume' : 'registration');
  } finally {
    setLoading(false);
  }
}

function renderProgressResult(progress) {
  const post = progress.postTest && progress.postTest.status === 'SUBMITTED' ? progress.postTest : null;
  const pre = progress.preTest && progress.preTest.status === 'SUBMITTED' ? progress.preTest : null;
  const result = post ? {
    mode: 'POST', participant: progress.participant,
    preScore: pre.score, preTotal: pre.total, prePercentage: pre.percentage,
    score: post.score, total: post.total, percentage: post.percentage,
    learningGainPoints: post.learningGainPoints, resultLevel: post.resultLevel,
    evaluationCompleted: Boolean(progress.evaluation), certificate: progress.certificate || null
  } : {
    mode: 'PRE', participant: progress.participant,
    score: pre ? pre.score : 0, total: pre ? pre.total : 0,
    percentage: pre ? pre.percentage : 0
  };
  renderResult(result);
}

function saveParticipantSession(session) {
  AppState.session = session;
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (error) { console.warn(error); }
  updateSessionControls();
}

function loadParticipantSession() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
    if (!parsed) return null;
    if (parsed.sessionToken) return parsed;
    return parsed.participantId && parsed.registrationId ? parsed : null;
  } catch (error) {
    return null;
  }
}

function clearParticipantSession() {
  AppState.session = null;
  try {
    sessionStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(SESSION_KEY);
  } catch (error) { console.warn(error); }
  updateSessionControls();
}

function updateSessionControls() {
  const continueButton = document.getElementById('continueButton');
  if (continueButton) continueButton.hidden = !AppState.session;
}

// ================================
// FIND / RESUME REGISTRATION
// ================================

async function findParticipantRegistrationsClient(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const query = document.getElementById('participantLookupQuery').value.trim();
  setButtonBusy('participantLookupButton', true, 'กำลังค้นหา...');
  setLoading(true, 'กำลังค้นหารายการลงทะเบียน...');
  try {
    const response = await runServer('findParticipantRegistrations', { query: query });
    renderParticipantLookupResults(response, query);
  } catch (error) {
    handleError(error, 'ค้นหารายการไม่สำเร็จ');
  } finally {
    setButtonBusy('participantLookupButton', false, 'ค้นหารายการ');
    setLoading(false);
  }
}

function renderParticipantLookupResults(response, query) {
  const results = document.getElementById('participantLookupResults');
  const empty = document.getElementById('participantLookupEmpty');
  const list = document.getElementById('participantCandidateList');
  list.innerHTML = '';
  document.getElementById('selectedCandidateRef').value = '';
  document.getElementById('participantResumeButton').disabled = true;
  results.hidden = !response.found;
  empty.hidden = response.found;
  setText('participantLookupMessage', response.message || '');
  if (!response.found) return;

  const confirmPhone = document.getElementById('participantConfirmPhone');
  confirmPhone.value = response.queryType === 'PHONE' ? String(query).replace(/\D/g, '') : '';

  response.candidates.forEach((candidate, index) => {
    const label = document.createElement('label');
    label.className = 'resume-candidate';
    const radio = document.createElement('input');
    radio.type = 'radio'; radio.name = 'resumeCandidate'; radio.value = candidate.candidateRef;
    const body = document.createElement('span'); body.className = 'resume-candidate__body';
    const title = document.createElement('strong'); title.textContent = candidate.displayName;
    const course = document.createElement('span'); course.textContent = candidate.courseName;
    const meta = document.createElement('small');
    const location = [candidate.moo ? 'หมู่ ' + candidate.moo : '', candidate.community].filter(Boolean).join(' · ');
    meta.textContent = [location, candidate.batchName, candidate.progressLabel].filter(Boolean).join(' · ');
    body.append(title, course, meta); label.append(radio, body); list.appendChild(label);
    radio.addEventListener('change', () => {
      document.querySelectorAll('.resume-candidate').forEach(item => item.classList.toggle('is-selected', item.contains(radio)));
      document.getElementById('selectedCandidateRef').value = radio.value;
      document.getElementById('participantResumeButton').disabled = false;
    });
    if (response.candidates.length === 1 && index === 0) radio.click();
  });
}

async function resumeParticipantRegistrationClient(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const candidateRef = document.getElementById('selectedCandidateRef').value;
  if (!candidateRef) { showToast('กรุณาเลือกรายการลงทะเบียน', 'warning'); return; }
  const phone = document.getElementById('participantConfirmPhone').value.trim();
  setButtonBusy('participantResumeButton', true, 'กำลังยืนยัน...');
  setLoading(true, 'กำลังเรียกคืนรายการ...');
  try {
    const response = await runServer('resumeParticipantRegistration', { candidateRef: candidateRef, phone: phone });
    const restoredSession = response && response.session ? response.session : {
      participantId: response && response.participantId,
      registrationId: response && response.registrationId
    };
    const validSession = restoredSession && (restoredSession.sessionToken ||
      (restoredSession.participantId && restoredSession.registrationId));
    if (!response || !validSession || !response.nextStep) {
      const backendVersion = response && response.backendVersion ? response.backendVersion : 'ไม่ทราบเวอร์ชัน';
      throw new Error('ข้อมูลเรียกคืนไม่สมบูรณ์ · Backend: ' + backendVersion +
        ' · กรุณาตรวจว่า Code.gs และ Js.html เป็น Version 8.0.0-github-api และ Deploy เป็น New version');
    }
    saveParticipantSession(restoredSession);
    showToast(response.message, 'success');
    await continueFromRestoredStep(response.nextStep);
  } catch (error) {
    handleError(error, 'ไม่สามารถเรียกคืนรายการได้');
  } finally {
    setButtonBusy('participantResumeButton', false, 'ยืนยันและทำรายการต่อ');
    setLoading(false);
  }
}

async function continueFromRestoredStep(nextStep) {
  if (nextStep === 'pre-test') { await startTest('PRE'); return; }
  if (nextStep === 'post-test') { await startTest('POST'); return; }
  if (nextStep === 'evaluation') { await startEvaluation(); return; }
  if (nextStep === 'result' || nextStep === 'certificate') { await openCertificatePage(true); return; }
  throw new Error('ไม่รู้จักขั้นตอนที่ต้องทำต่อ: ' + String(nextStep || 'ว่าง'));
}

// ================================
// PRE / POST TEST
// ================================

async function startTest(mode) {
  if (!AppState.session) {
    navigateTo('registration');
    showToast('กรุณาลงทะเบียนก่อนทำแบบทดสอบ', 'warning');
    return;
  }
  const functionName = mode === 'PRE' ? 'startPreTest' : 'startPostTest';
  setLoading(true, mode === 'PRE' ? 'กำลังเตรียม Pre-test...' : 'กำลังเตรียม Post-test...');
  try {
    const response = await runServer(functionName, AppState.session);
    if (!response.ok && response.alreadySubmitted) {
      renderResult(response.result);
      navigateTo('result');
      showToast(response.message, 'info');
      return;
    }
    AppState.tests[mode] = {
      attemptId: response.attemptId,
      questions: response.questions,
      answers: {},
      currentIndex: 0
    };
    renderCurrentQuestion(mode);
    navigateTo(mode === 'PRE' ? 'pre-test' : 'post-test');
  } catch (error) {
    handleError(error, 'ไม่สามารถเริ่มแบบทดสอบได้');
  } finally {
    setLoading(false);
  }
}

function renderCurrentQuestion(mode) {
  const test = AppState.tests[mode];
  if (!test || !test.questions.length) return;
  const prefix = mode === 'PRE' ? 'pre' : 'post';
  const question = test.questions[test.currentIndex];
  const total = test.questions.length;
  const current = test.currentIndex + 1;

  setText(prefix + 'Counter', 'ข้อ ' + current + ' / ' + total);
  setText(prefix + 'QuestionNumber', 'คำถามข้อที่ ' + current);
  setText(prefix + 'QuestionText', question.questionText);

  const progressBar = document.getElementById(prefix + 'ProgressBar');
  if (progressBar) progressBar.style.width = (current * 100 / total) + '%';

  const choiceList = document.getElementById(prefix + 'Choices');
  choiceList.querySelectorAll('label.choice-option').forEach(element => element.remove());
  question.choices.forEach(choice => {
    const label = document.createElement('label');
    label.className = 'choice-option';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = prefix + '-question-' + question.questionId;
    input.value = choice.id;
    input.checked = test.answers[question.questionId] === choice.id;
    input.addEventListener('change', () => {
      test.answers[question.questionId] = choice.id;
      label.closest('.choice-list').querySelectorAll('.choice-option')
        .forEach(option => option.classList.toggle('is-selected', option.contains(input) && input.checked));
    });
    const marker = document.createElement('span');
    marker.className = 'choice-option__marker';
    marker.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    text.textContent = choice.text;
    label.append(input, marker, text);
    label.classList.toggle('is-selected', input.checked);
    choiceList.appendChild(label);
  });

  const previousButton = document.getElementById(prefix + 'PreviousButton');
  const nextButton = document.getElementById(prefix + 'NextButton');
  const submitButton = document.getElementById(prefix + 'SubmitButton');
  previousButton.disabled = test.currentIndex === 0;
  nextButton.hidden = current === total;
  submitButton.hidden = current !== total;
}

function moveQuestion(mode, direction) {
  const test = AppState.tests[mode];
  if (!test) return;
  const currentQuestion = test.questions[test.currentIndex];
  if (direction > 0 && !test.answers[currentQuestion.questionId]) {
    showToast('กรุณาเลือกคำตอบก่อนทำข้อต่อไป', 'warning');
    return;
  }
  const nextIndex = test.currentIndex + direction;
  if (nextIndex < 0 || nextIndex >= test.questions.length) return;
  test.currentIndex = nextIndex;
  renderCurrentQuestion(mode);
}

async function submitTest(mode) {
  const test = AppState.tests[mode];
  if (!test) return;
  const unanswered = test.questions.filter(question => !test.answers[question.questionId]);
  if (unanswered.length) {
    showToast('ยังไม่ได้ตอบ ' + unanswered.length + ' ข้อ กรุณาตอบให้ครบ', 'warning');
    return;
  }

  const confirmed = await confirmAction(
    'ยืนยันการส่งคำตอบ',
    'หลังส่งแล้วจะไม่สามารถแก้ไขหรือทำแบบทดสอบนี้ซ้ำได้'
  );
  if (!confirmed) return;

  const answers = test.questions.map(question => ({
    questionId: question.questionId,
    selectedChoiceId: test.answers[question.questionId]
  }));
  const payload = Object.assign({}, AppState.session, { attemptId: test.attemptId, answers: answers });
  const functionName = mode === 'PRE' ? 'submitPreTest' : 'submitPostTest';
  const prefix = mode === 'PRE' ? 'pre' : 'post';

  setLoading(true, 'กำลังตรวจและบันทึกคะแนน...');
  setButtonBusy(prefix + 'SubmitButton', true, 'กำลังส่งคำตอบ...');
  try {
    const response = await runServer(functionName, payload);
    renderResult(response.result);
    navigateTo('result');
    showToast(response.message || 'บันทึกคะแนนสำเร็จ', response.ok ? 'success' : 'info');
  } catch (error) {
    handleError(error, 'ไม่สามารถส่งคำตอบได้');
  } finally {
    setButtonBusy(prefix + 'SubmitButton', false,
      mode === 'PRE' ? 'ส่งคำตอบ Pre-test' : 'ส่งคำตอบ Post-test');
    setLoading(false);
  }
}

// ================================
// RESULT / LEARNING GAIN
// ================================

function renderResult(result) {
  if (!result) return;
  AppState.lastResult = result;
  const isPost = result.mode === 'POST';
  const evaluationCompleted = Boolean(result.evaluationCompleted);

  setText('resultModeLabel', isPost ? 'Post-test Result' : 'Pre-test Result');
  setText('resultHeading', isPost ? 'สรุปผลการเรียนรู้' : 'บันทึกคะแนน Pre-test สำเร็จ');
  setText('resultParticipant', result.participant ? result.participant.displayName : '');

  if (isPost) {
    setText('resultPre', formatScore(result.preScore, result.preTotal));
    setText('resultPrePercent', formatPercent(result.prePercentage));
    setText('resultPost', formatScore(result.score, result.total));
    setText('resultPostPercent', formatPercent(result.percentage));
    setText('resultGain', formatSignedNumber(result.learningGainPoints));
    setText('resultLevel', result.resultLevel || '—');
  } else {
    setText('resultPre', formatScore(result.score, result.total));
    setText('resultPrePercent', formatPercent(result.percentage));
    setText('resultPost', 'รอทำ');
    setText('resultPostPercent', 'Post-test');
    setText('resultGain', '—');
    setText('resultLevel', 'รอ Post-test');
  }

  const startPostButton = document.getElementById('startPostButton');
  const evaluationButton = document.getElementById('evaluationButton');
  const certificateButton = document.getElementById('certificateButton');
  startPostButton.hidden = isPost;
  evaluationButton.disabled = false;
  evaluationButton.hidden = !isPost || evaluationCompleted;
  if (certificateButton) certificateButton.hidden = !isPost || !evaluationCompleted;
  const completionBanner = document.getElementById('evaluationCompleteBanner');
  if (completionBanner) completionBanner.hidden = !evaluationCompleted;
  renderAnswerReview(isPost ? result.review : null);
  updateStepper('result');
}

function renderAnswerReview(review) {
  const container = document.getElementById('answerReview');
  const list = document.getElementById('answerReviewList');
  list.innerHTML = '';
  if (!Array.isArray(review) || !review.length) {
    container.hidden = true;
    return;
  }
  review.forEach((item, index) => {
    const article = document.createElement('article');
    article.className = 'review-item ' + (item.isCorrect ? 'is-correct' : 'is-incorrect');
    const title = document.createElement('h4');
    title.textContent = (index + 1) + '. ' + item.questionText;
    const status = document.createElement('p');
    status.className = 'review-item__status';
    status.textContent = item.isCorrect ? '✓ ตอบถูก' : '✕ ตอบไม่ถูก';
    const selected = document.createElement('p');
    selected.textContent = 'คำตอบของคุณ: ' + item.selectedText;
    article.append(title, status, selected);
    if (!item.isCorrect) {
      const correct = document.createElement('p');
      correct.textContent = 'คำตอบที่ถูก: ' + item.correctText;
      article.appendChild(correct);
    }
    if (item.explanation) {
      const explanation = document.createElement('p');
      explanation.className = 'review-item__explanation';
      explanation.textContent = item.explanation;
      article.appendChild(explanation);
    }
    list.appendChild(article);
  });
  container.hidden = false;
}

function formatScore(score, total) { return Number(score || 0) + '/' + Number(total || 0); }
function formatPercent(value) { return formatNumber(value) + '%'; }
function formatSignedNumber(value) {
  const number = Number(value || 0);
  return (number > 0 ? '+' : '') + formatNumber(number);
}
function formatNumber(value) {
  return new Intl.NumberFormat('th-TH', { maximumFractionDigits: 2 }).format(Number(value || 0));
}

// ================================
// EVALUATION
// ================================

async function startEvaluation() {
  if (!AppState.session) {
    navigateTo('registration');
    return;
  }
  setLoading(true, 'กำลังโหลดแบบประเมิน...');
  try {
    const response = await runServer('getEvaluationQuestions', AppState.session);
    if (!response.ok && response.alreadySubmitted) {
      markEvaluationComplete(response.summary);
      showToast(response.message, 'info');
      return;
    }
    AppState.evaluation = response;
    renderEvaluationQuestions(response);
    navigateTo('evaluation');
  } catch (error) {
    handleError(error, 'ไม่สามารถโหลดแบบประเมินได้');
  } finally {
    setLoading(false);
  }
}

function renderEvaluationQuestions(response) {
  const container = document.getElementById('evaluationQuestionGroups');
  container.innerHTML = '';
  const groups = response.questions.reduce((map, question) => {
    if (!map[question.category]) map[question.category] = [];
    map[question.category].push(question);
    return map;
  }, {});

  Object.entries(groups).forEach(([category, questions]) => {
    const section = document.createElement('section');
    section.className = 'evaluation-group';
    const heading = document.createElement('h3');
    heading.textContent = category;
    section.appendChild(heading);

    questions.forEach(question => {
      if (question.type === 'RATING') {
        section.appendChild(createRatingQuestion(question, response.scale));
      } else {
        section.appendChild(createTextQuestion(question));
      }
    });
    container.appendChild(section);
  });
}

function createRatingQuestion(question, scale) {
  const fieldset = document.createElement('fieldset');
  fieldset.className = 'evaluation-question';
  fieldset.dataset.evalQuestion = question.questionId;
  fieldset.dataset.type = 'RATING';
  const legend = document.createElement('legend');
  legend.textContent = question.questionText;
  fieldset.appendChild(legend);
  const options = document.createElement('div');
  options.className = 'rating-options';

  scale.forEach(item => {
    const label = document.createElement('label');
    label.className = 'rating-option';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'evaluation-' + question.questionId;
    input.value = String(item.value);
    input.required = question.required;
    const number = document.createElement('strong');
    number.textContent = item.value;
    const text = document.createElement('span');
    text.textContent = item.label;
    input.addEventListener('change', () => {
      options.querySelectorAll('.rating-option').forEach(option => {
        option.classList.toggle('is-selected', option.contains(input) && input.checked);
      });
    });
    label.append(input, number, text);
    options.appendChild(label);
  });
  fieldset.appendChild(options);
  return fieldset;
}

function createTextQuestion(question) {
  const wrapper = document.createElement('label');
  wrapper.className = 'evaluation-question evaluation-question--text field';
  wrapper.dataset.evalQuestion = question.questionId;
  wrapper.dataset.type = 'TEXT';
  const title = document.createElement('span');
  title.textContent = question.questionText;
  const textarea = document.createElement('textarea');
  textarea.rows = 4;
  textarea.maxLength = 2000;
  textarea.required = question.required;
  textarea.placeholder = 'พิมพ์ความคิดเห็นของท่าน';
  wrapper.append(title, textarea);
  return wrapper;
}

async function submitEvaluationForm(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const answers = Array.from(form.querySelectorAll('[data-eval-question]')).map(element => {
    const type = element.dataset.type;
    const questionId = element.dataset.evalQuestion;
    if (type === 'RATING') {
      const checked = element.querySelector('input[type="radio"]:checked');
      return { questionId: questionId, ratingValue: checked ? Number(checked.value) : null };
    }
    return { questionId: questionId, responseText: element.querySelector('textarea').value };
  });

  const confirmed = await confirmAction('ยืนยันส่งแบบประเมิน', 'หลังส่งแล้วจะไม่สามารถแก้ไขแบบประเมินนี้ได้');
  if (!confirmed) return;

  setLoading(true, 'กำลังบันทึกแบบประเมิน...');
  setButtonBusy('evaluationSubmitButton', true, 'กำลังบันทึก...');
  try {
    const response = await runServer('submitEvaluation', Object.assign({}, AppState.session, { answers: answers }));
    markEvaluationComplete(response.summary);
    showToast(response.message || 'บันทึกแบบประเมินเรียบร้อยแล้ว', response.ok ? 'success' : 'info');
  } catch (error) {
    handleError(error, 'ไม่สามารถส่งแบบประเมินได้');
  } finally {
    setButtonBusy('evaluationSubmitButton', false, 'ส่งแบบประเมิน');
    setLoading(false);
  }
}

function markEvaluationComplete(summary) {
  if (!AppState.lastResult) AppState.lastResult = { mode: 'POST' };
  AppState.lastResult.evaluationCompleted = true;
  AppState.lastResult.evaluationSummary = summary || null;
  renderResult(AppState.lastResult);
  navigateTo('result');
}

// ================================
// CERTIFICATE
// ================================

async function openCertificatePage(updateHistory = true) {
  if (!AppState.session) {
    navigateTo('registration', updateHistory);
    showToast('กรุณาลงทะเบียนก่อน', 'warning');
    return;
  }
  navigateTo('certificate', updateHistory);
  setLoading(true, 'กำลังตรวจสอบ Certificate...');
  try {
    const response = await runServer('getParticipantCertificate', AppState.session);
    renderCertificate(response.certificate, response.eligibility, response.participant);
  } catch (error) {
    handleError(error, 'ไม่สามารถโหลด Certificate ได้');
  } finally { setLoading(false); }
}

async function generateCertificate() {
  const confirmed = await confirmAction('ยืนยันออก Certificate', 'ระบบจะสร้าง Google Slides และไฟล์ PDF พร้อม QR สำหรับตรวจสอบ');
  if (!confirmed) return;
  setLoading(true, 'กำลังสร้าง Certificate PDF...');
  setButtonBusy('generateCertificateButton', true, 'กำลังสร้าง PDF...');
  try {
    const response = await runServer('issueCertificate', AppState.session);
    renderCertificate(response.certificate, { eligible: true, message: 'ออก Certificate แล้ว' }, response.participant);
    showToast(response.message, response.certificate.warning ? 'warning' : 'success', 6500);
  } catch (error) { handleError(error, 'ไม่สามารถออก Certificate ได้'); }
  finally {
    setButtonBusy('generateCertificateButton', false, 'สร้าง Certificate PDF');
    setLoading(false);
  }
}

function renderCertificate(certificate, eligibility, participant) {
  const preview = document.getElementById('certificatePreview');
  const generateButton = document.getElementById('generateCertificateButton');
  const downloadButton = document.getElementById('downloadCertificateButton');
  const shareButton = document.getElementById('shareCertificateButton');
  const verifyLink = document.getElementById('verifyCertificateLink');
  const warning = document.getElementById('certificateWarning');
  setText('certificateStatusText', certificate ? 'Certificate พร้อมดาวน์โหลดและตรวจสอบ' : (eligibility && eligibility.message) || 'ยังไม่พบ Certificate');
  if (!certificate) {
    preview.hidden = true; downloadButton.hidden = true; shareButton.hidden = true; verifyLink.hidden = true;
    generateButton.hidden = !(eligibility && eligibility.eligible);
    warning.hidden = true;
    return;
  }
  preview.hidden = false; generateButton.hidden = true;
  setText('certificateOrganization', AppState.config && AppState.config.organization || '');
  const currentParticipant = participant || (AppState.lastResult && AppState.lastResult.participant);
  setText('certificateParticipantName', currentParticipant ? currentParticipant.displayName : 'ผู้ผ่านการอบรม');
  setText('certificateCourseName', AppState.config && AppState.config.course ? AppState.config.course.title : '');
  setText('certificateResultLevel', certificate.resultLevel || '—');
  setText('certificateNumber', 'เลขที่ ' + certificate.certNumber);
  setText('certificateIssueDate', formatThaiDate(certificate.issueDate));
  downloadButton.href = certificate.pdfUrl || '#'; downloadButton.hidden = !certificate.pdfUrl;
  shareButton.hidden = !certificate.verificationUrl; shareButton.dataset.shareUrl = certificate.verificationUrl || '';
  verifyLink.href = certificate.verificationUrl || '#'; verifyLink.hidden = !certificate.verificationUrl;
  warning.textContent = certificate.warning || ''; warning.hidden = !certificate.warning;
}

async function shareCertificate() {
  const url = document.getElementById('shareCertificateButton').dataset.shareUrl || '';
  if (!url) return;
  try {
    if (navigator.share) await navigator.share({ title: 'ตรวจสอบ Certificate', url: url });
    else { await navigator.clipboard.writeText(url); showToast('คัดลอกลิงก์ตรวจสอบแล้ว', 'success'); }
  } catch (error) {
    if (error.name !== 'AbortError') showToast('ไม่สามารถแชร์ลิงก์ได้ กรุณาเปิดลิงก์ตรวจสอบแล้วคัดลอก URL', 'warning');
  }
}

async function verifyPublicCertificate() {
  const card = document.getElementById('verifyCard');
  const token = AppState.certificateToken || new URL(window.location.href).searchParams.get('token') || '';
  try {
    const response = await runServer('verifyCertificate', { token: token });
    card.classList.remove('is-valid', 'is-revoked', 'is-invalid');
    const stateClass = response.status === 'VALID' ? 'is-valid' : response.status === 'REVOKED' ? 'is-revoked' : 'is-invalid';
    card.classList.add(stateClass);
    setText('verifyIcon', response.status === 'VALID' ? '✓' : response.status === 'REVOKED' ? '!' : '×');
    setText('verifyHeading', response.status === 'VALID' ? 'Certificate ถูกต้อง' : response.status === 'REVOKED' ? 'Certificate ถูกเพิกถอน' : 'ไม่พบ Certificate');
    setText('verifyMessage', response.message || '');
    const details = document.getElementById('verifyDetails');
    details.hidden = !response.found;
    if (response.found) {
      const item = response.certificate;
      setText('verifyCertNumber', item.certNumber); setText('verifyParticipantName', item.participantName);
      setText('verifyCourseName', item.courseName); setText('verifyIssueDate', formatThaiDate(item.issueDate));
      setText('verifyResultLevel', item.resultLevel); setText('verifyStatus', item.status === 'VALID' ? 'ถูกต้อง / มีผล' : 'เพิกถอน');
    }
  } catch (error) { card.classList.add('is-invalid'); handleError(error, 'ตรวจสอบ Certificate ไม่สำเร็จ'); }
}


// ================================
// UI HELPERS
// ================================

function bindGlobalEvents() {
  document.getElementById('refreshButton')?.addEventListener('click', loadAppConfig);
  document.getElementById('startButton')?.addEventListener('click', () => navigateTo('registration'));
  document.getElementById('continueButton')?.addEventListener('click', resumeParticipant);
  document.getElementById('findRegistrationButton')?.addEventListener('click', () => navigateTo('resume'));
  document.getElementById('participantLookupForm')?.addEventListener('submit', findParticipantRegistrationsClient);
  document.getElementById('participantResumeForm')?.addEventListener('submit', resumeParticipantRegistrationClient);
  document.getElementById('registrationForm')?.addEventListener('submit', submitRegistration);
  document.getElementById('registrationMoo')?.addEventListener('change', loadRosterCommunities);
  document.getElementById('registrationCommunity')?.addEventListener('change', loadRosterNames);
  document.getElementById('registrationPhone')?.addEventListener('input', resetRosterVerification);
  document.getElementById('verifyRosterButton')?.addEventListener('click', verifyRosterIdentityClient);
  document.getElementById('openRosterRequestButton')?.addEventListener('click', () => toggleRosterRequestForm(true));
  document.getElementById('cancelRosterRequestButton')?.addEventListener('click', () => toggleRosterRequestForm(false));
  document.getElementById('rosterRequestForm')?.addEventListener('submit', submitRosterRequestClient);
  document.getElementById('startPostButton')?.addEventListener('click', () => startTest('POST'));
  document.getElementById('evaluationButton')?.addEventListener('click', startEvaluation);
  document.getElementById('evaluationForm')?.addEventListener('submit', submitEvaluationForm);
  document.getElementById('certificateButton')?.addEventListener('click', () => openCertificatePage(true));
  document.getElementById('generateCertificateButton')?.addEventListener('click', generateCertificate);
  document.getElementById('shareCertificateButton')?.addEventListener('click', shareCertificate);

  document.getElementById('prePreviousButton')?.addEventListener('click', () => moveQuestion('PRE', -1));
  document.getElementById('preNextButton')?.addEventListener('click', () => moveQuestion('PRE', 1));
  document.getElementById('preSubmitButton')?.addEventListener('click', () => submitTest('PRE'));
  document.getElementById('postPreviousButton')?.addEventListener('click', () => moveQuestion('POST', -1));
  document.getElementById('postNextButton')?.addEventListener('click', () => moveQuestion('POST', 1));
  document.getElementById('postSubmitButton')?.addEventListener('click', () => submitTest('POST'));

  document.addEventListener('click', event => {
    const navigateButton = event.target.closest('[data-navigate]');
    if (navigateButton) navigateTo(navigateButton.dataset.navigate);
    if (event.target.closest('[data-close-modal]')) closeModal(false);
  });

  window.addEventListener('popstate', event => {
    navigateTo((event.state && event.state.route) || 'home', false);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeModal(false);
  });
}

function setLoading(isLoading, message) {
  const overlay = document.getElementById('loadingOverlay');
  if (!overlay) return;
  AppState.loadingCount = Math.max(0, AppState.loadingCount + (isLoading ? 1 : -1));
  const visible = AppState.loadingCount > 0;
  overlay.classList.toggle('is-visible', visible);
  overlay.setAttribute('aria-hidden', String(!visible));
  if (message) setText('loadingText', message);
}

function setButtonBusy(id, busy, busyText) {
  const button = document.getElementById(id);
  if (!button) return;
  if (busy) {
    button.dataset.originalText = button.textContent;
    button.textContent = busyText;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.originalText || busyText;
    button.disabled = false;
  }
}

function setSystemStatus(type, message) {
  const element = document.getElementById('systemStatus');
  if (!element) return;
  element.className = 'header-status header-status--' + type;
  element.innerHTML = '<span class="status-dot" aria-hidden="true"></span><span></span>';
  element.lastElementChild.textContent = message;
}

function showToast(message, type = 'info', timeout = 4500) {
  const region = document.getElementById('toastRegion');
  if (!region) return;
  const toast = document.createElement('div');
  toast.className = 'toast toast--' + type;
  toast.setAttribute('role', type === 'danger' ? 'alert' : 'status');
  toast.textContent = message;
  region.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('is-visible'));
  window.setTimeout(() => {
    toast.classList.remove('is-visible');
    window.setTimeout(() => toast.remove(), 250);
  }, timeout);
}

function confirmAction(title, message) {
  const modal = document.getElementById('appModal');
  setText('modalTitle', title);
  const body = document.getElementById('modalBody');
  body.innerHTML = '';
  const paragraph = document.createElement('p');
  paragraph.textContent = message;
  const actions = document.createElement('div');
  actions.className = 'modal__actions';
  const cancel = document.createElement('button');
  cancel.type = 'button'; cancel.className = 'button button--ghost'; cancel.textContent = 'ตรวจคำตอบอีกครั้ง';
  const confirm = document.createElement('button');
  confirm.type = 'button'; confirm.className = 'button button--success'; confirm.textContent = 'ยืนยันส่งคำตอบ';
  actions.append(cancel, confirm); body.append(paragraph, actions);
  modal.hidden = false;
  document.body.classList.add('has-modal');

  return new Promise(resolve => {
    AppState.modalResolver = resolve;
    cancel.addEventListener('click', () => closeModal(false), { once: true });
    confirm.addEventListener('click', () => closeModal(true), { once: true });
    confirm.focus();
  });
}

function closeModal(result) {
  const modal = document.getElementById('appModal');
  if (!modal || modal.hidden) return;
  modal.hidden = true;
  document.body.classList.remove('has-modal');
  if (AppState.modalResolver) {
    const resolver = AppState.modalResolver;
    AppState.modalResolver = null;
    resolver(Boolean(result));
  }
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value == null ? '' : String(value);
}

function formatThaiDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('th-TH', {
    dateStyle: 'long', timeStyle: 'short', timeZone: 'Asia/Bangkok'
  }).format(date);
}

function formatTrainingDateRange(startValue, endValue) {
  if (!startValue) return '—';
  const formatter = new Intl.DateTimeFormat('th-TH', { dateStyle: 'long', timeZone: 'Asia/Bangkok' });
  const start = new Date(startValue);
  const end = endValue ? new Date(endValue) : null;
  if (Number.isNaN(start.getTime())) return String(startValue);
  const startText = formatter.format(start);
  if (!end || Number.isNaN(end.getTime()) || startText === formatter.format(end)) return startText;
  return startText + ' – ' + formatter.format(end);
}

function toDateInputValue(value) {
  const match = String(value || '').match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : '';
}

// ================================
// ERROR HANDLING
// ================================

function handleError(error, fallbackMessage) {
  console.error(error);
  const message = error && error.message ? error.message : fallbackMessage;
  showToast(message || 'เกิดข้อผิดพลาด กรุณาลองใหม่', 'danger', 6500);
}
