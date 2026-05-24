/**
 * verify-shared — automatically verify the single shared CosmicRaffle contract on ArcScan.
 *
 * Usage: npx tsx scripts/verify-shared.ts
 */
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env' })

import * as fs from 'fs'
import * as path from 'path'

const EXPLORER = process.env.NEXT_PUBLIC_ARC_EXPLORER ?? 'https://testnet.arcscan.app'
const CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_COSMIC_RAFFLE_ADDRESS

async function main() {
  console.log(`\n🔍 Shared Smart Contract Auto-Verification Initiated...`)
  
  if (!CONTRACT_ADDRESS) {
    console.error('❌ NEXT_PUBLIC_COSMIC_RAFFLE_ADDRESS missing in env. Run deploy script first!')
    process.exit(1)
  }

  console.log(`   Contract Address:  ${CONTRACT_ADDRESS}`)
  console.log(`   Explorer Base URL: ${EXPLORER}`)

  const solPath = path.resolve(__dirname, '../contracts/CosmicRaffle.sol')
  if (!fs.existsSync(solPath)) {
    console.error(`❌ Source contract file not found at ${solPath}`)
    process.exit(1)
  }

  const sourceCode = fs.readFileSync(solPath, 'utf8')
  console.log(`   Source file loaded: ${sourceCode.length} bytes`)

  // Prepare standard JSON input to match the solc compile settings (especially viaIR: true)
  const standardJsonInput = {
    language: 'Solidity',
    sources: {
      'contracts/CosmicRaffle.sol': { content: sourceCode },
    },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
      outputSelection: {
        '*': {
          '*': ['abi', 'evm.bytecode.object'],
        },
      },
    },
  }

  // Prepare standard urlencoded payload for Etherscan-compatible verification
  const params = new URLSearchParams()
  params.append('apikey', 'NONE')
  params.append('module', 'contract')
  params.append('action', 'verifysourcecode')
  params.append('contractaddress', CONTRACT_ADDRESS)
  params.append('sourceCode', JSON.stringify(standardJsonInput))
  params.append('codeformat', 'solidity-standard-json-input')
  params.append('contractname', 'contracts/CosmicRaffle.sol:CosmicRaffle')
  params.append('compilerversion', 'v0.8.28+commit.7893614a')
  params.append('constructorArguements', '')

  const apiUrl = `${EXPLORER.replace(/\/$/, '')}/api`
  console.log(`📡 Submitting verification request to API: ${apiUrl}...`)

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    })

    const json = await response.json() as { status: string; message: string; result: string }
    console.log(`💬 API Response:`, json)

    if (json.status !== '1') {
      if (json.result && json.result.toLowerCase().includes('already verified')) {
        console.log(`\n🎉 CosmicRaffle is ALREADY verified on ArcScan!`)
        process.exit(0)
      }
      throw new Error(`Verification submission failed: ${json.result || json.message}`)
    }

    const guid = json.result
    console.log(`⏳ Verification successfully submitted! GUID: ${guid}`)
    console.log(`⏰ Polling verification status every 5 seconds...`)

    // Poll for status
    for (let i = 0; i < 15; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5000))
      
      const checkUrl = `${apiUrl}?module=contract&action=checkverifystatus&guid=${guid}`
      const statusRes = await fetch(checkUrl)
      const statusJson = await statusRes.json() as { status: string; message: string; result: string }
      
      console.log(`   [Poll #${i + 1}] Status: ${statusJson.result || statusJson.message}`)

      if (statusJson.status === '1' || statusJson.result.toLowerCase().includes('pass') || statusJson.result.toLowerCase().includes('success')) {
        console.log(`\n🎉 SUCCESS! Contract verified on ArcScan!`)
        console.log(`🔗 Verified URL: ${EXPLORER}/address/${CONTRACT_ADDRESS}#code`)
        process.exit(0)
      } else if (statusJson.status === '0' && !statusJson.result.toLowerCase().includes('pending')) {
        console.error(`❌ Verification failed: ${statusJson.result}`)
        process.exit(1)
      }
    }

    console.log(`\n⚠️ Polling timed out. Please check verification status manually on ArcScan:`)
    console.log(`🔗 Explorer: ${EXPLORER}/address/${CONTRACT_ADDRESS}`)
  } catch (error) {
    console.error(`❌ Error during verification:`, error)
    process.exit(1)
  }
}

main()
