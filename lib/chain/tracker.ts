import { pollingClient } from './client'
import type { Hex } from 'viem'

/**
 * Tracks a transaction hash asynchronously and executes the callback when the transaction is mined.
 * Useful for updating cached database states in response to on-chain transactions without blocking API requests.
 */
export function trackTransaction(txHash: Hex, callback: () => Promise<void> | void): void {
  // Spawn the tracking process in the background.
  (async () => {
    try {
      console.log(`[tracker] Started tracking transaction: ${txHash}`)
      const receipt = await pollingClient.waitForTransactionReceipt({
        hash: txHash,
        confirmations: 1,
        timeout: 60_000, // wait up to 60 seconds
      })
      console.log(`[tracker] Transaction mined in block ${receipt.blockNumber}: ${txHash}`)
      await callback()
      console.log(`[tracker] Transaction callback executed successfully for: ${txHash}`)
    } catch (err) {
      console.error(`[tracker] Error tracking transaction ${txHash}:`, err)
    }
  })()
}
