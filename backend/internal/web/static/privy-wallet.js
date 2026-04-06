// ═══════════════════════════════════════════════════════════
//  GigaWork Privy Integration
//  Email login via Privy REST API (server-side proxy).
//  No client-side SDK needed — auth handled by backend.
//  On-chain tx uses MetaMask/OKX if available, otherwise
//  platform balance flow (0 wallet confirmations).
// ═══════════════════════════════════════════════════════════

function initPrivy() {
    const hasConfig = window.PRIVY_APP_ID && window.PRIVY_CLIENT_ID;
    console.log('[Privy] Email login:', hasConfig ? 'enabled' : 'disabled (no config)');
}

// ─── Email Login (REST API approach) ─────────────────────
// Privy js-sdk-core requires bundler. For server-rendered HTML,
// we use Privy REST API via our backend as proxy.

async function sendEmailOTP(email) {
    const res = await fetch('/api/auth/privy-send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to send code');
    }
    return await res.json();
}

async function verifyEmailOTP(email, code) {
    const res = await fetch('/api/auth/privy-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code })
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Verification failed');
    }
    const data = await res.json();

    // data: { address, privy_user_id, wallet_source, email, is_agent }
    walletState.address = data.address;
    walletState.connected = true;
    walletState.walletType = 'privy';
    walletState.privyLoggedIn = true;
    walletState.email = data.email || email;
    walletState.balance = '-.--';

    localStorage.setItem('gigawork_address', data.address);
    localStorage.setItem('gigawork_auth_type', 'privy');
    localStorage.setItem('gigawork_email', walletState.email);

    updateWalletUI();

    const bal = await fetchPlatformBalance();
    const balEl = document.getElementById('wallet-usdc-balance');
    if (balEl) balEl.textContent = (bal || 0).toFixed(2) + ' USDC';

    // Show wallet connect prompt if no MetaMask/OKX detected
    if (!walletState.signer) {
        showWalletConnectBanner();
    }

    return data;
}

// ─── Wallet connect banner (after Privy email login) ─────

function showWalletConnectBanner() {
    // Don't show if already dismissed or wallet connected
    if (walletState.signer || localStorage.getItem('gigawork_banner_dismissed')) return;

    let banner = document.getElementById('wallet-connect-banner');
    if (banner) { banner.style.display = 'flex'; return; }

    banner = document.createElement('div');
    banner.id = 'wallet-connect-banner';
    banner.className = 'fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-3 bg-surface-variant border border-cyan-400/20 rounded-2xl shadow-2xl max-w-lg';
    banner.innerHTML = `
        <span class="material-symbols-outlined text-cyan-400">account_balance_wallet</span>
        <span class="text-xs text-on-surface-variant flex-1">Connect a wallet to sign on-chain transactions, or use <b class="text-white">platform balance</b> for zero-click runs.</span>
        <button onclick="connectWalletFromBanner()" class="px-3 py-1.5 bg-gradient-to-r from-primary-container to-cyan-400 text-on-primary text-[10px] font-bold rounded-lg shrink-0">Connect Wallet</button>
        <button onclick="dismissWalletBanner()" class="text-on-surface-variant hover:text-white"><span class="material-symbols-outlined text-sm">close</span></button>
    `;
    document.body.appendChild(banner);
}

async function connectWalletFromBanner() {
    const banner = document.getElementById('wallet-connect-banner');
    try {
        await connectWallet(); // wallet.js function — opens MetaMask/OKX
        if (walletState.signer) {
            if (banner) banner.style.display = 'none';
        }
    } catch (e) {
        console.log('[Privy] Wallet connect from banner failed:', e.message);
    }
}

function dismissWalletBanner() {
    const banner = document.getElementById('wallet-connect-banner');
    if (banner) banner.style.display = 'none';
    localStorage.setItem('gigawork_banner_dismissed', '1');
}

// ─── Login modal controls ────────────────────────────────

function showLoginModal() {
    document.getElementById('login-modal').style.display = 'flex';
    document.getElementById('login-email-step').style.display = 'block';
    document.getElementById('login-otp-step').style.display = 'none';
    document.getElementById('login-status').style.display = 'none';
}

function hideLoginModal() {
    document.getElementById('login-modal').style.display = 'none';
}

async function handleEmailSubmit() {
    const email = document.getElementById('login-email-input').value.trim();
    if (!email || !email.includes('@')) {
        showLoginStatus('Please enter a valid email', true);
        return;
    }

    const btn = document.getElementById('login-email-btn');
    btn.disabled = true;
    btn.textContent = 'Sending code...';

    try {
        await sendEmailOTP(email);
        // Show OTP step
        document.getElementById('login-email-step').style.display = 'none';
        document.getElementById('login-otp-step').style.display = 'block';
        document.getElementById('login-otp-email').textContent = email;
        document.getElementById('login-otp-input').focus();
        showLoginStatus('Code sent to ' + email, false);
    } catch (e) {
        showLoginStatus(e.message, true);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Send Code';
    }
}

async function handleOTPSubmit() {
    const email = document.getElementById('login-otp-email').textContent;
    const code = document.getElementById('login-otp-input').value.trim();
    if (!code || code.length < 4) {
        showLoginStatus('Enter the code from your email', true);
        return;
    }

    const btn = document.getElementById('login-otp-btn');
    btn.disabled = true;
    btn.textContent = 'Verifying...';

    try {
        const data = await verifyEmailOTP(email, code);
        showLoginStatus('Logged in! Wallet: ' + shortAddr(data.address), false);
        setTimeout(hideLoginModal, 1500);
    } catch (e) {
        showLoginStatus(e.message, true);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Verify & Login';
    }
}

async function handleMetaMaskLogin() {
    hideLoginModal();
    await connectWallet(); // existing wallet.js function
}

function showLoginStatus(msg, isError) {
    const el = document.getElementById('login-status');
    el.style.display = 'block';
    el.className = 'text-xs font-bold p-2 rounded-lg mt-2 ' +
        (isError ? 'bg-red-500/10 text-red-400' : 'bg-cyan-400/10 text-cyan-400');
    el.textContent = msg;
}

// ─── Init on page load ───────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
    initPrivy();

    // Restore Privy session state
    const authType = localStorage.getItem('gigawork_auth_type');
    if (authType === 'privy' && walletState.address) {
        walletState.walletType = 'privy';
        walletState.privyLoggedIn = true;
        walletState.connected = true;
        walletState.email = localStorage.getItem('gigawork_email') || '';
        console.log('[Privy] Session restored:', shortAddr(walletState.address), walletState.email);

        // Try to get a provider for on-chain tx (MetaMask/OKX if available)
        const extProvider = window.okxwallet || window.ethereum;
        if (extProvider && !walletState.rawProvider) {
            try {
                const accounts = await extProvider.request({ method: 'eth_accounts' });
                if (accounts.length > 0) {
                    walletState.rawProvider = extProvider;
                    walletState.provider = new ethers.BrowserProvider(extProvider);
                    walletState.signer = await walletState.provider.getSigner();
                    console.log('[Privy] External wallet connected for on-chain tx');
                }
            } catch (e) { /* no external wallet */ }
        }

        updateWalletUI();
        fetchPlatformBalance();

        // Show wallet connect banner if no signer available
        if (!walletState.signer) {
            showWalletConnectBanner();
        }
    }
});
