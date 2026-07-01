const BANK_ACCOUNT = '986-4-89945-7';

function appAssetPath(assetPath) {
  const pathName = window.location.pathname;
  const appBase = pathName.endsWith('/')
    ? pathName
    : pathName.includes('.')
      ? pathName.slice(0, pathName.lastIndexOf('/') + 1)
      : '/';
  return `${appBase}${assetPath}`;
}

function updatePaymentScreen() {
  const screen = document.getElementById('s-payment');
  if (!screen) {
    console.error('Payment screen markup missing (#s-payment not found)');
    return;
  }

  const isFull = S.pkg === 'full';
  const cashAmount = isFull ? '฿5,000' : '฿0';

  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };

  setText('pm-cash-amt', cashAmount);

  if (typeof updatePayToggle === 'function') updatePayToggle();
  selPayMethod(S.payMethod || 'cash');

  const slipSub = document.getElementById('slip-sub');
  if (slipSub && !S.paymentSlipPhoto) slipSub.textContent = t('pay.uploadSub');

  const logo = document.getElementById('ktb-logo');
  if (logo) logo.src = appAssetPath('src/assets/ktb-logo.png?v=4');
}

function selPayMethod(m) {
  S.payMethod = m;
  document.getElementById('pm-cash')?.classList.toggle('sel', m === 'cash');
  document.getElementById('pm-bank')?.classList.toggle('sel', m === 'bank');
}

async function copyBankAccount() {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(BANK_ACCOUNT);
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = BANK_ACCOUNT;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
    }
    showToast('Account number copied');
  } catch {
    showToast(BANK_ACCOUNT);
  }
}

function completePayment() {
  S.stepsDone.payment = true;
  saveActiveJobState();
  renderJobSteps();
  goScreen('s-job');
}
