import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

type BridgeChainValue = 'Arc_Testnet' | 'Ethereum_Sepolia' | 'Base_Sepolia'

const BLOCKSCOUT_CHAINS: Record<BridgeChainValue, { chainId: number; fallbacks: string[] }> = {
  Arc_Testnet: {
    chainId: 5042002,
    fallbacks: ['https://testnet.arcscan.app/api/v2'],
  },
  Ethereum_Sepolia: {
    chainId: 11155111,
    fallbacks: ['https://eth-sepolia.blockscout.com/api/v2'],
  },
  Base_Sepolia: {
    chainId: 84532,
    fallbacks: ['https://base-sepolia.blockscout.com/api/v2'],
  },
}

function isBridgeChain(value: string | null): value is BridgeChainValue {
  return value === 'Arc_Testnet' || value === 'Ethereum_Sepolia' || value === 'Base_Sepolia'
}

function isTxHash(value: string | null): value is `0x${string}` {
  return Boolean(value && /^0x[a-fA-F0-9]{64}$/.test(value))
}

function getTimestampSeconds(value: unknown) {
  if (typeof value !== 'string') return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null
}

function getConfirmationDurationSeconds(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  if (Array.isArray(value) && value.length >= 2) {
    const seconds = Number(value[0])
    const fraction = Number(value[1])
    if (Number.isFinite(seconds) && Number.isFinite(fraction)) {
      // Blockscout returns confirmation_duration as [seconds, milliseconds].
      // Some older instances may expose microseconds, so keep a high-value fallback.
      const fractionSeconds = fraction >= 100_000 ? fraction / 1_000_000 : fraction / 1_000
      return seconds + fractionSeconds
    }
  }
  return null
}

function formatConfirmationDuration(seconds: number) {
  if (seconds < 1) return `<= ${Math.max(seconds, 0.01).toFixed(2)} secs`
  if (seconds < 60) return `<= ${seconds.toFixed(seconds < 10 ? 2 : 1)} secs`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = Math.round(seconds % 60)
  if (minutes < 60) return remainingSeconds ? `<= ${minutes}m ${remainingSeconds}s` : `<= ${minutes}m`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return remainingMinutes ? `<= ${hours}h ${remainingMinutes}m` : `<= ${hours}h`
}

function withApiKey(url: string, apiKey: string | undefined) {
  if (!apiKey) return url
  const parsed = new URL(url)
  parsed.searchParams.set('apikey', apiKey)
  return parsed.toString()
}

async function fetchBlockscoutTransaction(url: string) {
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) return null

  const data = await res.json() as { confirmation_duration?: unknown; timestamp?: unknown }
  const confirmationSeconds = getConfirmationDurationSeconds(data.confirmation_duration)
  return {
    timestamp: getTimestampSeconds(data.timestamp),
    confirmedWithin: confirmationSeconds == null ? null : formatConfirmationDuration(confirmationSeconds),
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const chain = searchParams.get('chain')
  const hash = searchParams.get('hash')

  if (!isBridgeChain(chain) || !isTxHash(hash)) {
    return NextResponse.json({ error: 'Invalid chain or transaction hash' }, { status: 400 })
  }

  const config = BLOCKSCOUT_CHAINS[chain]
  const apiKey = process.env.BLOCKSCOUT_API_KEY
  const urls = [
    `https://api.blockscout.com/${config.chainId}/api/v2/transactions/${hash}`,
    ...config.fallbacks.map((baseUrl) => `${baseUrl}/transactions/${hash}`),
  ].map((url) => withApiKey(url, apiKey))

  for (const url of urls) {
    try {
      const transaction = await fetchBlockscoutTransaction(url)
      if (transaction?.timestamp != null || transaction?.confirmedWithin) {
        return NextResponse.json(transaction)
      }
    } catch {
      // Try the next Blockscout-compatible endpoint.
    }
  }

  return NextResponse.json({ error: 'Transaction timestamp not indexed by Blockscout yet' }, { status: 404 })
}
