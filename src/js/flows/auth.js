let authConfig = {
  itContact: 'IT Support: 02-000-0000',
  itLine: '@watermotion-it'
};

async function loadAuthConfig() {
  try {
    const response = await fetch('/api/auth-config', { cache: 'no-store' });
    if (!response.ok) return;
    authConfig = { ...authConfig, ...(await response.json()) };
  } catch (error) {
    console.warn('Auth config unavailable', error);
  }
}

async function initAuthUI() {
  await loadAuthConfig();
}

function setLoginMessage(message = '', type = 'error') {
  const box = document.getElementById('login-error');
  if (!box) return;
  box.textContent = message;
  box.classList.toggle('hidden', !message);
  box.classList.toggle('login-msg-success', type === 'success');
}

function updateLoggedInUser(user, token) {
  S.user = user;
  const session = { user };
  if (token) session.token = token;
  else {
    try {
      const existing = JSON.parse(localStorage.getItem('wm-session') || '{}');
      if (existing.token) session.token = existing.token;
    } catch { /* ignore */ }
  }
  localStorage.setItem('wm-session', JSON.stringify(session));
  const nameEl = document.querySelector('.dash-user-name');
  const roleEl = document.querySelector('.dash-user-role');
  const avatar = document.querySelector('.dash-avatar');
  if (nameEl) nameEl.textContent = user.name || user.username;
  if (roleEl) roleEl.textContent = user.role || 'Field Specialist';
  if (avatar) avatar.textContent = (user.name || user.username || 'U').trim().charAt(0).toUpperCase();
}

async function doLogin() {
  const username = document.getElementById('l-user')?.value.trim();
  const password = document.getElementById('l-pass')?.value || '';

  if (!username || !password) {
    setLoginMessage('Enter username and password');
    return;
  }

  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ username, password })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Username or password is incorrect');

    setLoginMessage('');
    updateLoggedInUser(data.user, data.token);
    goScreen('s-dash');
  } catch (error) {
    setLoginMessage(error.message || 'Could not sign in');
    document.getElementById('l-pass')?.focus();
  }
}

async function forgotPassword() {
  await loadAuthConfig();
  const contact = [authConfig.itContact, authConfig.itLine ? `LINE: ${authConfig.itLine}` : '']
    .filter(Boolean)
    .join(' · ');
  setLoginMessage('');
  showToast(contact || t('login.forgotIt'));
}

async function restoreLoginSession() {
  try {
    const raw = localStorage.getItem('wm-session');
    if (!raw) return false;
    const session = JSON.parse(raw);
    if (!session.user) return false;
    // Sessions created before server tokens need a fresh sign-in for Drive uploads.
    if (!session.token) {
      localStorage.removeItem('wm-session');
      return false;
    }
    updateLoggedInUser(session.user, session.token);
    goScreen('s-dash');
    return true;
  } catch {
    return false;
  }
}

function getAppSessionToken() {
  try {
    const session = JSON.parse(localStorage.getItem('wm-session') || '{}');
    return session.token || '';
  } catch {
    return '';
  }
}

function getAppAuthHeaders() {
  const token = getAppSessionToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function clearAppSession() {
  localStorage.removeItem('wm-session');
  S.user = null;
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store'
    });
  } catch {
    /* ignore */
  }
}
