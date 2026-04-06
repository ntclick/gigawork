const BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8181/api'

async function fetchJSON(path: string, options?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `API error ${res.status}`)
  return data
}

export const api = {
  agents: {
    list: () => fetchJSON('/agents'),
    get: (addr: string) => fetchJSON(`/agents/${addr}`),
    run: (addr: string, body: any) =>
      fetchJSON(`/agents/${addr}/run`, { method: 'POST', body: JSON.stringify(body) }),
    trial: (addr: string, body: any) =>
      fetchJSON(`/agents/${addr}/trial`, { method: 'POST', body: JSON.stringify(body) }),
    register: (body: any) =>
      fetchJSON('/agents/register', { method: 'POST', body: JSON.stringify(body) }),
    cached: (addr: string, inputs: Record<string, any>) =>
      fetchJSON(`/agents/${addr}/cached`, { method: 'POST', body: JSON.stringify({ inputs }) }),
    stats: (addr: string) => fetchJSON(`/agents/${addr}/stats`),
    match: (task: string) =>
      fetchJSON('/agents/match', { method: 'POST', body: JSON.stringify({ task }) }),
  },
  jobs: {
    list: (params?: string) => fetchJSON(`/jobs${params ? '?' + params : ''}`),
    get: (id: number) => fetchJSON(`/jobs/${id}`),
    create: (body: any) =>
      fetchJSON('/jobs', { method: 'POST', body: JSON.stringify(body) }),
    fund: (id: number, txHash: string) =>
      fetchJSON(`/jobs/${id}/fund`, { method: 'POST', body: JSON.stringify({ tx_hash: txHash }) }),
    setBudget: (id: number, body: { agent_address: string; amount: string }) =>
      fetchJSON(`/jobs/${id}/set-budget`, { method: 'POST', body: JSON.stringify(body) }),
    run: (id: number, body: { inputs: Record<string, any>; wallet: string }) =>
      fetchJSON(`/jobs/${id}/run`, { method: 'POST', body: JSON.stringify(body) }),
    register: (body: { job_id: string; employer: string; agent_address: string; amount: string; input: Record<string, any> }) =>
      fetchJSON('/jobs/register', { method: 'POST', body: JSON.stringify(body) }),
    result: (id: number) => fetchJSON(`/jobs/${id}/result`),
    report: (id: number, body: { reason: string; description: string; wallet: string }) =>
      fetchJSON(`/jobs/${id}/report`, { method: 'POST', body: JSON.stringify(body) }),
    execute: (body: { agent_address: string; wallet: string; approve_tx?: string; reuse?: boolean; inputs: Record<string, any> }) =>
      fetchJSON('/jobs/execute', { method: 'POST', body: JSON.stringify(body) }),
  },
  wallet: {
    balance: () => fetchJSON('/wallet/balance'),
  },
  balance: {
    get: (wallet: string) => fetchJSON(`/balance?wallet=${wallet}`),
    deposit: (wallet: string, amount: number, txHash: string) =>
      fetchJSON('/balance/deposit', {
        method: 'POST',
        body: JSON.stringify({ wallet, amount, tx_hash: txHash }),
      }),
    withdraw: (wallet: string, amount: number) =>
      fetchJSON('/balance/withdraw', {
        method: 'POST',
        body: JSON.stringify({ wallet, amount }),
      }),
  },
  auth: {
    me: () => fetchJSON('/auth/me'),
    nonce: (address: string) => fetchJSON(`/auth/nonce?address=${address}`),
    verify: (body: any) =>
      fetchJSON('/auth/verify', { method: 'POST', body: JSON.stringify(body) }),
    privySendOTP: (email: string) =>
      fetchJSON('/auth/privy-send-otp', { method: 'POST', body: JSON.stringify({ email }) }),
    privyVerify: (email: string, code: string) =>
      fetchJSON('/auth/privy-verify', { method: 'POST', body: JSON.stringify({ email, code }) }),
  },
  stats: () => fetchJSON('/stats'),
  depositAddress: () => fetchJSON('/deposit-address'),
}
