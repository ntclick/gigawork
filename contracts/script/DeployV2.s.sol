// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/GigaWorkCommerce.sol";

/// @title DeployV2 — Deploy GigaWorkCommerce (ERC-8183)
/// @notice Uses existing GigaWorkRegistry on Arc Testnet.
///         Registry ownership transfer is handled separately.
contract DeployV2 is Script {
    function run() external {
        address treasury = vm.envAddress("TREASURY_ADDRESS");
        address existingRegistry = vm.envAddress("GIGAWORK_REGISTRY_ADDRESS");
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");

        console.log("Using existing Registry: ", existingRegistry);
        console.log("Treasury:                ", treasury);

        vm.startBroadcast(deployerKey);

        // Deploy ERC-8183 Commerce contract
        GigaWorkCommerce commerce = new GigaWorkCommerce(existingRegistry, treasury);
        console.log("GigaWorkCommerce:        ", address(commerce));

        console.log("");
        console.log("=== All Contracts ===");
        console.log("ERC-8004 Identity:       ", address(0x8004A818BFB912233c491871b3d84c89A494BD9e));
        console.log("GigaWorkRegistry:        ", existingRegistry);
        console.log("GigaWorkCommerce (NEW):  ", address(commerce));
        console.log("GigaWorkStaking:         ", address(0x5aC6d607B33C02268a86E0D28Ee9Cbe086AE214f));

        vm.stopBroadcast();
    }
}
