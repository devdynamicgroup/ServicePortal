const AUTH_SESSION_KEY = 'wm-session';
const DEMO_USERS_KEY = 'wm-demo-users';
const DEMO_USER = { email: 'kittichai@watermotion.local', password: 'password', name: 'Kittichai T.' };

const Auth = {
  config: null,
  configLoaded: false,
  recoveryToken: null
};

async function loadAuthConfig() {
  if (Auth.configLoaded) return Auth.config;
  try {
    const res = await fetch('/api/auth-config', { cache: 'no-store' });
    if (!res.ok) throw new Error('config unavailable');
    Auth.config = await res.json();
  } catch {
    Auth.config = { provider: 'demo', supabaseUrl: '', supabaseAnonKey: '', redirectUrl: '' };
  }
  Auth.configLoaded = true;
  return Auth.config;
}

function authEnabled() {
  return !!(Auth.config?.supabaseUrl && Auth.config?.supabaseAnonKey);
}

function redirectUrl() {
  if (Auth.config?.redirectUrl) return Auth.config.redirectUrl;
  return `${window.location.origin}${window.location.pathname}`;
}

function supabaseHeaders(extra = {}) {
  return {
    apikey: Auth.config.supabaseAnonKey,
    'Content-Type': 'application/json',
    ...extra
  };
}

function parseAuthHash() {
  const hash = window.location.hash?.replace(/^#/, '');
  if (!hash) return null;
  const params = new URLSearchParams(hash);
  const type = params.get('type');
  const accessToken = params.get('access_token');
  if (type === 'recovery' && accessToken) {
    Auth.recoveryToken = accessToken;
    return { type, accessToken };
  }
  if (accessToken && params.get('refresh_token')) {
    return {
      type: type || 'signin',
      accessToken,
      refreshToken: params.get('refresh_token'),
      expiresIn: Number(params.get('expires_in') || 3600)
    };
  }
  return null;
}

function clearAuthHash() {
  if (window.location.hash) {
    history.replaceState(null, '', window.location.pathname + window.location.search);
  }
}

function saveSession(session) {
  localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session));
}

function getSession() {
  try {
    const raw = localStorage.getItem(AUTH_SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function sessionValid(session) {
  if (!session?.user) return false;
  if (session.provider === 'demo') return true;
  if (!session.expiresAt) return !!session.accessToken;
  return Date.now() < session.expiresAt - 30000;
}

function setLoginError(msg) {
  const el = document.getElementById('login-error');
  if (!el) return;
  if (msg) {
    el.textContent = msg;
    el.classList.remove('hidden');
  } else {
    el.textContent = '';
    el.classList.add('hidden');
  }
}

function setLoginLoading(loading) {
  document.querySelectorAll('.login-panel:not(.hidden) .btn-login, .login-panel:not(.hidden) .btn-login-alt').forEach(btn => {
    btn.disabled = loading;
    btn.classList.toggle('is-loading', loading);
  });
}

function showLoginPanel(name) {
  document.querySelectorAll('.login-panel').forEach(panel => {
    panel.classList.toggle('hidden', panel.dataset.panel !== name);
  });
  const pill = document.getElementById('login-signup-pill');
  const subtitle = document.getElementById('login-subtitle');
  if (pill) pill.classList.toggle('hidden', name !== 'signin');
  if (subtitle) {
    const key = name === 'signup' ? 'login.signupSub' : 'login.subtitle';
    subtitle.dataset.i18n = key;
    subtitle.textContent = t(key);
  }
  setLoginError('');
}

function showSignupPanel() {
  const email = document.getElementById('l-user')?.value?.trim();
  const regEmail = document.getElementById('l-reg-email');
  if (regEmail && email?.includes('@')) regEmail.value = email;
  showLoginPanel('signup');
}

function showSignInPanel() {
  showLoginPanel('signin');
}

async function supabaseRequest(path, options = {}) {
  const url = `${Auth.config.supabaseUrl.replace(/\/$/, '')}${path}`;
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.msg || data?.error_description || data?.message || data?.error || 'Request failed';
    throw new Error(msg);
  }
  return data;
}

async function supabaseSignIn(email, password) {
  const data = await supabaseRequest('/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: supabaseHeaders(),
    body: JSON.stringify({ email, password })
  });
  return {
    provider: 'supabase',
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
    user: {
      id: data.user?.id,
      email: data.user?.email || email,
      name: data.user?.user_metadata?.full_name || data.user?.email?.split('@')[0] || email
    }
  };
}

async function supabaseSendRecovery(email) {
  await supabaseRequest('/auth/v1/recover', {
    method: 'POST',
    headers: supabaseHeaders(),
    body: JSON.stringify({ email, redirect_to: redirectUrl() })
  });
}

async function supabaseUpdatePassword(accessToken, password) {
  await supabaseRequest('/auth/v1/user', {
    method: 'PUT',
    headers: supabaseHeaders({ Authorization: `Bearer ${accessToken}` }),
    body: JSON.stringify({ password })
  });
}

function getDemoUsers() {
  try {
    const raw = localStorage.getItem(DEMO_USERS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function findDemoAccount(email) {
  const users = getDemoUsers();
  if (users[email]) return users[email];
  if (email === DEMO_USER.email) return { password: DEMO_USER.password, name: DEMO_USER.name };
  return null;
}

function saveDemoUser(email, password, name) {
  if (email === DEMO_USER.email || findDemoAccount(email)) throw new Error(t('login.errEmailTaken'));
  const users = getDemoUsers();
  users[email] = { password, name };
  localStorage.setItem(DEMO_USERS_KEY, JSON.stringify(users));
}

function demoSignIn(username, password) {
  const email = username.includes('@') ? username.toLowerCase() : `${username}@watermotion.local`;
  const account = findDemoAccount(email);
  const legacyOk = username === 'kittichai' && password === DEMO_USER.password;
  if (!account && !legacyOk) throw new Error(t('login.errSignIn'));
  const passOk = account ? account.password === password : legacyOk;
  if (!passOk) throw new Error(t('login.errSignIn'));
  const name = account?.name || DEMO_USER.name;
  return {
    provider: 'demo',
    accessToken: 'demo-token',
    user: { id: 'demo', email, name }
  };
}

function demoSignUp(email, password, name) {
  const normalised = email.toLowerCase().trim();
  saveDemoUser(normalised, password, name.trim());
  return {
    provider: 'demo',
    accessToken: 'demo-token',
    user: { id: `demo-${normalised}`, email: normalised, name: name.trim() }
  };
}

async function supabaseSignUp(email, password, fullName) {
  const data = await supabaseRequest('/auth/v1/signup', {
    method: 'POST',
    headers: supabaseHeaders(),
    body: JSON.stringify({
      email,
      password,
      data: { full_name: fullName }
    })
  });
  if (data.access_token) {
    return {
      provider: 'supabase',
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
      user: {
        id: data.user?.id,
        email: data.user?.email || email,
        name: fullName || data.user?.email?.split('@')[0] || email
      }
    };
  }
  return { needsConfirmation: true, email };
}

function enterApp(session) {
  saveSession(session);
  S.activeJob = null;
  if (typeof renderCalendar === 'function') renderCalendar();
  goScreen('s-dash');
  showToast(S.lang === 'th' ? `ยินดีต้อนรับ ${session.user.name}` : `Welcome, ${session.user.name}`);
}

async function doSignUp() {
  setLoginError('');
  const name = document.getElementById('l-reg-name')?.value?.trim();
  const email = document.getElementById('l-reg-email')?.value?.trim().toLowerCase();
  const pass = document.getElementById('l-reg-pass')?.value || '';
  const confirm = document.getElementById('l-reg-pass-confirm')?.value || '';

  if (!name) {
    setLoginError(t('login.errName'));
    return;
  }
  if (!email || !email.includes('@')) {
    setLoginError(t('login.errEmail'));
    return;
  }
  if (pass.length < 8) {
    setLoginError(t('login.errPassShort'));
    return;
  }
  if (pass !== confirm) {
    setLoginError(t('login.errPassMatch'));
    return;
  }

  setLoginLoading(true);
  try {
    await loadAuthConfig();
    if (authEnabled()) {
      const result = await supabaseSignUp(email, pass, name);
      if (result.needsConfirmation) {
        showToast(t('login.signupConfirm'));
        showSignInPanel();
        document.getElementById('l-user').value = email;
        return;
      }
      enterApp(result);
      showToast(t('login.signupDone'));
      return;
    }
    const session = demoSignUp(email, pass, name);
    enterApp(session);
    showToast(t('login.demoSignup'));
  } catch (error) {
    const msg = (error.message || '').toLowerCase();
    if (msg.includes('already') || msg.includes('registered') || msg.includes('exists')) {
      setLoginError(t('login.errEmailTaken'));
    } else {
      setLoginError(error.message || t('login.errSignup'));
    }
  } finally {
    setLoginLoading(false);
  }
}

function showForgotPanel() {
  const email = document.getElementById('l-user')?.value?.trim();
  const forgotEmail = document.getElementById('l-forgot-email');
  if (forgotEmail && email) forgotEmail.value = email.includes('@') ? email : '';
  showLoginPanel('forgot');
}

async function doLogin() {
  setLoginError('');
  const username = document.getElementById('l-user')?.value?.trim();
  const password = document.getElementById('l-pass')?.value || '';
  if (!username || !password) {
    setLoginError(t('login.errRequired'));
    return;
  }

  setLoginLoading(true);
  try {
    await loadAuthConfig();
    if (authEnabled() && !username.includes('@')) {
      setLoginError(t('login.errEmail'));
      return;
    }
    const session = authEnabled()
      ? await supabaseSignIn(username, password)
      : demoSignIn(username, password);
    enterApp(session);
  } catch (error) {
    setLoginError(error.message || t('login.errSignIn'));
  } finally {
    setLoginLoading(false);
  }
}

async function requestPasswordReset() {
  setLoginError('');
  const email = document.getElementById('l-forgot-email')?.value?.trim();
  if (!email || !email.includes('@')) {
    setLoginError(t('login.errEmail'));
    return;
  }

  setLoginLoading(true);
  try {
    await loadAuthConfig();
    if (!authEnabled()) {
      showToast(t('login.demoReset'));
      showSignInPanel();
      return;
    }
    await supabaseSendRecovery(email);
    showToast(t('login.resetSent'));
    showSignInPanel();
  } catch (error) {
    setLoginError(error.message || t('login.errReset'));
  } finally {
    setLoginLoading(false);
  }
}

async function confirmPasswordReset() {
  setLoginError('');
  const pass = document.getElementById('l-new-pass')?.value || '';
  const confirm = document.getElementById('l-new-pass-confirm')?.value || '';
  if (pass.length < 8) {
    setLoginError(t('login.errPassShort'));
    return;
  }
  if (pass !== confirm) {
    setLoginError(t('login.errPassMatch'));
    return;
  }
  if (!Auth.recoveryToken) {
    setLoginError(t('login.errRecoveryExpired'));
    showSignInPanel();
    return;
  }

  setLoginLoading(true);
  try {
    await loadAuthConfig();
    await supabaseUpdatePassword(Auth.recoveryToken, pass);
    Auth.recoveryToken = null;
    clearAuthHash();
    showToast(t('login.resetDone'));
    showSignInPanel();
    document.getElementById('l-pass').value = pass;
  } catch (error) {
    setLoginError(error.message || t('login.errReset'));
  } finally {
    setLoginLoading(false);
  }
}

function restoreLoginSession() {
  if (Auth.recoveryToken) return;
  const session = getSession();
  if (!sessionValid(session)) {
    localStorage.removeItem(AUTH_SESSION_KEY);
    return;
  }
  if (S.screen === 's-login') {
    goScreen('s-dash');
    if (typeof renderCalendar === 'function') renderCalendar();
  }
}

function updateLoginModeHint() {
  const hint = document.getElementById('login-mode-hint');
  const badge = document.getElementById('login-auth-badge');
  if (hint) {
    if (authEnabled()) hint.classList.add('hidden');
    else hint.classList.remove('hidden');
  }
  if (badge) badge.classList.toggle('hidden', !authEnabled());
}

async function initAuthUI() {
  await loadAuthConfig();
  updateLoginModeHint();
  const hash = parseAuthHash();
  if (hash?.type === 'recovery') {
    goScreen('s-login');
    showLoginPanel('reset');
    return;
  }
  if (hash?.accessToken && hash.type !== 'recovery') {
    saveSession({
      provider: 'supabase',
      accessToken: hash.accessToken,
      refreshToken: hash.refreshToken,
      expiresAt: Date.now() + (hash.expiresIn || 3600) * 1000,
      user: { email: '', name: 'User' }
    });
    clearAuthHash();
  }
}

document.addEventListener('keydown', e => {
  if (e.key !== 'Enter' || S.screen !== 's-login') return;
  const panel = document.querySelector('.login-panel:not(.hidden)')?.dataset?.panel;
  if (panel === 'signin') doLogin();
  if (panel === 'signup') doSignUp();
  if (panel === 'forgot') requestPasswordReset();
  if (panel === 'reset') confirmPasswordReset();
});
