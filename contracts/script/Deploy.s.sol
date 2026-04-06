// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/GigaWorkRegistry.sol";
import "../src/GigaWorkEscrow.sol";

contract Deploy is Script {
    function run() external {
        address treasury = vm.envAddress("TREASURY_ADDRESS");
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");

        vm.startBroadcast(deployerKey);

        // 1. Deploy Registry
        GigaWorkRegistry registry = new GigaWorkRegistry();
        console.log("GigaWorkRegistry:", address(registry));

        // 2. Deploy Escrow
        GigaWorkEscrow escrow = new GigaWorkEscrow(address(registry), treasury);
        console.log("GigaWorkEscrow:  ", address(escrow));

        // 3. Transfer registry ownership to escrow (so escrow can update reputation)
        registry.transferOwnership(address(escrow));
        console.log("Registry ownership transferred to Escrow");

        console.log("Treasury:        ", treasury);

        vm.stopBroadcast();
    }
}
