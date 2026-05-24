import * as fs from 'fs'
import * as path from 'path'

async function main() {
  console.log('🏗️  Compiling Raffle Factory and Standalone Template...')
  
  // Use solc JS binding
  const solc = (await import('solc')).default

  const instancePath = path.resolve(__dirname, '../contracts/CosmicRaffleInstance.sol')
  const factoryPath = path.resolve(__dirname, '../contracts/CosmicRaffleFactory.sol')

  const instanceSource = fs.readFileSync(instancePath, 'utf8')
  const factorySource = fs.readFileSync(factoryPath, 'utf8')

  const input = JSON.stringify({
    language: 'Solidity',
    sources: {
      'CosmicRaffleInstance.sol': { content: instanceSource },
      'CosmicRaffleFactory.sol': { content: factorySource },
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

  // 1. Save CosmicRaffleInstance artifact
  const instanceContract = output.contracts['CosmicRaffleInstance.sol'].CosmicRaffleInstance
  const instanceResult = {
    abi: instanceContract.abi,
    bytecode: '0x' + instanceContract.evm.bytecode.object,
  }
  const instanceOutPath = path.resolve(__dirname, '../contracts/CosmicRaffleInstance.json')
  fs.writeFileSync(instanceOutPath, JSON.stringify(instanceResult, null, 2))
  console.log(`✅ Compiled Instance → ${instanceOutPath}`)

  // 2. Save CosmicRaffleFactory artifact
  const factoryContract = output.contracts['CosmicRaffleFactory.sol'].CosmicRaffleFactory
  const factoryResult = {
    abi: factoryContract.abi,
    bytecode: '0x' + factoryContract.evm.bytecode.object,
  }
  const factoryOutPath = path.resolve(__dirname, '../contracts/CosmicRaffleFactory.json')
  fs.writeFileSync(factoryOutPath, JSON.stringify(factoryResult, null, 2))
  console.log(`✅ Compiled Factory → ${factoryOutPath}`)
}

main().catch((e) => {
  console.error('❌ Compilation failed:', e)
  process.exit(1)
})
