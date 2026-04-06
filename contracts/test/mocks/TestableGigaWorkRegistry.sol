// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "../../src/GigaWorkRegistry.sol";

interface ITestableIdentityRegistry {
    function ownerOf(uint256 tokenId) external view returns (address);
}

/// @notice Testable version of GigaWorkRegistry that accepts a custom IdentityRegistry address
contract TestableGigaWorkRegistry is Ownable, ReentrancyGuard {
    ITestableIdentityRegistry public identityRegistry;

    enum JobType {
        ONCHAIN,
        OFFCHAIN_AI,
        SCRAPING,
        WORKFLOW
    }

    struct AgentProfile {
        uint256 erc8004TokenId;
        address owner;
        uint256 hourlyRateUSDC;
        string[] skillTags;
        uint256 reputationScore;
        uint256 totalJobsDone;
        uint256 totalEarnedUSDC;
        bool isActive;
        uint256 registeredAt;
    }

    mapping(address => AgentProfile) public agents;
    mapping(string => address[]) private agentsByTag;
    address[] public allAgents;

    event AgentRegistered(address indexed agent, uint256 erc8004TokenId, uint256 hourlyRate);
    event AgentUpdated(address indexed agent, uint256 newHourlyRate, bool isActive);
    event ReputationUpdated(address indexed agent, uint256 newScore, uint256 jobsDone);

    error NotTokenOwner();
    error AgentAlreadyRegistered();
    error AgentNotRegistered();
    error InvalidHourlyRate();

    constructor(address _identityRegistry) Ownable(msg.sender) {
        identityRegistry = ITestableIdentityRegistry(_identityRegistry);
    }

    function register(uint256 erc8004TokenId, uint256 hourlyRateUSDC, string[] calldata skillTags)
        external
        nonReentrant
    {
        if (identityRegistry.ownerOf(erc8004TokenId) != msg.sender) revert NotTokenOwner();
        if (agents[msg.sender].registeredAt != 0) revert AgentAlreadyRegistered();
        if (hourlyRateUSDC == 0) revert InvalidHourlyRate();

        agents[msg.sender] = AgentProfile({
            erc8004TokenId: erc8004TokenId,
            owner: msg.sender,
            hourlyRateUSDC: hourlyRateUSDC,
            skillTags: skillTags,
            reputationScore: 500,
            totalJobsDone: 0,
            totalEarnedUSDC: 0,
            isActive: true,
            registeredAt: block.timestamp
        });

        allAgents.push(msg.sender);
        for (uint256 i = 0; i < skillTags.length; i++) {
            agentsByTag[skillTags[i]].push(msg.sender);
        }

        emit AgentRegistered(msg.sender, erc8004TokenId, hourlyRateUSDC);
    }

    function updateProfile(uint256 newHourlyRate, bool isActive) external {
        if (agents[msg.sender].registeredAt == 0) revert AgentNotRegistered();
        agents[msg.sender].hourlyRateUSDC = newHourlyRate;
        agents[msg.sender].isActive = isActive;
        emit AgentUpdated(msg.sender, newHourlyRate, isActive);
    }

    function recordJobCompletion(address agent, uint256 earnedUSDC, int256 scoreDelta) external onlyOwner {
        AgentProfile storage p = agents[agent];
        p.totalJobsDone++;
        p.totalEarnedUSDC += earnedUSDC;

        int256 newScore = int256(p.reputationScore) + scoreDelta;
        p.reputationScore = uint256(newScore < 0 ? int256(0) : (newScore > 1000 ? int256(1000) : newScore));

        emit ReputationUpdated(agent, p.reputationScore, p.totalJobsDone);
    }

    function getAgentsByTag(string calldata tag) external view returns (address[] memory) {
        return agentsByTag[tag];
    }

    function getProfile(address agent) external view returns (AgentProfile memory) {
        return agents[agent];
    }

    function totalAgents() external view returns (uint256) {
        return allAgents.length;
    }
}
