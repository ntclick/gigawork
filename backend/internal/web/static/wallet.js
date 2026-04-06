// GigaWork Wallet — Simple Connect
let walletState = {
    connected: false,
    address: null,
    rawProvider: null,
    provider: null,
    signer: null,
    balance: '0.00'
};

let _connecting = false;

// ─── Init (check saved session) ──────────────────────────

async function initWallet() {
    const saved = localStorage.getItem('gigawork_address');
    const cachedBalance = localStorage.getItem('gigawork_balance');

    if (saved) {
        // Show cached state immediately (no flicker)
        walletState.address = saved;
        walletState.connected = true;
        walletState.balance = cachedBalance || '0.00';
        updateWalletUI();

        // Then verify with wallet in background
        if (window.ethereum) {
            try {
                const accounts = await window.ethereum.request({ method: 'eth_accounts' });
                if (accounts.length > 0 && accounts[0].toLowerCase() === saved.toLowerCase()) {
                    walletState.provider = new ethers.BrowserProvider(walletState.rawProvider || window.ethereum || window.okxwallet);
                    walletState.signer = await walletState.provider.getSigner();
                    await updateBalance();
                    localStorage.setItem('gigawork_balance', walletState.balance);
                    updateWalletUI();
                } else {
                    // Wallet changed or locked — keep showing cached, refresh balance from RPC
                    await updateBalance();
                    localStorage.setItem('gigawork_balance', walletState.balance);
                    updateWalletUI();
                }
            } catch (e) {
                // Wallet unavailable — still show cached data
                await updateBalance();
                updateWalletUI();
            }
        } else {
            // No wallet extension — still show cached address + fetch balance from RPC
            await updateBalance();
            updateWalletUI();
        }
    } else {
        updateWalletUI();
    }
}

// ─── Wallet Detection ────────────────────────────────────

function detectWalletProvider() {
    // OKX Wallet: prefer okxwallet provider
    if (window.okxwallet) {
        walletState.walletType = 'okx';
        return window.okxwallet;
    }
    // MetaMask or other EIP-1193
    if (window.ethereum) {
        walletState.walletType = window.ethereum.isMetaMask ? 'metamask' : 'eip1193';
        return window.ethereum;
    }
    return null;
}

// ─── Connect (one click) ─────────────────────────────────

async function connectWallet() {
    if (_connecting) return;
    _connecting = true;

    const rawProv = detectWalletProvider();
    if (!rawProv) {
        showWalletError('No wallet found. Install MetaMask or OKX Wallet.');
        _connecting = false;
        return;
    }

    const btn = document.getElementById('connect-wallet-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Connecting...'; }

    try {
        const accounts = await rawProv.request({ method: 'eth_requestAccounts' });
        const address = accounts[0];

        walletState.address = address;
        walletState.connected = true;
        walletState.rawProvider = rawProv;
        walletState.provider = new ethers.BrowserProvider(rawProv);
        walletState.signer = await walletState.provider.getSigner();

        localStorage.setItem('gigawork_address', address);
        console.log(`[Wallet] Connected: ${walletState.walletType} → ${shortAddr(address)}`);

        await updateBalance();
        localStorage.setItem('gigawork_balance', walletState.balance);
        updateWalletUI();

    } catch (err) {
        if (err.code === 4001) {
            showWalletError('Connection rejected');
        } else {
            showWalletError(err.message || 'Failed to connect');
        }
    } finally {
        _connecting = false;
        if (btn) { btn.disabled = false; btn.textContent = 'Connect Wallet'; }
    }
}

// ─── Disconnect ──────────────────────────────────────────

function disconnectWallet() {
    localStorage.removeItem('gigawork_address');
    localStorage.removeItem('gigawork_balance');
    walletState = { connected: false, address: null, rawProvider: null, provider: null, signer: null, balance: '0.00' };
    updateWalletUI();
}

// ─── Switch to Arc (only when doing a transaction) ───────

async function ensureArcChain() {
    const rp = walletState.rawProvider || detectWalletProvider();
    if (!rp) return false;

    try {
        // Check current chain first
        const currentChain = await rp.request({ method: 'eth_chainId' });
        if (parseInt(currentChain, 16) === ARC_CHAIN_ID) return true;

        // Try switching (chain already added to wallet)
        try {
            await rp.request({
                method: 'wallet_switchEthereumChain',
                params: [{ chainId: ARC_CHAIN_HEX }]
            });
            walletState.provider = new ethers.BrowserProvider(rp);
            walletState.signer = await walletState.provider.getSigner();
            return true;
        } catch (switchError) {
            if (switchError.code === 4001) {
                showWalletError('Please switch to Arc Testnet');
                return false;
            }
            // 4902 = chain not in wallet → try to add
            if (switchError.code !== 4902) {
                // OKX may throw non-standard errors for unknown chains
                if (walletState.walletType === 'okx') {
                    showWalletError('Please add Arc Testnet manually in OKX Wallet:\nChain ID: 5042002\nRPC: https://rpc.testnet.arc.network\nSymbol: USDC');
                    return false;
                }
                throw switchError;
            }
        }

        // Add chain (MetaMask and standard wallets)
        await rp.request({
            method: 'wallet_addEthereumChain',
            params: [ARC_NETWORK]
        });
        walletState.provider = new ethers.BrowserProvider(rp);
        walletState.signer = await walletState.provider.getSigner();
        return true;

    } catch (err) {
        console.error('ensureArcChain error:', err);
        if (walletState.walletType === 'okx') {
            showWalletError('OKX Wallet: Please add Arc Testnet manually in Settings → Networks');
        } else {
            showWalletError('Failed to switch to Arc Testnet: ' + (err.message || err));
        }
        return false;
    }
}

// ─── Balance ─────────────────────────────────────────────

async function updateBalance() {
    if (!walletState.address) return;
    try {
        // Always query Arc Testnet RPC directly (not wallet's current chain)
        const arcProvider = new ethers.JsonRpcProvider(ARC_RPC);
        const usdc = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, arcProvider);
        const bal = await usdc.balanceOf(walletState.address);
        walletState.balance = formatUSDC(bal);
    } catch (e) {
        try {
            const arcProvider = new ethers.JsonRpcProvider(ARC_RPC);
            const bal = await arcProvider.getBalance(walletState.address);
            walletState.balance = parseFloat(ethers.formatEther(bal)).toFixed(2);
        } catch (e2) {
            walletState.balance = '—';
        }
    }
}

// ─── Helpers ────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Dedicated Arc RPC provider for READ calls (receipt polling, balance checks).
// Wallet provider is used only for WRITE calls (sendTransaction).
// This splits traffic and avoids wallet RPC rate limits.
const arcReadProvider = new ethers.JsonRpcProvider(ARC_RPC);

// ─── Tx receipt polling (uses Arc RPC, not wallet) ──────
async function waitForTx(tx, maxAttempts = 30) {
    for (let i = 0; i < maxAttempts; i++) {
        await sleep(3000);
        try {
            const receipt = await arcReadProvider.getTransactionReceipt(tx.hash);
            if (receipt && receipt.blockNumber) {
                console.log(`[waitForTx] ${tx.hash} confirmed in block ${receipt.blockNumber}`);
                return receipt;
            }
        } catch (e) {
            console.log(`[waitForTx] attempt ${i + 1}/${maxAttempts} failed:`, e.message);
        }
    }
    throw new Error('Transaction confirmation timeout for ' + tx.hash);
}

// ─── Arc EIP-1559 Gas Overrides ─────────────────────────
// Arc Testnet requires EIP-1559 (type 2) transactions.
// Minimum baseFee = 160 gwei. We set maxFee slightly above.
const ARC_GAS = {
    maxFeePerGas: ethers.parseUnits('200', 'gwei'),
    maxPriorityFeePerGas: ethers.parseUnits('10', 'gwei'),
    type: 2
};

// ─── Contract Interactions (auto switch chain) ───────────

async function postJobOnChain(jobType, estimatedHours, agentAddress, spec) {
    if (!walletState.signer) throw new Error('Wallet not connected');
    if (!await ensureArcChain()) throw new Error('Wrong network');

    const escrow = new ethers.Contract(ESCROW_ADDRESS, ESCROW_ABI, walletState.signer);
    const specBytes = ethers.toUtf8Bytes(JSON.stringify(spec));
    const tx = await escrow.postJob(jobType, estimatedHours, agentAddress || ethers.ZeroAddress, specBytes, ARC_GAS);
    const receipt = await waitForTx(tx);
    return { tx, receipt };
}

async function registerAgentOnChain(erc8004TokenId, hourlyRateUSDC, skillTags) {
    if (!walletState.signer) throw new Error('Wallet not connected');
    if (!await ensureArcChain()) throw new Error('Wrong network');

    const registry = new ethers.Contract(REGISTRY_ADDRESS, REGISTRY_ABI, walletState.signer);
    const tx = await registry.register(erc8004TokenId, parseUSDC(hourlyRateUSDC), skillTags, ARC_GAS);
    const receipt = await waitForTx(tx);
    return { tx, receipt };
}

async function bidOnChain(jobId, note) {
    if (!walletState.signer) throw new Error('Wallet not connected');
    if (!await ensureArcChain()) throw new Error('Wrong network');

    walletState.provider = new ethers.BrowserProvider(walletState.rawProvider || window.ethereum || window.okxwallet);
    walletState.signer = await walletState.provider.getSigner();

    const escrow = new ethers.Contract(ESCROW_ADDRESS, ESCROW_ABI, walletState.signer);
    const tx = await escrow.bid(jobId, note, ARC_GAS);
    await waitForTx(tx);
    return tx;
}

async function approveUSDC(amount) {
    if (!walletState.signer) throw new Error('Wallet not connected');
    if (!await ensureArcChain()) throw new Error('Wrong network');

    walletState.provider = new ethers.BrowserProvider(walletState.rawProvider || window.ethereum || window.okxwallet);
    walletState.signer = await walletState.provider.getSigner();

    const usdc = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, walletState.signer);
    const tx = await usdc.approve(ESCROW_ADDRESS, parseUSDC(amount), ARC_GAS);
    await waitForTx(tx);
    return tx;
}

async function acceptBidOnChain(jobId, workerAddress) {
    if (!walletState.signer) throw new Error('Wallet not connected');
    if (!await ensureArcChain()) throw new Error('Wrong network');

    walletState.provider = new ethers.BrowserProvider(walletState.rawProvider || window.ethereum || window.okxwallet);
    walletState.signer = await walletState.provider.getSigner();

    // Check allowance via Arc RPC (read), approve via wallet (write)
    const usdcRead = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, arcReadProvider);
    const currentAllowance = await usdcRead.allowance(walletState.address, ESCROW_ADDRESS);
    if (currentAllowance < ethers.parseUnits('10000', USDC_DECIMALS)) {
        const approveTx = await usdc.approve(ESCROW_ADDRESS, ethers.parseUnits('999999', USDC_DECIMALS), ARC_GAS);
        await waitForTx(approveTx);
        await sleep(2000); // Cool down between approve and acceptBid
    }

    // Then call acceptBid on escrow
    const escrow = new ethers.Contract(ESCROW_ADDRESS, ESCROW_ABI, walletState.signer);
    const tx = await escrow.acceptBid(jobId, workerAddress, ARC_GAS);
    const receipt = await waitForTx(tx);
    return { tx, receipt };
}

async function submitResultOnChain(jobId, resultHash, proofURI) {
    if (!walletState.signer) throw new Error('Wallet not connected');
    if (!await ensureArcChain()) throw new Error('Wrong network');

    walletState.provider = new ethers.BrowserProvider(walletState.rawProvider || window.ethereum || window.okxwallet);
    walletState.signer = await walletState.provider.getSigner();

    const escrow = new ethers.Contract(ESCROW_ADDRESS, ESCROW_ABI, walletState.signer);
    const hashBytes = ethers.id(resultHash); // keccak256 of the result
    const tx = await escrow.submitResult(jobId, hashBytes, proofURI, ARC_GAS);
    const receipt = await waitForTx(tx);
    return { tx, receipt };
}

async function checkAllowance() {
    if (!walletState.address) return BigInt(0);
    const usdc = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, arcReadProvider);
    return await usdc.allowance(walletState.address, ESCROW_ADDRESS);
}

// ═══════════════════════════════════════════════════════════
//  ERC-8004: Identity NFT Functions
// ═══════════════════════════════════════════════════════════

/// Check if address has an ERC-8004 identity NFT.
/// Returns { hasIdentity, tokenId } or { hasIdentity: false }
async function checkAgentIdentity(address) {
    try {
        const arcProvider = new ethers.JsonRpcProvider(ARC_RPC);
        const identityRegistry = new ethers.Contract(IDENTITY_REGISTRY_ADDRESS, IDENTITY_ABI, arcProvider);
        const balance = await identityRegistry.balanceOf(address);
        if (balance > 0n) {
            // Contract doesn't have tokenOfOwnerByIndex (no ERC721Enumerable)
            // Scan Transfer events to find the tokenId minted to this address
            try {
                const transferFilter = identityRegistry.filters.Transfer(ethers.ZeroAddress, address);
                const logs = await identityRegistry.queryFilter(transferFilter, 0, 'latest');
                if (logs.length > 0) {
                    const tokenId = logs[logs.length - 1].args.tokenId;
                    let uri = '';
                    try { uri = await identityRegistry.tokenURI(tokenId); } catch {}
                    return { hasIdentity: true, tokenId: tokenId.toString(), uri };
                }
            } catch (scanErr) {
                console.warn('Event scan failed:', scanErr.message);
            }
            // Fallback: we know balance > 0 but can't find tokenId
            return { hasIdentity: true, tokenId: 'unknown', uri: '' };
        }
        return { hasIdentity: false };
    } catch (e) {
        console.warn('ERC-8004 check failed (contract may not support balanceOf):', e.message);
        return { hasIdentity: false, error: e.message };
    }
}

/// Mint an ERC-8004 identity NFT for the connected wallet.
/// agentMeta = { name, description, skills, endpoint }
async function mintAgentNFT(agentMeta) {
    if (!walletState.signer) throw new Error('Wallet not connected');
    if (!await ensureArcChain()) throw new Error('Wrong network');

    walletState.provider = new ethers.BrowserProvider(walletState.rawProvider || window.ethereum || window.okxwallet);
    walletState.signer = await walletState.provider.getSigner();

    // Build ERC-8004 compliant registration file (Agent Card)
    const registrationFile = {
        type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
        name: agentMeta.name || 'GigaWork Agent',
        description: agentMeta.description || '',
        image: agentMeta.image || '',
        services: [
            {
                name: 'web',
                endpoint: window.location.origin + '/app/agents'
            }
        ],
        active: true,
        registrations: [],
        supportedTrust: ['reputation']
    };

    // Convert to base64 data URI for on-chain storage
    const jsonStr = JSON.stringify(registrationFile);
    const base64 = btoa(unescape(encodeURIComponent(jsonStr)));
    const agentURI = 'data:application/json;base64,' + base64;

    const identityRegistry = new ethers.Contract(IDENTITY_REGISTRY_ADDRESS, IDENTITY_ABI, walletState.signer);

    // Try register(string metadataURI) first, fallback to register()
    let tx;
    try {
        tx = await identityRegistry['register(string)'](agentURI, ARC_GAS);
    } catch (e) {
        // Fallback: maybe contract only supports register() without args
        console.warn('register(string) failed, trying register():', e.message);
        tx = await identityRegistry['register()'](ARC_GAS);
    }

    const receipt = await waitForTx(tx);

    // Try to find the tokenId from Transfer event
    let tokenId = null;
    for (const log of receipt.logs) {
        try {
            const parsed = identityRegistry.interface.parseLog({ topics: log.topics, data: log.data });
            if (parsed && parsed.name === 'Transfer') {
                tokenId = parsed.args.tokenId.toString();
                break;
            }
            if (parsed && parsed.name === 'Registered') {
                tokenId = parsed.args.agentId.toString();
                break;
            }
        } catch { /* skip non-matching logs */ }
    }

    return { tx, receipt, tokenId };
}

// ═══════════════════════════════════════════════════════════
//  ERC-8183: Commerce Functions (new)
// ═══════════════════════════════════════════════════════════

async function createJobOnChain(provider, evaluator, expiredAt, description) {
    if (!walletState.signer) throw new Error('Wallet not connected');
    console.log('[createJobOnChain] Switching to Arc chain...');
    if (!await ensureArcChain()) throw new Error('Wrong network');

    console.log('[createJobOnChain] Refreshing signer...');
    walletState.provider = new ethers.BrowserProvider(walletState.rawProvider || window.ethereum || window.okxwallet);
    walletState.signer = await walletState.provider.getSigner();
    const signerAddr = await walletState.signer.getAddress();
    console.log('[createJobOnChain] Signer:', signerAddr);

    console.log('[createJobOnChain] Building contract at', COMMERCE_ADDRESS);
    const commerce = new ethers.Contract(COMMERCE_ADDRESS, COMMERCE_ABI, walletState.signer);

    console.log('[createJobOnChain] Calling createJob with:', {
        provider: provider || ethers.ZeroAddress,
        evaluator,
        expiredAt,
        descLen: description.length
    });
    const tx = await commerce.createJob(
        provider || ethers.ZeroAddress,
        evaluator,
        expiredAt,
        description,
        '0x', // empty optParams
        ARC_GAS
    );
    console.log('[createJobOnChain] Tx sent:', tx.hash);
    const receipt = await waitForTx(tx);
    console.log('[createJobOnChain] Tx confirmed in block', receipt.blockNumber);

    // Extract jobId from JobCreated event
    let jobId = null;
    for (const log of receipt.logs) {
        try {
            const parsed = commerce.interface.parseLog({ topics: log.topics, data: log.data });
            if (parsed && parsed.name === 'JobCreated') {
                jobId = parsed.args.jobId.toString();
                break;
            }
        } catch { /* skip */ }
    }

    return { tx, receipt, jobId };
}

async function fundJobOnChain(jobId, budget) {
    if (!walletState.signer) throw new Error('Wallet not connected');
    if (!await ensureArcChain()) throw new Error('Wrong network');

    walletState.provider = new ethers.BrowserProvider(walletState.rawProvider || window.ethereum || window.okxwallet);
    walletState.signer = await walletState.provider.getSigner();

    // Check allowance via Arc RPC (read), approve via wallet (write)
    const usdcRead = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, arcReadProvider);
    const allowance = await usdcRead.allowance(walletState.address, COMMERCE_ADDRESS);
    if (allowance < budget) {
        const approveTx = await usdc.approve(COMMERCE_ADDRESS, budget, ARC_GAS);
        await waitForTx(approveTx);
        await sleep(2000); // Cool down between approve and fund
    }

    const commerce = new ethers.Contract(COMMERCE_ADDRESS, COMMERCE_ABI, walletState.signer);
    const tx = await commerce.fund(jobId, budget, '0x', ARC_GAS);
    const receipt = await waitForTx(tx);
    return { tx, receipt };
}

async function submitWorkOnChain(jobId, deliverableHash) {
    if (!walletState.signer) throw new Error('Wallet not connected');
    if (!await ensureArcChain()) throw new Error('Wrong network');

    walletState.provider = new ethers.BrowserProvider(walletState.rawProvider || window.ethereum || window.okxwallet);
    walletState.signer = await walletState.provider.getSigner();

    const commerce = new ethers.Contract(COMMERCE_ADDRESS, COMMERCE_ABI, walletState.signer);
    const tx = await commerce.submit(jobId, deliverableHash, '0x', ARC_GAS);
    const receipt = await waitForTx(tx);
    return { tx, receipt };
}

async function completeJobOnChain(jobId) {
    if (!walletState.signer) throw new Error('Wallet not connected');
    if (!await ensureArcChain()) throw new Error('Wrong network');

    walletState.provider = new ethers.BrowserProvider(walletState.rawProvider || window.ethereum || window.okxwallet);
    walletState.signer = await walletState.provider.getSigner();

    const commerce = new ethers.Contract(COMMERCE_ADDRESS, COMMERCE_ABI, walletState.signer);
    const tx = await commerce.complete(jobId, ethers.ZeroHash, '0x', ARC_GAS);
    const receipt = await waitForTx(tx);
    return { tx, receipt };
}

// ═══════════════════════════════════════════════════════════
//  Platform Balance: Deposit USDC to server wallet
// ═══════════════════════════════════════════════════════════

// Server wallet address — USDC is sent here for platform balance.
// Read from page or hardcode (same as PRIVATE_KEY-derived address).
const SERVER_WALLET = '0xafe6DD950Dc2CF561e8daBA1725e0e6840f70549';

async function depositUSDC(amount) {
    if (!walletState.signer) throw new Error('Wallet not connected');
    if (!await ensureArcChain()) throw new Error('Wrong network');

    walletState.provider = new ethers.BrowserProvider(walletState.rawProvider || window.ethereum || window.okxwallet);
    walletState.signer = await walletState.provider.getSigner();

    const usdc = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, walletState.signer);
    const amountParsed = parseUSDC(amount);

    // Transfer USDC to server wallet
    console.log(`[Deposit] Transferring ${amount} USDC to ${SERVER_WALLET}`);
    const tx = await usdc.transfer(SERVER_WALLET, amountParsed, ARC_GAS);
    const receipt = await waitForTx(tx);

    // Notify backend to credit balance
    const res = await fetch('/api/balance/deposit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            wallet: walletState.address,
            amount: amount,
            tx_hash: tx.hash
        })
    });

    const data = await res.json();
    console.log('[Deposit] Backend response:', data);

    // Update displayed balance
    if (data.new_balance !== undefined) {
        walletState.platformBalance = data.new_balance;
        updatePlatformBalanceUI();
    }

    return { tx, receipt, balance: data.new_balance };
}

async function fetchPlatformBalance() {
    if (!walletState.address) return 0;
    try {
        const res = await fetch(`/api/balance?wallet=${walletState.address}`);
        const data = await res.json();
        walletState.platformBalance = data.balance || 0;
        updatePlatformBalanceUI();
        return walletState.platformBalance;
    } catch (e) {
        return 0;
    }
}

function updatePlatformBalanceUI() {
    const el = document.getElementById('platform-balance');
    if (el) {
        const bal = walletState.platformBalance || 0;
        el.textContent = bal.toFixed(2) + ' USDC';
        el.style.display = bal > 0 ? 'inline' : 'none';
    }
}

// ─── UI ──────────────────────────────────────────────────

function updateWalletUI() {
    const connectBtn = document.getElementById('connect-wallet-btn');
    const connectedDiv = document.getElementById('wallet-connected');
    const addressEl = document.getElementById('wallet-address');
    const balanceEl = document.getElementById('wallet-usdc-balance');
    const networkBadge = document.querySelector('.network-badge');

    if (walletState.connected) {
        if (connectBtn) connectBtn.style.display = 'none';
        if (connectedDiv) connectedDiv.style.display = 'flex';
        if (addressEl) { addressEl.textContent = shortAddr(walletState.address); addressEl.title = walletState.address; }
        if (balanceEl) balanceEl.textContent = walletState.balance + ' USDC';
        if (networkBadge) networkBadge.style.display = 'none';
    } else {
        if (connectBtn) connectBtn.style.display = 'block';
        if (connectedDiv) connectedDiv.style.display = 'none';
        if (networkBadge) networkBadge.style.display = 'flex';
    }

    const walletGate = document.getElementById('wallet-gate');
    const walletContent = document.getElementById('wallet-content');
    if (walletGate && walletContent) {
        walletGate.style.display = walletState.connected ? 'none' : 'block';
        walletContent.style.display = walletState.connected ? 'block' : 'none';
    }

    const employerInput = document.getElementById('employer');
    if (employerInput && walletState.address) {
        employerInput.value = walletState.address;
        employerInput.readOnly = true;
    }

    const agentInput = document.getElementById('agent-address');
    if (agentInput && walletState.address) {
        agentInput.value = walletState.address;
        agentInput.readOnly = true;
    }
}

function showWalletError(msg) {
    const el = document.getElementById('wallet-error');
    if (el) {
        el.textContent = msg;
        el.style.display = 'block';
        setTimeout(() => { el.style.display = 'none'; }, 5000);
    } else {
        alert(msg);
    }
}

function shortAddr(addr) {
    if (!addr || addr.length < 10) return addr || '';
    return addr.slice(0, 6) + '...' + addr.slice(-4);
}

// ─── Events ──────────────────────────────────────────────

if (window.ethereum) {
    window.ethereum.on('accountsChanged', (accounts) => {
        if (accounts.length === 0) {
            disconnectWallet();
        } else {
            localStorage.setItem('gigawork_address', accounts[0]);
            window.location.reload();
        }
    });
    window.ethereum.on('chainChanged', () => updateBalance());
}

// ─── Spotlight Effect (mouse tracking glow) ──────────

function initSpotlight() {
    document.addEventListener('mousemove', (e) => {
        document.querySelectorAll('.agent-card, .stat-card').forEach(card => {
            const rect = card.getBoundingClientRect();
            card.style.setProperty('--mouse-x', (e.clientX - rect.left) + 'px');
            card.style.setProperty('--mouse-y', (e.clientY - rect.top) + 'px');
        });
    });
}

document.addEventListener('DOMContentLoaded', () => {
    initWallet().then(() => fetchPlatformBalance());
    initSpotlight();
});
