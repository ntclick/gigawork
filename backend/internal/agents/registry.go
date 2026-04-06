package agents

import (
	"context"
	"fmt"
	"os"
	"strings"

	"gigawork/internal/db"
	"log"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
)

const (
	DefaultPriceUSDC      = 0.10
	DefaultReusePriceUSDC = 0.04
)

// SeedAgents registers the spec agents in the database.
// It continues past individual errors so all valid agents are seeded.
func SeedAgents(ctx context.Context, client *db.Client) error {
	log.Println("[Registry] Syncing spec agents...")

	// Derive server wallet address from PRIVATE_KEY.
	// Each agent gets a unique deterministic address (hash of serverAddr + agentID)
	// because the agents table uses `address` as primary key.
	// operator_wallet stores the real server address for transaction signing.
	serverAddr := "0xafe6DD950Dc2CF561e8daBA1725e0e6840f70549" // fallback
	if pk := strings.TrimPrefix(os.Getenv("PRIVATE_KEY"), "0x"); pk != "" {
		if key, err := crypto.HexToECDSA(pk); err == nil {
			serverAddr = crypto.PubkeyToAddress(key.PublicKey).Hex()
			log.Printf("[Registry] Server wallet: %s", serverAddr)
		}
	}

	// agentAddr generates a unique deterministic address per agent
	// by hashing the server address + agent ID.
	agentAddr := func(agentID string) string {
		hash := crypto.Keccak256([]byte(fmt.Sprintf("%s:%s", serverAddr, agentID)))
		return common.BytesToAddress(hash).Hex()
	}

	specAgents := []db.Agent{
		{
			ID:               "web-intel-agent",
			Address:          agentAddr("web-intel-agent"),
			Name:             "Web Intel Agent",
			Description:      "Researches any URL or topic using web scraping and AI analysis. Returns structured key findings and insights.",
			Category:         "research",
			Capabilities:     []string{"web-scraping", "entity-extraction", "summarization"},
			SkillTags:        []string{"web-scraping", "entity-extraction", "summarization"},
			ERC8004TokenID:   0, // Auto-registered on-chain at startup
			HourlyRateUSDC:   0.10,
			Status:           "active",
			SuccessRate:      0.95,
			TrustScore:       85,
			TTLSeconds:       86400,
			ReputationScore:  750,
			IsActive:         true,
			VisibleOnMarketplace: true,
			Version:          "1.0",
			OperatorWallet:   serverAddr,
			Metadata: map[string]any{
				"best_for": "Extracting structured data from an article, blog post, or specific webpage.",
				"example_output": "{\n  \"title\": \"Example Article\",\n  \"summary\": \"This is a summary.\"\n}",
			},
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"url": map[string]any{"type": "string", "title": "Target URL", "placeholder": "https://example.com/article"},
					"extract_fields": map[string]any{
						"type": "array",
						"title": "Extraction Fields",
						"items": map[string]any{"type": "string"},
					},
					"output_format": map[string]any{
						"type": "string",
						"title": "Output Format",
						"enum": []string{"structured_json"},
					},
				},
				"required": []string{"url", "output_format"},
			},
		},
		{
			ID:               "crypto-scanner-agent",
			Address:          agentAddr("crypto-scanner-agent"),
			Name:             "Crypto Project Scanner",
			Description:      "Scans crypto projects using CoinGecko, on-chain data, and social signals. Returns investment-grade analysis.",
			Category:         "research",
			Capabilities:     []string{"crypto-research", "risk-assessment", "project-profiling"},
			SkillTags:        []string{"crypto-research", "risk-assessment", "project-profiling"},
			ERC8004TokenID:   0, // Auto-registered on-chain at startup
			HourlyRateUSDC:   0.15,
			Status:           "active",
			SuccessRate:      0.92,
			TrustScore:       78,
			TTLSeconds:       43200,
			ReputationScore:  680,
			IsActive:         true,
			VisibleOnMarketplace: true,
			Version:          "1.0",
			OperatorWallet:   serverAddr,
			Metadata: map[string]any{
				"best_for": "Deep dive research into a specific crypto token or protocol.",
				"example_output": "# Research Report\n## Subject: Arc Network\n\n**Tokenomics:** ...\n**Risks:** ...",
			},
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"token_name": map[string]any{
						"type":        "string",
						"title":       "Token Name",
						"placeholder": "e.g. Bitcoin, Solana, Arc Network",
					},
					"contract_address": map[string]any{
						"type":        "string",
						"title":       "Contract Address (optional)",
						"placeholder": "0x... or So1...",
					},
					"chain": map[string]any{
						"type":  "string",
						"title": "Chain",
						"enum":  []string{"solana", "ethereum", "base", "bsc", "arbitrum", "polygon"},
					},
				},
				"required": []string{"token_name"},
			},
		},
		{
			ID:               "social-sentiment-agent",
			Address:          agentAddr("social-sentiment-agent"),
			Name:             "Social Sentiment Agent",
			Description:      "Tracks social sentiment across Reddit, Twitter/X, and news for any topic or token. Returns sentiment score and trend analysis.",
			Category:         "analysis",
			Capabilities:     []string{"sentiment-analysis", "social-monitoring", "trend-detection"},
			SkillTags:        []string{"sentiment-analysis", "social-monitoring", "trend-detection"},
			ERC8004TokenID:   0, // Auto-registered on-chain at startup
			HourlyRateUSDC:   0.12,
			Status:           "active",
			SuccessRate:      0.90,
			TrustScore:       72,
			TTLSeconds:       21600,
			ReputationScore:  620,
			IsActive:         true,
			VisibleOnMarketplace: true,
			Version:          "1.0",
			OperatorWallet:   serverAddr,
			Metadata: map[string]any{
				"best_for": "Understanding market sentiment and recent narratives from Twitter and Reddit.",
				"example_output": "**Score:** 85/100 (Bullish)\n**Key Narratives:** Community expects an airdrop...",
			},
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"query_type": map[string]any{
						"type":  "string",
						"title": "Query Type",
						"enum":  []string{"Topic/Keyword", "Username", "Post URL"},
					},
					"topic": map[string]any{
						"type":        "string",
						"title":       "Query",
						"placeholder": "e.g. Arc Network, @arcnetwork, or https://x.com/...",
					},
					"timeframe": map[string]any{
						"type":  "string",
						"title": "Time Window",
						"enum":  []string{"1h", "6h", "24h", "7d"},
					},
				},
				"required": []string{"topic"},
			},
		},
		{
			ID:               "document-digest-agent",
			Address:          agentAddr("document-digest-agent"),
			Name:             "Document Digest Agent",
			Description:      "Reads whitepapers, technical docs, and long-form content. Returns structured summary with key points and risk flags.",
			Category:         "analysis",
			Capabilities:     []string{"document-reading", "summarization", "risk-flagging"},
			SkillTags:        []string{"document-reading", "summarization", "risk-flagging"},
			ERC8004TokenID:   0, // Auto-registered on-chain at startup
			HourlyRateUSDC:   0.08,
			Status:           "active",
			SuccessRate:      0.93,
			TrustScore:       82,
			TTLSeconds:       259200,
			ReputationScore:  710,
			IsActive:         true,
			VisibleOnMarketplace: true,
			Version:          "1.0",
			OperatorWallet:   serverAddr,
			Metadata: map[string]any{
				"best_for": "Saving time by summarizing lengthy whitepapers and extracting only the relevant specs.",
				"example_output": "- Point 1\n- Point 2",
			},
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"url": map[string]any{
						"type":        "string",
						"title":       "Document URL (PDF/Web)",
						"placeholder": "https://example.com/whitepaper.pdf",
					},
					"focus_areas": map[string]any{
						"type":  "array",
						"title": "Focus Areas (optional)",
						"items": map[string]any{"type": "string"},
						"placeholder": "tokenomics, team, risks",
					},
					"output_format": map[string]any{
						"type":  "string",
						"title": "Output Format",
						"enum":  []string{"summary", "bullets", "qa"},
					},
				},
				"required": []string{"url"},
			},
		},
		{
			ID:               "report-composer-agent",
			Address:          agentAddr("report-composer-agent"),
			Name:             "Report Composer Agent",
			Description:      "Synthesizes data from multiple agents into a comprehensive research report, investment memo, or Twitter thread.",
			Category:         "content",
			Capabilities:     []string{"report-writing", "content-composition", "data-synthesis"},
			SkillTags:        []string{"report-writing", "content-composition", "data-synthesis"},
			ERC8004TokenID:   0, // Auto-registered on-chain at startup
			HourlyRateUSDC:   0.20,
			Status:           "active",
			SuccessRate:      0.88,
			TrustScore:       75,
			TTLSeconds:       172800,
			ReputationScore:  650,
			IsActive:         true,
			VisibleOnMarketplace: true,
			Version:          "1.0",
			OperatorWallet:   serverAddr,
			Metadata: map[string]any{
				"best_for": "Orchestrating and tying together multiple distinct research points into a final beautiful document.",
				"example_output": "Comprehensive multi-page markdown string...",
				"requires_agents": []string{"crypto-scanner-agent", "social-sentiment-agent"},
			},
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"topic": map[string]any{
						"type":        "string",
						"title":       "Topic",
						"placeholder": "e.g. Solana DeFi ecosystem",
					},
					"report_type": map[string]any{
						"type":  "string",
						"title": "Report Type",
						"enum":  []string{"market_analysis", "project_overview", "investment_thesis", "technical_deep_dive"},
					},
					"token_address": map[string]any{
						"type":        "string",
						"title":       "Token Address (optional)",
						"placeholder": "0x... or So1...",
					},
					"target_length": map[string]any{
						"type":  "string",
						"title": "Length",
						"enum":  []string{"short", "medium", "long"},
					},
				},
				"required": []string{"topic", "report_type"},
			},
		},
		{
			ID:                   "matcher-agent",
			Address:              "0x0000000000000000000000000000000000000001",
			Name:                 "Matcher Agent",
			Description:          "Internal AI agent that scores and assigns the best available agent for each job.",
			Category:             "orchestration",
			ERC8004TokenID:       9999,
			HourlyRateUSDC:       0,
			Status:               "active",
			IsSystem:             true,
			VisibleOnMarketplace: false,
			IsActive:             true,
			ReputationScore:      1000,
			Version:              "1.0",
			OperatorWallet:       "0x0000000000000000000000000000000000000001",
		},
	}

	seeded := 0
	for _, a := range specAgents {
		// Set spec pricing defaults
		a.Pricing.PerCallUSDC = a.HourlyRateUSDC
		a.Pricing.ReusePriceUSDC = DefaultReusePriceUSDC
		a.Pricing.TrialAvailable = true
		a.Pricing.FailurePolicy = "no_charge"

		// Check if agent already exists with a valid on-chain token.
		// If so, preserve the token ID (don't overwrite with 0).
		existing, _ := client.GetAgent(ctx, a.ID)
		if existing != nil {
			if existing.ERC8004TokenID > 0 {
				a.ERC8004TokenID = existing.ERC8004TokenID
			}
			// If address changed (key rotation), delete old record first
			if existing.Address != a.Address {
				_ = client.DeleteAgentBySpecID(ctx, a.ID)
			}
		}

		if err := client.UpsertAgent(ctx, &a); err != nil {
			log.Printf("[Registry] ERROR: failed to seed agent %s (%s): %v", a.ID, a.Address, err)
			continue
		}
		log.Printf("[Registry] SUCCESSFULLY seeded agent %s → %s (token: %d)", a.ID, a.Address, a.ERC8004TokenID)
		seeded++
	}

	log.Printf("[Registry] Seeded %d/%d agents", seeded, len(specAgents))
	return nil
}
