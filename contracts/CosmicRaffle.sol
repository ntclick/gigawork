// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title CosmicRaffle
 * @dev Public, verifiable raffle using a Single Shared Contract pattern.
 * Supports on-chain creation (createRaffle) and on-chain drawing (drawWinners) on a single shared contract.
 */
contract CosmicRaffle {
    struct Raffle {
        address host;
        string title;
        bytes32 merkleRoot;
        uint256 totalEntries;
        uint256 winnerCount;
        uint256 commitBlock;
        bool drawn;
        bytes32 seed;
        uint256[] winningIndices;
        string[] winners;
    }

    // List of all raffles registered on-chain
    Raffle[] public raffles;

    // Nested mapping to simulate memory-sparse arrays for Fisher-Yates:
    // raffleId => index => (swappedValue + 1)
    mapping(uint256 => mapping(uint256 => uint256)) private swaps;

    event RaffleCreated(
        uint256 indexed raffleId,
        address indexed host,
        string title,
        bytes32 merkleRoot,
        uint256 totalEntries,
        uint256 winnerCount,
        uint256 commitBlock
    );

    event RaffleDrawn(
        uint256 indexed raffleId,
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
     * @dev Creates a new raffle campaign on-chain.
     */
    function createRaffle(
        string calldata _title,
        bytes32 _merkleRoot,
        uint256 _totalEntries,
        uint256 _winnerCount,
        uint256 _commitBlock
    ) external returns (uint256) {
        require(_totalEntries > 0, "total entries must be > 0");
        require(_winnerCount > 0, "winner count must be > 0");
        require(_winnerCount <= _totalEntries, "winner count cannot exceed total entries");

        uint256 raffleId = raffles.length;
        
        // Push an empty struct and populate
        raffles.push();
        Raffle storage r = raffles[raffleId];
        r.host = msg.sender;
        r.title = _title;
        r.merkleRoot = _merkleRoot;
        r.totalEntries = _totalEntries;
        r.winnerCount = _winnerCount;
        r.commitBlock = _commitBlock;
        r.drawn = false;

        emit RaffleCreated(
            raffleId,
            msg.sender,
            _title,
            _merkleRoot,
            _totalEntries,
            _winnerCount,
            _commitBlock
        );

        return raffleId;
    }

    /**
     * @dev Securely draws winning indices and verifies winner Merkle proofs on-chain.
     * Only the raffle host can invoke this after verifying the Cosmic Seed.
     */
    function drawWinners(
        uint256 _raffleId,
        bytes32 _seed,
        string[] calldata _winningUsernames,
        bytes32[][] calldata _proofs
    ) external {
        require(_raffleId < raffles.length, "raffle does not exist");
        Raffle storage r = raffles[_raffleId];
        require(msg.sender == r.host, "not raffle host");
        require(!r.drawn, "already drawn");
        require(_seed != bytes32(0), "seed cannot be zero");
        require(_winningUsernames.length == r.winnerCount, "invalid winners count");
        require(_proofs.length == r.winnerCount, "invalid proofs count");

        r.seed = _seed;
        r.drawn = true;

        uint256 winnerCount = r.winnerCount;
        uint256 totalEntries = r.totalEntries;

        uint256[] memory indices = new uint256[](winnerCount);
        mapping(uint256 => uint256) storage raffleSwaps = swaps[_raffleId];

        for (uint256 i = 0; i < winnerCount; i++) {
            // Generate deterministic pseudo-random number from seed and step
            uint256 rand = uint256(keccak256(abi.encodePacked(_seed, i)));
            uint256 j = i + (rand % (totalEntries - i));

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
            require(verifyProof(r.merkleRoot, _proofs[i], leaf), "invalid winner proof");
            
            r.winners.push(_winningUsernames[i]);
        }

        r.winningIndices = indices;

        emit RaffleDrawn(_raffleId, _seed, indices, _winningUsernames);
    }

    /**
     * @dev Helper to retrieve all winning indices for a raffle.
     */
    function getWinningIndices(uint256 _raffleId) external view returns (uint256[] memory) {
        require(_raffleId < raffles.length, "raffle does not exist");
        return raffles[_raffleId].winningIndices;
    }

    /**
     * @dev Helper to retrieve all winning usernames for a raffle.
     */
    function getWinners(uint256 _raffleId) external view returns (string[] memory) {
        require(_raffleId < raffles.length, "raffle does not exist");
        return raffles[_raffleId].winners;
    }

    /**
     * @dev Helper to get total number of created raffles.
     */
    function getRaffleCount() external view returns (uint256) {
        return raffles.length;
    }
}
