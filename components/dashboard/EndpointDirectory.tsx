import React, { useState } from 'react'
import {
  Code,
  ToggleLeft,
  ToggleRight,
  Edit2,
  Check,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Copy,
  Terminal,
} from 'lucide-react'
import { AgentEndpoint } from '@/lib/nanopayments/config'

interface EndpointDirectoryProps {
  endpoints: AgentEndpoint[]
  onUpdateEndpoint: (skill: string, enabled: boolean, priceUsdc: string) => Promise<void>
}

export function EndpointDirectory({
  endpoints,
  onUpdateEndpoint,
}: EndpointDirectoryProps) {
  const [editingSkill, setEditingSkill] = useState<string | null>(null)
  const [editPrice, setEditPrice] = useState<string>('')
  const [expandedSkill, setExpandedSkill] = useState<string | null>(null)
  const [copyingSkill, setCopyingSkill] = useState<string | null>(null)

  const handleStartEdit = (ep: AgentEndpoint) => {
    setEditingSkill(ep.skill)
    setEditPrice(ep.priceUsdc)
  }

  const handleSavePrice = async (skill: string, currentEnabled: boolean) => {
    await onUpdateEndpoint(skill, currentEnabled, editPrice)
    setEditingSkill(null)
  }

  const handleToggleEnabled = async (ep: AgentEndpoint) => {
    await onUpdateEndpoint(ep.skill, !ep.enabled, ep.priceUsdc)
  }

  const handleCopy = (text: string, skill: string) => {
    navigator.clipboard.writeText(text)
    setCopyingSkill(skill)
    setTimeout(() => setCopyingSkill(null), 2000)
  }

  const getCodeSnippet = (ep: AgentEndpoint, type: 'curl' | 'js') => {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000'
    const endpointUrl = `${origin}/api/agents/${ep.skill}`
    
    if (type === 'curl') {
      return `# Step 1: Send request to get challenge
curl -X POST ${endpointUrl} \\
  -H "Content-Type: application/json" \\
  -d '{"token_address": "0x3600...0000", "chain": "ethereum"}'

# Step 2: Sign EIP-3009 TransferWithAuthorization using the details returned
# Step 3: Call with the base64 encoded X-PAYMENT header
curl -X POST ${endpointUrl} \\
  -H "Content-Type: application/json" \\
  -H "X-PAYMENT: <base64-encoded-payload>" \\
  -d '{"token_address": "0x3600...0000", "chain": "ethereum"}'`
    }

    return `// Buyer Agent EIP-3009 execution
const endpoint = "${endpointUrl}";
const payload = { token_address: "0x3600...0000", chain: "ethereum" };

// 1. Initial Call -> Expects 402 Challenge
const response = await fetch(endpoint, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload)
});

if (response.status === 402) {
  const { accepts } = await response.json();
  const challenge = accepts[0];
  
  // 2. Sign EIP-3009 on-chain/off-chain with Wallet
  const signature = await buyerWallet.signTypedData({
    domain: {
      name: 'GatewayWalletBatched',
      version: '1',
      chainId: 5042002, // Arc Testnet
      verifyingContract: challenge.extra?.verifyingContract ?? challenge.asset
    },
    types: {
      TransferWithAuthorization: [
        { name: 'from', type: 'address' },
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'validAfter', type: 'uint256' },
        { name: 'validBefore', type: 'uint256' },
        { name: 'nonce', type: 'bytes32' }
      ]
    },
    primaryType: 'TransferWithAuthorization',
    message: {
      from: buyerAddress,
      to: challenge.payTo,
      value: challenge.maxAmountRequired,
      validAfter: 0n,
      validBefore: BigInt(Math.floor(Date.now() / 1000) + 86400 * 4), // 4 days (Circle Gateway minimum 3 days)
      nonce: generateRandomBytes32()
    }
  });

  // 3. Retry with X-PAYMENT Authorization Header
  const xPayment = btoa(JSON.stringify({
    scheme: 'exact',
    network: challenge.network,
    payload: {
      authorization: {
        from: buyerAddress,
        to: challenge.payTo,
        value: challenge.maxAmountRequired,
        validAfter: '0',
        validBefore: String(Math.floor(Date.now() / 1000) + 3600),
        nonce: challengeNonce,
        signature
      }
    }
  }));

  const res2 = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-PAYMENT': xPayment
    },
    body: JSON.stringify(payload)
  });
  
  const result = await res2.json();
  console.log("Agent Workflow Result:", result);
}`
  }

  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden shadow-xl mb-6">
      <div className="px-5 py-4 border-b border-slate-800 bg-slate-900/40 flex justify-between items-center">
        <h3 className="font-pixel-header text-sm text-slate-100 font-bold tracking-wider">
          AGENT ENDPOINT REGISTRY
        </h3>
        <span className="text-xs text-slate-400 font-mono">
          {endpoints.length} APIs available for monetization
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-800 text-[10px] uppercase font-mono tracking-widest text-slate-500 bg-black/10">
              <th className="py-3 px-4">Endpoint / Agent Name</th>
              <th className="py-3 px-4">Category</th>
              <th className="py-3 px-4">Agent NFT</th>
              <th className="py-3 px-4">Price (USDC)</th>
              <th className="py-3 px-4">Latency</th>
              <th className="py-3 px-4">Status</th>
              <th className="py-3 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-850">
            {endpoints.map((ep) => {
              const isExpanded = expandedSkill === ep.skill
              const isEditing = editingSkill === ep.skill
              
              return (
                <React.Fragment key={ep.skill}>
                  <tr className="hover:bg-slate-950/20 transition-colors">
                    {/* Name */}
                    <td className="py-4 px-4">
                      <div className="flex items-center gap-3">
                        <span className="text-xl p-1.5 bg-slate-800/60 rounded-lg">{ep.emoji}</span>
                        <div>
                          <div className="font-semibold text-sm text-white flex items-center gap-1.5">
                            {ep.name}
                            <code className="text-[10px] text-cyan-400 bg-cyan-950/40 px-1.5 py-0.5 rounded font-mono font-normal">
                              /{ep.skill}
                            </code>
                          </div>
                          <div className="text-xs text-slate-400 mt-0.5 line-clamp-1 max-w-[400px]">
                            {ep.description}
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Category */}
                    <td className="py-4 px-4">
                      <span className="text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-350">
                        {ep.category}
                      </span>
                    </td>

                    {/* Agent NFT (ERC-8004) */}
                    <td className="py-4 px-4 font-mono text-xs">
                      {ep.agentTokenId ? (
                        <div className="flex flex-col gap-1">
                          <a
                            href={`https://testnet.arcscan.app/token/${process.env.NEXT_PUBLIC_IDENTITY_REGISTRY ?? '0x8004A818BFB912233c491871b3d84c89A494BD9e'}?a=${ep.agentTokenId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-cyan-400 hover:text-cyan-300 font-bold hover:underline flex items-center gap-1 inline-flex"
                          >
                            <span>#{ep.agentTokenId}</span>
                            <ExternalLink className="h-3 w-3 shrink-0" />
                          </a>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="text-[9px] font-bold bg-emerald-950/40 border border-emerald-500/20 text-emerald-400 px-1 py-0.25 rounded shrink-0">
                              VALIDATED
                            </span>
                            {ep.reputationScore !== undefined && ep.reputationScore > 0 && (
                              <span className="text-[9px] font-bold bg-slate-800 border border-slate-700 text-slate-300 px-1 py-0.25 rounded shrink-0" title="Reputation Score">
                                ⭐ {ep.reputationScore}
                              </span>
                            )}
                          </div>
                        </div>
                      ) : (
                        <span className="text-slate-600 select-none">Not Minted</span>
                      )}
                    </td>

                    {/* Price */}
                    <td className="py-4 px-4 font-mono text-sm text-emerald-400">
                      {isEditing ? (
                        <div className="flex items-center gap-1.5">
                          <input
                            type="text"
                            value={editPrice}
                            onChange={(e) => setEditPrice(e.target.value)}
                            className="w-16 bg-slate-950 border border-slate-750 px-1.5 py-0.5 rounded text-white text-xs font-mono focus:ring-0 focus:outline-none"
                          />
                          <button
                            onClick={() => handleSavePrice(ep.skill, ep.enabled)}
                            className="p-1 hover:text-emerald-300 transition"
                          >
                            <Check className="h-4 w-4" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 group">
                          <span>${parseFloat(ep.priceUsdc).toFixed(4)}</span>
                          <button
                            onClick={() => handleStartEdit(ep)}
                            className="opacity-0 group-hover:opacity-100 p-0.5 text-slate-400 hover:text-white transition"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </td>

                    {/* Latency */}
                    <td className="py-4 px-4 font-mono text-xs text-slate-400">
                      ~{(ep.latencyMs ?? 2000) / 1000}s
                    </td>

                    {/* Status Toggle */}
                    <td className="py-4 px-4">
                      <button
                        onClick={() => handleToggleEnabled(ep)}
                        className={`flex items-center gap-1.5 text-xs font-medium transition ${
                          ep.enabled ? 'text-emerald-400' : 'text-slate-500'
                        }`}
                      >
                        {ep.enabled ? (
                          <>
                            <ToggleRight className="h-6 w-6 text-emerald-400" />
                            <span>Active</span>
                          </>
                        ) : (
                          <>
                            <ToggleLeft className="h-6 w-6 text-slate-500" />
                            <span>Disabled</span>
                          </>
                        )}
                      </button>
                    </td>

                    {/* Actions */}
                    <td className="py-4 px-4 text-right">
                      <button
                        onClick={() => setExpandedSkill(isExpanded ? null : ep.skill)}
                        className="p-1.5 text-slate-400 hover:text-white bg-slate-800/40 hover:bg-slate-800 border border-slate-750 rounded-lg transition inline-flex items-center gap-1 text-xs"
                      >
                        <Code className="h-3.5 w-3.5" />
                        <span>SDK Snippet</span>
                        {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                      </button>
                    </td>
                  </tr>

                  {/* Expanded Code Snippet View */}
                  {isExpanded && (
                    <tr className="bg-slate-950/40 border-b border-slate-850">
                      <td colSpan={7} className="p-4">
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                          {/* Curl Snippet */}
                          <div>
                            <div className="flex justify-between items-center mb-1">
                              <span className="text-[10px] font-mono font-bold text-cyan-400 flex items-center gap-1">
                                <Terminal className="h-3 w-3" /> CURL SCRIPT
                              </span>
                              <button
                                onClick={() => handleCopy(getCodeSnippet(ep, 'curl'), ep.skill + '-curl')}
                                className="text-[9px] font-mono text-slate-400 hover:text-white flex items-center gap-1"
                              >
                                <Copy className="h-3 w-3" />
                                {copyingSkill === ep.skill + '-curl' ? 'COPIED!' : 'COPY'}
                              </button>
                            </div>
                            <pre className="bg-slate-900 border border-slate-800/60 p-3 rounded-lg overflow-x-auto text-[10px] text-slate-300 font-mono h-[180px]">
                              {getCodeSnippet(ep, 'curl')}
                            </pre>
                          </div>

                          {/* JS Snippet */}
                          <div>
                            <div className="flex justify-between items-center mb-1">
                              <span className="text-[10px] font-mono font-bold text-cyan-400 flex items-center gap-1">
                                <Code className="h-3 w-3" /> NODE.JS SDK CALL
                              </span>
                              <button
                                onClick={() => handleCopy(getCodeSnippet(ep, 'js'), ep.skill + '-js')}
                                className="text-[9px] font-mono text-slate-400 hover:text-white flex items-center gap-1"
                              >
                                <Copy className="h-3 w-3" />
                                {copyingSkill === ep.skill + '-js' ? 'COPIED!' : 'COPY'}
                              </button>
                            </div>
                            <pre className="bg-slate-900 border border-slate-800/60 p-3 rounded-lg overflow-x-auto text-[10px] text-slate-300 font-mono h-[180px]">
                              {getCodeSnippet(ep, 'js')}
                            </pre>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
