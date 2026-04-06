package agents

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"math/big"
	"strings"
	"time"

	"gigawork/internal/chain"
	"gigawork/internal/chain/bindings"
	"gigawork/internal/db"

	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/common"
)

// EnsureOnChainRegistration checks all seeded agents and registers
// any that don't have valid on-chain ERC-8004 identity NFTs.
// Uses the system private key (PRIVATE_KEY from .env) to pay gas.
func EnsureOnChainRegistration(
	ctx context.Context,
	dbClient *db.Client,
	chainClient *chain.Client,
	identityAddr string,
) error {
	if chainClient.PrivateKey == nil {
		log.Println("[OnChainReg] No private key configured, skipping on-chain registration")
		return nil
	}

	if identityAddr == "" {
		log.Println("[OnChainReg] No identity registry address, skipping")
		return nil
	}

	idAddr := common.HexToAddress(identityAddr)

	// Need full IdentityRegistry (not just Caller) for write access
	registry, err := bindings.NewIdentityRegistry(idAddr, chainClient.ETH)
	if err != nil {
		return fmt.Errorf("failed to bind identity registry: %v", err)
	}

	agents, err := dbClient.ListAgents(ctx, false, "")
	if err != nil {
		return fmt.Errorf("failed to list agents: %v", err)
	}

	registered := 0
	for _, agent := range agents {
		if agent.IsSystem {
			continue
		}

		// Check if token already valid on-chain
		if agent.ERC8004TokenID > 0 {
			tokenID := big.NewInt(agent.ERC8004TokenID)
			owner, err := registry.OwnerOf(&bind.CallOpts{Context: ctx}, tokenID)
			if err == nil && strings.EqualFold(owner.Hex(), chainClient.Address.Hex()) {
				// Token exists and owned by system wallet — ensure visible
				if !agent.VisibleOnMarketplace {
					agent.VisibleOnMarketplace = true
					_ = dbClient.UpsertAgent(ctx, &agent)
					log.Printf("[OnChainReg] Agent %s token #%d valid, restored visibility", agent.Name, agent.ERC8004TokenID)
				}
				continue
			}
			// Token doesn't exist or wrong owner — needs re-registration
			log.Printf("[OnChainReg] Agent %s token #%d invalid (err=%v), will re-register", agent.Name, agent.ERC8004TokenID, err)
		}

		// Build metadata URI
		metadataURI := buildMetadataURI(agent)

		// Register on-chain
		log.Printf("[OnChainReg] Registering agent %s on ERC-8004...", agent.Name)
		tokenID, err := registerOnChain(ctx, chainClient, registry, metadataURI)
		if err != nil {
			if strings.Contains(err.Error(), "execution reverted") {
				// Might be already registered — try to find existing token
				log.Printf("[OnChainReg] Agent %s: register reverted (possibly already registered), skipping", agent.Name)
				continue
			}
			log.Printf("[OnChainReg] Agent %s registration failed: %v", agent.Name, err)
			continue
		}

		// Update DB with real token ID
		agent.ERC8004TokenID = tokenID
		agent.VisibleOnMarketplace = true
		if err := dbClient.UpsertAgent(ctx, &agent); err != nil {
			log.Printf("[OnChainReg] Failed to update agent %s token ID in DB: %v", agent.Name, err)
			continue
		}

		log.Printf("[OnChainReg] Agent %s registered with real token #%d", agent.Name, tokenID)
		registered++

		// Delay between registrations to avoid RPC rate limiting
		time.Sleep(3 * time.Second)
	}

	log.Printf("[OnChainReg] Registration complete: %d agents registered", registered)
	return nil
}

func buildMetadataURI(agent db.Agent) string {
	metadata := map[string]any{
		"type":        "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
		"name":        agent.Name,
		"description": agent.Description,
		"services": []map[string]string{
			{"name": "gigawork", "endpoint": "https://gigawork.xyz/api/agents/" + agent.Address},
		},
		"active":         agent.IsActive,
		"supportedTrust": []string{"reputation"},
	}

	jsonBytes, _ := json.Marshal(metadata)
	b64 := base64.StdEncoding.EncodeToString(jsonBytes)
	return "data:application/json;base64," + b64
}

func registerOnChain(
	ctx context.Context,
	chainClient *chain.Client,
	registry *bindings.IdentityRegistry,
	metadataURI string,
) (int64, error) {
	auth, err := chainClient.Signer(ctx)
	if err != nil {
		return 0, fmt.Errorf("signer error: %v", err)
	}

	tx, err := registry.Register(auth, metadataURI)
	if err != nil {
		return 0, fmt.Errorf("register tx failed: %v", err)
	}

	log.Printf("[OnChainReg] Tx sent: %s, waiting for confirmation...", tx.Hash().Hex())

	receipt, err := bind.WaitMined(ctx, chainClient.ETH, tx)
	if err != nil {
		return 0, fmt.Errorf("tx mining failed: %v", err)
	}

	if receipt.Status == 0 {
		return 0, fmt.Errorf("tx reverted: %s", tx.Hash().Hex())
	}

	// Extract tokenId from Transfer event in receipt logs
	for _, vLog := range receipt.Logs {
		event, err := registry.ParseTransfer(*vLog)
		if err == nil && event.To == chainClient.Address {
			return event.TokenId.Int64(), nil
		}
	}

	return 0, fmt.Errorf("Transfer event not found in receipt %s", receipt.TxHash.Hex())
}
