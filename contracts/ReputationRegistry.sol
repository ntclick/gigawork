// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract ReputationRegistry {
    mapping(uint256 => uint256) public scores;
    address public operator;

    event ScoreIncremented(uint256 indexed tokenId, uint256 newScore);

    constructor(address _operator) {
        operator = _operator;
    }

    modifier onlyOperator() {
        require(msg.sender == operator, "not operator");
        _;
    }

    function increment(uint256 tokenId) external onlyOperator {
        scores[tokenId]++;
        emit ScoreIncremented(tokenId, scores[tokenId]);
    }

    function incrementBatch(uint256[] calldata tokenIds) external onlyOperator {
        for (uint256 i = 0; i < tokenIds.length; i++) {
            scores[tokenIds[i]]++;
            emit ScoreIncremented(tokenIds[i], scores[tokenIds[i]]);
        }
    }

    function getScore(uint256 tokenId) external view returns (uint256) {
        return scores[tokenId];
    }
}
