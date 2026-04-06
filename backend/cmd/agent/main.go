package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"gigawork/internal/agent"
	"gigawork/internal/chain"
	"gigawork/internal/config"
	"gigawork/internal/db"

	"github.com/joho/godotenv"
)

func main() {
	// Attempt to load .env.agent first, fallback to .env
	err := godotenv.Load(".env.agent")
	if err != nil {
		log.Println("[init] .env.agent not found, falling back to .env")
		_ = godotenv.Load()
	} else {
		log.Println("[init] Loaded config from .env.agent")
	}

	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("[fatal] config error: %v", err)
	}

	if cfg.PrivateKey == "" {
		log.Fatalf("[fatal] PRIVATE_KEY is required for the agent to sign transactions")
	}

	// ─── Supabase Client ─────────────────────────────────
	dbClient := db.NewClient(cfg.SupabaseURL, cfg.SupabaseServiceKey)

	// ─── Chain Client ────────────────────────────────────
	privateKey := strings.TrimPrefix(cfg.PrivateKey, "0x")
	chainClient, err := chain.NewClient(cfg.ArcRPCURL, privateKey)
	if err != nil {
		log.Fatalf("[fatal] chain client error: %v", err)
	}
	defer chainClient.Close()

	// ─── Contract Bindings ───────────────────────────────
	escrow, err := chain.NewEscrowContract(cfg.EscrowAddress, chainClient.ETH)
	if err != nil {
		log.Fatalf("[fatal] escrow contract error: %v", err)
	}

	registry, err := chain.NewRegistryContract(cfg.RegistryAddress, chainClient.ETH)
	if err != nil {
		log.Fatalf("[fatal] registry contract error: %v", err)
	}

	log.Println("[init] Connections established. Initializing GigaBot...")

	// ─── Context & Bot ───────────────────────────────────
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	bot := agent.NewGigaBot(dbClient, chainClient, escrow, registry)
	go bot.Start(ctx)

	// ─── Graceful Shutdown ───────────────────────────────
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("[init] Shutting down agent worker...")
	cancel()
	log.Println("[init] Goodbye.")
}
