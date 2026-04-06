// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/GigaWorkStaking.sol";

contract DeployStaking is Script {
    function run() external {
        address treasury = vm.envAddress("TREASURY_ADDRESS");
        address escrow = vm.envAddress("GIGAWORK_ESCROW_ADDRESS");
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");

        vm.startBroadcast(deployerKey);

        GigaWorkStaking staking = new GigaWorkStaking(treasury, escrow);
        console.log("GigaWorkStaking:", address(staking));

        vm.stopBroadcast();
    }
}
