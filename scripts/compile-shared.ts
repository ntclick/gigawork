import * as fs from 'fs'
import * as path from 'path'

async function main() {
  console.log('🏗️  Compiling Single Shared CosmicRaffle Smart Contract...')
  
  // Use solc JS binding
  const solc = (await import('solc')).default

  const contractPath = path.resolve(__dirname, '../contracts/CosmicRaffle.sol')
  const contractSource = fs.readFileSync(contractPath, 'utf8')

  const input = JSON.stringify({
    language: 'Solidity',
    sources: {
      'CosmicRaffle.sol': { content: contractSource },
    },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
      outputSelection: {
        '*': { '*': ['abi', 'evm.bytecode.object'] },
      },
    },
  })

  const output = JSON.parse(solc.compile(input))

  if (output.errors) {
    let hasError = false
    for (const err of output.errors) {
      if (err.severity === 'error') {
        console.error('❌', err.formattedMessage)
        hasError = true
      } else {
        console.warn('⚠️', err.formattedMessage)
      }
    }
    if (hasError) process.exit(1)
  }

  const compiledContract = output.contracts['CosmicRaffle.sol'].CosmicRaffle
  const result = {
    abi: compiledContract.abi,
    bytecode: '0x' + compiledContract.evm.bytecode.object,
  }
  const outPath = path.resolve(__dirname, '../contracts/CosmicRaffle.json')
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2))
  console.log(`✅ Compiled Shared CosmicRaffle → ${outPath}`)
}

main().catch((e) => {
  console.error('❌ Compilation failed:', e)
  process.exit(1)
})
