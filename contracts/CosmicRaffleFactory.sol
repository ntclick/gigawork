// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./CosmicRaffleInstance.sol";

/**
 * @title CosmicRaffleFactory
 * @dev Global factory registry to deploy independent, standalone CosmicRaffleInstance contracts dynamically.
 */
contract CosmicRaffleFactory {
    // Array of all deployed raffle instances
    address[] public allRaffles;

    // Host => array of their deployed raffle contracts
    mapping(address => address[]) public hostToRaffles;

    event RaffleCreated(
        address indexed raffleAddress,
        address indexed host,
        string title,
        bytes32 merkleRoot,
        uint256 totalEntries,
        uint256 winnerCount,
        uint256 commitBlock
    );

    /**
     * @dev Deploys a new CosmicRaffleInstance contract.
     * msg.sender is passed as the host, giving them absolute ownership and control of the contract.
     */
    function createRaffle(
        address _operator,
        string calldata _title,
        bytes32 _merkleRoot,
        uint256 _totalEntries,
        uint256 _winnerCount,
        uint256 _commitBlock
    ) external returns (address) {
        // Deploy the standalone raffle contract instance
        CosmicRaffleInstance newRaffle = new CosmicRaffleInstance(
            msg.sender, // The caller becomes the Host/Owner
            _operator,
            _title,
            _merkleRoot,
            _totalEntries,
            _winnerCount,
            _commitBlock
        );

        address raffleAddr = address(newRaffle);
        allRaffles.push(raffleAddr);
        hostToRaffles[msg.sender].push(raffleAddr);

        emit RaffleCreated(
            raffleAddr,
            msg.sender,
            _title,
            _merkleRoot,
            _totalEntries,
            _winnerCount,
            _commitBlock
        );

        return raffleAddr;
    }

    /**
     * @dev Helper to get all deployed raffle contracts.
     */
    function getAllRaffles() external view returns (address[] memory) {
        return allRaffles;
    }

    /**
     * @dev Helper to get raffle contracts deployed by a specific host.
     */
    function getRafflesByHost(address _host) external view returns (address[] memory) {
        return hostToRaffles[_host];
    }

    /**
     * @dev Helper to get total number of deployed raffle contracts.
     */
    function getRafflesCount() external view returns (uint256) {
        return allRaffles.length;
    }
}
