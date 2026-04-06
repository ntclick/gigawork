package config

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log"
	"os"
)

type Config struct {
	// Arc Network
	ArcRPCURL        string
	ArcWSURL         string
	EscrowAddress    string
	RegistryAddress  string
	PrivateKey       string
	TreasuryAddress  string

	// ERC-8004 Identity Registry
	IdentityRegistryAddress string

	// Supabase
	SupabaseURL        string
	SupabaseServiceKey string

	// Telegram
	TelegramBotToken string

	// Auth
	AuthSecret string

	// Webhook HMAC signing
	WebhookSecret string

	// Privy
	PrivyAppID    string
	PrivyClientID string
	PrivyAppSecret string

	// Server
	Port string
}

func Load() (*Config, error) {
	cfg := &Config{
		ArcRPCURL:          getEnv("ARC_RPC_URL", "https://rpc.drpc.testnet.arc.network"),
		ArcWSURL:           getEnv("ARC_WS_URL", "wss://rpc.drpc.testnet.arc.network"),
		EscrowAddress:      os.Getenv("GIGAWORK_ESCROW_ADDRESS"),
		RegistryAddress:    os.Getenv("GIGAWORK_REGISTRY_ADDRESS"),
		PrivateKey:         os.Getenv("PRIVATE_KEY"),
		TreasuryAddress:    os.Getenv("TREASURY_ADDRESS"),
		IdentityRegistryAddress: getEnv("IDENTITY_REGISTRY_ADDRESS", "0x8004A818BFB912233c491871b3d84c89A494BD9e"),
		SupabaseURL:        os.Getenv("SUPABASE_URL"),
		SupabaseServiceKey: os.Getenv("SUPABASE_SERVICE_KEY"),
		TelegramBotToken:   os.Getenv("TELEGRAM_BOT_TOKEN"),
		AuthSecret:         os.Getenv("AUTH_SECRET"),
		WebhookSecret:      os.Getenv("WEBHOOK_SECRET"),
		PrivyAppID:         os.Getenv("PRIVY_APP_ID"),
		PrivyClientID:      os.Getenv("PRIVY_CLIENT_ID"),
		PrivyAppSecret:     os.Getenv("PRIVY_APP_SECRET"),
		Port:               getEnv("PORT", "8080"),
	}

	if cfg.AuthSecret == "" {
		b := make([]byte, 32)
		rand.Read(b)
		cfg.AuthSecret = hex.EncodeToString(b)
		log.Println("WARNING: AUTH_SECRET not set, using random secret (sessions won't persist across restarts)")
	}

	if cfg.WebhookSecret == "" {
		b := make([]byte, 32)
		rand.Read(b)
		cfg.WebhookSecret = hex.EncodeToString(b)
		log.Println("WARNING: WEBHOOK_SECRET not set, using random secret (webhook signatures won't persist across restarts)")
	}

	if cfg.EscrowAddress == "" {
		return nil, fmt.Errorf("GIGAWORK_ESCROW_ADDRESS is required")
	}
	if cfg.RegistryAddress == "" {
		return nil, fmt.Errorf("GIGAWORK_REGISTRY_ADDRESS is required")
	}
	if cfg.SupabaseURL == "" {
		return nil, fmt.Errorf("SUPABASE_URL is required")
	}
	if cfg.SupabaseServiceKey == "" {
		return nil, fmt.Errorf("SUPABASE_SERVICE_KEY is required")
	}

	return cfg, nil
}

func getEnv(key, fallback string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return fallback
}
