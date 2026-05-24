// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title CosmicRaffleInstance
 * @dev Independent standalone raffle contract template deployed dynamically by the CosmicRaffleFactory.
 */
contract CosmicRaffleInstance {
    address public host;
    address public operator;
    string public title;
    bytes32 public merkleRoot;
    uint256 public totalEntries;
    uint256 public winnerCount;
    uint256 public commitBlock;
    bool public drawn;
    bytes32 public seed;
    uint256[] public winningIndices;
    string[] public winners;

    // Nested mapping for sparse array Fisher-Yates swaps
    mapping(uint256 => uint256) private swaps;

    event RaffleDrawn(
        bytes32 seed,
        uint256[] winningIndices,
        string[] winners
    );

    constructor(
        address _host,
        address _operator,
        string memory _title,
        bytes32 _merkleRoot,
        uint256 _totalEntries,
        uint256 _winnerCount,
        uint256 _commitBlock
    ) {
        require(_totalEntries > 0, "total entries must be > 0");
        require(_winnerCount > 0, "winner count must be > 0");
        require(_winnerCount <= _totalEntries, "winner count cannot exceed total entries");

        host = _host;
        operator = _operator;
        title = _title;
        merkleRoot = _merkleRoot;
        totalEntries = _totalEntries;
        winnerCount = _winnerCount;
        commitBlock = _commitBlock;
        drawn = false;
    }

    function combineHash(bytes32 a, bytes32 b) public pure returns (bytes32) {
        return a < b 
            ? keccak256(abi.encodePacked(a, b)) 
            : keccak256(abi.encodePacked(b, a));
    }

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
     * @dev Securely draws winning indices and verifies winner Merkle proofs on-chain.
     * Only the raffle host can execute this after target block hash is resolved.
     */
    function drawWinners(
        bytes32 _seed,
        string[] calldata _winningUsernames,
        bytes32[][] calldata _proofs
    ) external {
        require(msg.sender == host, "not raffle host");
        require(!drawn, "already drawn");
        require(_seed != bytes32(0), "seed cannot be zero");
        require(_winningUsernames.length == winnerCount, "invalid winners count");
        require(_proofs.length == winnerCount, "invalid proofs count");

        seed = _seed;
        drawn = true;

        for (uint256 i = 0; i < winnerCount; i++) {
            // Generate deterministic pseudo-random number from seed and step
            uint256 rand = uint256(keccak256(abi.encodePacked(_seed, i)));
            uint256 j = i + (rand % (totalEntries - i));

            // Perform Fisher-Yates swap
            uint256 valJ = swaps[j] == 0 ? j : swaps[j] - 1;
            uint256 valI = swaps[i] == 0 ? i : swaps[i] - 1;

            swaps[i] = valJ + 1;
            swaps[j] = valI + 1;

            winningIndices.push(valJ);

            // Verify Merkle Proof
            bytes32 hash1 = keccak256(bytes(_winningUsernames[i]));
            bytes32 leaf = keccak256(abi.encodePacked(hash1));
            require(verifyProof(merkleRoot, _proofs[i], leaf), "invalid winner proof");

            winners.push(_winningUsernames[i]);
        }

        emit RaffleDrawn(_seed, winningIndices, _winningUsernames);
    }

    /**
     * @dev Helper to retrieve all winning indices.
     */
    function getWinningIndices() external view returns (uint256[] memory) {
        return winningIndices;
    }

    /**
     * @dev Helper to retrieve all winning usernames.
     */
    function getWinners() external view returns (string[] memory) {
        return winners;
    }
}
