import { keccak256, stringToBytes, encodePacked } from 'viem'

/**
 * Computes the cryptographic leaf hash for a given entry.
 * Uses double Keccak256 hashing to mitigate second-preimage attacks.
 */
export function hashLeaf(entry: string): `0x${string}` {
  const normalized = entry.trim()
  const firstHash = keccak256(stringToBytes(normalized))
  return keccak256(firstHash)
}

/**
 * Combines two child hashes into a parent hash.
 * Sorts lexicographically to maintain OpenZeppelin-compatible Merkle standards.
 */
export function combineHash(a: `0x${string}`, b: `0x${string}`): `0x${string}` {
  return a < b
    ? keccak256(encodePacked(['bytes32', 'bytes32'], [a, b]))
    : keccak256(encodePacked(['bytes32', 'bytes32'], [b, a]))
}

/**
 * Standard Merkle Tree implementation that preserves original order of leaves
 * so that Fisher-Yates drawn indices map 1-to-1 to the tree leaf indices.
 */
export class MerkleTree {
  public leaves: `0x${string}`[]
  public levels: `0x${string}`[][]

  constructor(entries: string[]) {
    this.leaves = entries.map(hashLeaf)
    this.levels = [this.leaves]
    this.build()
  }

  /**
   * Builds the tree level-by-level up to the root.
   */
  private build() {
    let currentLevel = this.leaves
    
    if (currentLevel.length === 0) {
      return
    }

    while (currentLevel.length > 1) {
      const nextLevel: `0x${string}`[] = []
      
      for (let i = 0; i < currentLevel.length; i += 2) {
        if (i + 1 < currentLevel.length) {
          nextLevel.push(combineHash(currentLevel[i], currentLevel[i + 1]))
        } else {
          // If the level has an odd number of nodes, pair the last node with itself
          nextLevel.push(combineHash(currentLevel[i], currentLevel[i]))
        }
      }
      
      this.levels.push(nextLevel)
      currentLevel = nextLevel
    }
  }

  /**
   * Returns the hexadecimal representation of the Merkle Root.
   */
  public getRoot(): `0x${string}` {
    if (this.leaves.length === 0) {
      return '0x0000000000000000000000000000000000000000000000000000000000000000'
    }
    return this.levels[this.levels.length - 1][0]
  }

  /**
   * Generates the Merkle Proof (sibling path) for a leaf at the specified index.
   */
  public getProof(index: number): `0x${string}`[] {
    if (index < 0 || index >= this.leaves.length) {
      throw new Error(`Index ${index} is out of bounds for leaf count ${this.leaves.length}`)
    }

    const proof: `0x${string}`[] = []
    let currentIndex = index

    for (let i = 0; i < this.levels.length - 1; i++) {
      const level = this.levels[i]
      const isRightNode = currentIndex % 2 === 1
      const siblingIndex = isRightNode ? currentIndex - 1 : currentIndex + 1
      
      if (siblingIndex < level.length) {
        proof.push(level[siblingIndex])
      } else {
        // Sibling doesn't exist, pair with itself
        proof.push(level[currentIndex])
      }
      
      currentIndex = Math.floor(currentIndex / 2)
    }

    return proof
  }

  /**
   * Verifies a Merkle proof off-chain.
   */
  public static verify(entry: string, proof: `0x${string}`[], root: `0x${string}`): boolean {
    let hash = hashLeaf(entry)
    for (const sibling of proof) {
      hash = combineHash(hash, sibling)
    }
    return hash === root
  }
}
