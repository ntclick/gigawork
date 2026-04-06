// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Mock ERC-8004 IdentityRegistry for testing
contract MockIdentityRegistry {
    mapping(uint256 => address) private _owners;
    uint256 private _nextTokenId;

    function mint(address to) external returns (uint256 tokenId) {
        tokenId = _nextTokenId++;
        _owners[tokenId] = to;
    }

    function ownerOf(uint256 tokenId) external view returns (address) {
        address owner = _owners[tokenId];
        require(owner != address(0), "Token does not exist");
        return owner;
    }

    function tokenURI(uint256) external pure returns (string memory) {
        return "ipfs://mock";
    }
}
