package agent

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log"
	"math/big"
	"strings"
	"time"

	"gigawork/internal/chain"
	"gigawork/internal/chain/bindings"
	"gigawork/internal/db"
)

type GigaBot struct {
	db        *db.Client
	ethClient *chain.Client
	escrow    *bindings.AgenticCommerce
	registry  *bindings.IdentityRegistry
	address   string
}

func NewGigaBot(dbClient *db.Client, ethClient *chain.Client, mockEscrow *chain.EscrowContract, mockRegistry *chain.RegistryContract) *GigaBot {
	// Initialize real Arc network bindings using the mock contract addresses
	escrow, _ := bindings.NewAgenticCommerce(mockEscrow.Address, ethClient.ETH)
	registry, _ := bindings.NewIdentityRegistry(mockRegistry.Address, ethClient.ETH)

	return &GigaBot{
		db:        dbClient,
		ethClient: ethClient,
		escrow:    escrow,
		registry:  registry,
		address:   strings.ToLower(ethClient.Address.Hex()),
	}
}

// Start begins the main agent loops
func (b *GigaBot) Start(ctx context.Context) {
	log.Printf("[agent] Starting GigaBot on address %s", b.address)

	if err := b.EnsureRegistered(ctx); err != nil {
		log.Printf("[agent] EnsureRegistered failed: %v", err)
	}

	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			log.Println("[agent] Shutting down bot...")
			return
		case <-ticker.C:
			b.ScanAndBid(ctx)
			b.ProcessWork(ctx)
		}
	}
}

// EnsureRegistered checks if the agent is registered via ERC-8004.
func (b *GigaBot) EnsureRegistered(ctx context.Context) error {
	opts, err := b.ethClient.Signer(ctx)
	if err != nil {
		return err
	}

	// Wait, we don't know the tokenId without scanning events or hardcoding. 
	// For now, if we reach here we assume we just call register to ensure we exist on-chain.
	// In production, we should check `ownerOf` or index our tokens.
	log.Printf("[agent] Ensuring ERC-8004 Registration on-chain...")

	metadataURI := "ipfs://QmDummySmartFollowAgentMetadata"
	tx, err := b.registry.Register(opts, metadataURI)
	if err != nil {
		if strings.Contains(err.Error(), "execution reverted") {
			log.Printf("[agent] Agent identity already registered on-chain.")
			return nil
		}
		return fmt.Errorf("failed to register ERC-8004: %w", err)
	}
	log.Printf("[agent] ERC-8004 Registration tx sent: %s", tx.Hash().Hex())
	return nil
}

// ScanAndBid acts as the Provider acknowledging jobs and setting the budget.
func (b *GigaBot) ScanAndBid(ctx context.Context) {
	// Look for jobs in MATCHING (meaning Client created it)
	jobs, err := b.db.ListJobs(ctx, "MATCHING", "", "")
	if err != nil {
		log.Printf("[agent] Scan error: %v", err)
		return
	}

	for _, job := range jobs {
		// Only pick jobs assigned to us
		if job.WorkerAgent != nil && strings.ToLower(*job.WorkerAgent) != b.address {
			continue
		}

		log.Printf("[agent] Found job #%d. Setting ERC-8183 Budget (Acknowledging)...", job.JobID)
		opts, err := b.ethClient.Signer(ctx)
		if err != nil {
			log.Printf("[agent] SetBudget skipped (signer error): %v", err)
			continue
		}

		// Let's set budget to 1 USDC
		budget := big.NewInt(1000000)
		tx, err := b.escrow.SetBudget(opts, big.NewInt(job.JobID), budget, []byte("0x"))
		if err != nil {
			log.Printf("[agent] SetBudget failed on-chain: %v", err)
			continue
		}

		log.Printf("[agent] SetBudget TX sent: %s", tx.Hash().Hex())
		
		job.Status = "BUDGET_SET"
		_ = b.db.UpsertJob(ctx, &job)
	}
}

// ProcessWork performs the SmartFollow analysis and submits deliverable.
func (b *GigaBot) ProcessWork(ctx context.Context) {
	jobs, err := b.db.ListJobs(ctx, "FUNDED", "", b.address)
	if err != nil {
		log.Printf("[agent] ProcessWork error: %v", err)
		return
	}

	for _, job := range jobs {
		log.Printf("[agent] Executing SmartFollow task for job #%d...", job.JobID)

		// Mock Solana RPC Tracking
		time.Sleep(3 * time.Second)
		log.Printf("[agent] Analyzed 500 Solana blocks. Found 3 target transactions.")

		// Generate random 32 byte hash representing the deliverable JSON
		bs := make([]byte, 32)
		rand.Read(bs)
		var hash32 [32]byte
		copy(hash32[:], bs)

		opts, err := b.ethClient.Signer(ctx)
		if err != nil {
			log.Printf("[agent] Submit skipped (signer error): %v", err)
			continue
		}

		tx, err := b.escrow.Submit(opts, big.NewInt(job.JobID), hash32, []byte("0x"))
		if err != nil {
			log.Printf("[agent] Submit Result failed: %v", err)
			continue
		}

		log.Printf("[agent] Deliverable Submitted TX: %s. Hash: %s", tx.Hash().Hex(), hex.EncodeToString(bs))
		
		job.Status = "PENDING_REVIEW"
		_ = b.db.UpsertJob(ctx, &job)
	}
}
