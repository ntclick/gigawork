import { pad, isHex, stringToHex } from 'viem'

/**
 * Normalizes and converts any string or hex seed to a padded EVM bytes32 string (0x-prefixed).
 */
export function seedToBytes32(seed: string): `0x${string}` {
  if (!seed) {
    return '0x0000000000000000000000000000000000000000000000000000000000000000'
  }

  // If already a valid hex, parse it
  if (isHex(seed)) {
    // If it's 32 bytes (66 chars including 0x), return it. Otherwise pad it.
    return pad(seed, { size: 32 })
  }

  // Otherwise convert plain text to hex and pad
  const hex = stringToHex(seed)
  return pad(hex, { size: 32 })
}
