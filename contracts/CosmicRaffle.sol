// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title CosmicRaffle
 * @dev Public, verifiable raffle using a Single Shared Contract pattern.
 * Supports off-chain creation (free and instant) and a single on-chain transaction draw (drawRaffle).
 */
contract CosmicRaffle {
    struct Raffle {
        address host;
        bytes32 merkleRoot;
        uint256 totalEntries;
        uint256 winnerCount;
        uint256 commitBlock;
        bytes32 seed;
        uint256[] winningIndices;
        string[] winners;
    }

    // List of all completed raffles drawn on-chain
    Raffle[] public completedRaffles;

    // Prevent double drawing or replay attacks for a specific root and commit block combination
    mapping(bytes32 => bool) public drawnRaffles;

    // Nested mapping to simulate memory-sparse arrays for Fisher-Yates:
    // raffleId => index => (swappedValue + 1)
    mapping(uint256 => mapping(uint256 => uint256)) private swaps;

    event RaffleDrawn(
        uint256 indexed raffleId,
        address indexed host,
        bytes32 indexed merkleRoot,
        uint256 commitBlock,
        bytes32 seed,
        uint256[] winningIndices,
        string[] winners
    );

    /**
     * @dev Helper to combine two node hashes in the Merkle Tree (lexicographical order)
     */
    function combineHash(bytes32 a, bytes32 b) public pure returns (bytes32) {
        return a < b 
            ? keccak256(abi.encodePacked(a, b)) 
            : keccak256(abi.encodePacked(b, a));
    }

    /**
     * @dev Helper to verify Merkle proofs
     */
    function verifyProof(
        bytes32 _root,
        bytes32[] memory _proof,
        bytes32 _leaf
    ) public pure returns (bool) {
        bytes32 computedHash = _leaf;
        for (uint256 i = 0; i < _proof.length; i++) {
            computedHash = combineHash(computedHash, _proof[i]);
        }
        return computedHash == _root;
    }

    /**
     * @dev Draws winning indices and verifies winner Merkle proofs on-chain in a single transaction.
     * Registers the completed draw details and draws winners on-chain in one action.
     */
    function drawRaffle(
        bytes32 _merkleRoot,
        uint256 _totalEntries,
        uint256 _winnerCount,
        uint256 _commitBlock,
        bytes32 _seed,
        string[] calldata _winningUsernames,
        bytes32[][] calldata _proofs
    ) external returns (uint256) {
        require(_totalEntries > 0, "total entries must be > 0");
        require(_winnerCount > 0, "winner count must be > 0");
        require(_winnerCount <= _totalEntries, "winner count cannot exceed total entries");
        require(_winningUsernames.length == _winnerCount, "invalid winners count");
        require(_proofs.length == _winnerCount, "invalid proofs count");
        require(_seed != bytes32(0), "seed cannot be zero");

        // Prevent duplicate draw transactions
        bytes32 raffleKey = keccak256(abi.encodePacked(_merkleRoot, _commitBlock));
        require(!drawnRaffles[raffleKey], "raffle already drawn");
        drawnRaffles[raffleKey] = true;

        uint256 raffleId = completedRaffles.length;
        
        // Push an empty struct and populate
        completedRaffles.push();
        Raffle storage r = completedRaffles[raffleId];
        r.host = msg.sender;
        r.merkleRoot = _merkleRoot;
        r.totalEntries = _totalEntries;
        r.winnerCount = _winnerCount;
        r.commitBlock = _commitBlock;
        r.seed = _seed;

        uint256[] memory indices = new uint256[](_winnerCount);
        mapping(uint256 => uint256) storage raffleSwaps = swaps[raffleId];

        for (uint256 i = 0; i < _winnerCount; i++) {
            // Generate deterministic pseudo-random number from seed and step
            uint256 rand = uint256(keccak256(abi.encodePacked(_seed, i)));
            uint256 j = i + (rand % (_totalEntries - i));

            // Get current values at j and i (default to j and i respectively if unset)
            uint256 valJ = raffleSwaps[j] == 0 ? j : raffleSwaps[j] - 1;
            uint256 valI = raffleSwaps[i] == 0 ? i : raffleSwaps[i] - 1;

            // Perform swap
            raffleSwaps[i] = valJ + 1;
            raffleSwaps[j] = valI + 1;

            indices[i] = valJ;

            // Verify Merkle Proof of the winner and store on-chain
            bytes32 hash1 = keccak256(bytes(_winningUsernames[i]));
            bytes32 leaf = keccak256(abi.encodePacked(hash1));
            require(verifyProof(_merkleRoot, _proofs[i], leaf), "invalid winner proof");
            
            r.winners.push(_winningUsernames[i]);
        }

        r.winningIndices = indices;

        emit RaffleDrawn(
            raffleId,
            msg.sender,
            _merkleRoot,
            _commitBlock,
            _seed,
            indices,
            _winningUsernames
        );

        return raffleId;
    }

    /**
     * @dev Helper to retrieve all winning indices for a completed raffle.
     */
    function getWinningIndices(uint256 _raffleId) external view returns (uint256[] memory) {
        require(_raffleId < completedRaffles.length, "raffle does not exist");
        return completedRaffles[_raffleId].winningIndices;
    }

    /**
     * @dev Helper to retrieve all winning usernames for a completed raffle.
     */
    function getWinners(uint256 _raffleId) external view returns (string[] memory) {
        require(_raffleId < completedRaffles.length, "raffle does not exist");
        return completedRaffles[_raffleId].winners;
    }

    /**
     * @dev Helper to get total number of completed raffles drawn.
     */
    function getRaffleCount() external view returns (uint256) {
        return completedRaffles.length;
    }
}
