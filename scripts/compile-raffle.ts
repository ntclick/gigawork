/**
 * compile-raffle — compile CosmicRaffle.sol and output ABI + bytecode as JSON.
 * Usage: npx tsx scripts/compile-raffle.ts
 */
import * as fs from 'fs'
import * as path from 'path'

async function main() {
  // Use solc JS binding
  const solc = (await import('solc')).default

  const solPath = path.resolve(__dirname, '../contracts/CosmicRaffle.sol')
  const source = fs.readFileSync(solPath, 'utf8')

  const input = JSON.stringify({
    language: 'Solidity',
    sources: {
      'CosmicRaffle.sol': { content: source },
    },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: {
        '*': { '*': ['abi', 'evm.bytecode.object'] },
      },
    },
  })

  const output = JSON.parse(solc.compile(input))

  if (output.errors) {
    for (const err of output.errors) {
      if (err.severity === 'error') {
        console.error(err.formattedMessage)
        process.exit(1)
      }
      // warnings are ok
      console.warn(err.formattedMessage)
    }
  }

  const contract = output.contracts['CosmicRaffle.sol'].CosmicRaffle
  const result = {
    abi: contract.abi,
    bytecode: '0x' + contract.evm.bytecode.object,
  }

  const outPath = path.resolve(__dirname, '../contracts/CosmicRaffle.json')
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2))
  console.log(`✅ Compiled → ${outPath}`)
  console.log(`   Bytecode length: ${result.bytecode.length} chars`)
  console.log(`   ABI entries: ${result.abi.length}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
