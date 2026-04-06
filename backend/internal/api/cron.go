package api

import (
	"context"
	"log"
	"math/big"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum/accounts/abi/bind"
)

// StartCronJobs runs background tasks for the GigaWork platform.
func (s *Server) StartCronJobs(ctx context.Context) {
	log.Printf("[Cron] Starting background verification jobs...")

	// 10-minute ticker for ERC-8004 ownership verification
	ticker := time.NewTicker(10 * time.Minute)
	defer ticker.Stop()

	// Run once immediately on start
	s.verifyAgentOwnership(ctx)

	for {
		select {
		case <-ctx.Done():
			log.Printf("[Cron] Stopping background jobs.")
			return
		case <-ticker.C:
			s.verifyAgentOwnership(ctx)
		}
	}
}

func (s *Server) verifyAgentOwnership(ctx context.Context) {
	if s.IdentityRegistry == nil {
		log.Printf("[Cron] ERC-8004 IdentityRegistry not configured, skipping verification.")
		return
	}

	// Server wallet is the expected owner of all system agent tokens
	var serverWallet string
	if s.ChainClient != nil {
		serverWallet = s.ChainClient.Address.Hex()
	}

	log.Printf("[Cron] Verifying ERC-8004 ownership (server wallet: %s)...", serverWallet)

	agents, err := s.DB.ListAgents(ctx, false, "")
	if err != nil {
		log.Printf("[Cron] Error listing agents: %v", err)
		return
	}

	for _, agent := range agents {
		if agent.IsSystem {
			continue
		}

		if agent.ERC8004TokenID == 0 {
			continue
		}

		tokenID := big.NewInt(agent.ERC8004TokenID)
		owner, err := s.IdentityRegistry.OwnerOf(&bind.CallOpts{Context: ctx}, tokenID)

		if err != nil {
			log.Printf("[Cron] Agent %s (Token #%d): OwnerOf reverted (%v). Flagging for re-registration.",
				agent.Name, agent.ERC8004TokenID, err)
			agent.ERC8004TokenID = 0
			_ = s.DB.UpsertAgent(ctx, &agent)
			continue
		}

		// Compare owner to SERVER WALLET (not agent.Address)
		// All system agent tokens are owned by the server wallet,
		// even though each agent has a unique derived address in DB.
		isOwnerValid := false
		if serverWallet != "" {
			isOwnerValid = strings.EqualFold(owner.Hex(), serverWallet)
		} else {
			// Fallback: check agent's operator_wallet
			isOwnerValid = strings.EqualFold(owner.Hex(), agent.OperatorWallet)
		}

		if !isOwnerValid && agent.VisibleOnMarketplace {
			log.Printf("[Cron] ALERT: Agent %s (Token #%d) ownership mismatch! Hiding. Owner: %s, Expected: %s",
				agent.Name, agent.ERC8004TokenID, owner.Hex(), serverWallet)
			agent.VisibleOnMarketplace = false
			s.DB.UpsertAgent(ctx, &agent)
		} else if isOwnerValid && !agent.VisibleOnMarketplace {
			log.Printf("[Cron] Agent %s (Token #%d) ownership verified. Restoring visibility.", agent.Name, agent.ERC8004TokenID)
			agent.VisibleOnMarketplace = true
			s.DB.UpsertAgent(ctx, &agent)
		}
	}
}
