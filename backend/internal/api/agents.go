package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math/big"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"gigawork/internal/db"
	"gigawork/internal/store"

	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/common"
	"github.com/go-chi/chi/v5"
)

// GET /agents?active=true&tag=llm
func (s *Server) ListAgents(w http.ResponseWriter, r *http.Request) {
	activeOnly := r.URL.Query().Get("active") == "true"
	tag := r.URL.Query().Get("tag")

	agents, err := s.DB.ListAgents(r.Context(), activeOnly, tag)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, agents)
}

// GET /agents/{address}
func (s *Server) GetAgent(w http.ResponseWriter, r *http.Request) {
	address := chi.URLParam(r, "address")
	agent, err := s.DB.GetAgent(r.Context(), address)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, agent)
}

type RegisterAgentRequest struct {
	Address        string   `json:"address"`
	ERC8004TokenID int64    `json:"erc8004_token_id"`
	HourlyRateUSDC float64  `json:"hourly_rate_usdc"`
	BillingUnit    string   `json:"billing_unit"`
	SkillTags      []string `json:"skill_tags"`
	Name           string   `json:"name"`
	Description    string   `json:"description"`
	Image          string   `json:"image"`
	WebhookURI     string   `json:"webhook_uri"` // External execution endpoint

	// Community agent fields
	FullDescription string   `json:"full_description"`
	HowToUse        string   `json:"how_to_use"`
	ExternalLink    string   `json:"external_link"`
	SampleOutput    string   `json:"sample_output"`
	Category        string   `json:"category"`
	Capabilities    []string `json:"capabilities"`
	PriceUSDC       float64  `json:"price_usdc"`
	OwnerWallet     string   `json:"owner_wallet"`
	EndpointURL     string   `json:"endpoint_url"`
	EndpointAuth    string   `json:"endpoint_auth"`
}

// POST /agents/register
func (s *Server) RegisterAgent(w http.ResponseWriter, r *http.Request) {
	var req RegisterAgentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Address == "" || req.HourlyRateUSDC <= 0 {
		writeError(w, http.StatusBadRequest, "address and hourly_rate_usdc are required")
		return
	}

	// ─── On-Chain Verification: Confirm NFT ownership ────────
	if s.IdentityRegistry != nil && req.ERC8004TokenID > 0 {
		tokenId := new(big.Int).SetInt64(req.ERC8004TokenID)
		owner, err := s.IdentityRegistry.OwnerOf(&bind.CallOpts{}, tokenId)
		if err != nil {
			writeError(w, http.StatusBadRequest, fmt.Sprintf(
				"ERC-8004 Token #%d does not exist on-chain.",
				req.ERC8004TokenID,
			))
			return
		}

		reqAddr := common.HexToAddress(req.Address)
		if !strings.EqualFold(owner.Hex(), reqAddr.Hex()) {
			writeError(w, http.StatusForbidden, fmt.Sprintf(
				"ERC-8004 Token #%d is owned by %s, not %s.",
				req.ERC8004TokenID, owner.Hex(), reqAddr.Hex(),
			))
			return
		}
	}

	billingUnit := req.BillingUnit
	if billingUnit == "" {
		billingUnit = "hour"
	}

	// ─── Determine effective price ───────────────────────────
	effectiveRate := req.HourlyRateUSDC
	if req.PriceUSDC > 0 {
		effectiveRate = req.PriceUSDC
	}

	// ─── Determine category ─────────────────────────────────
	category := req.Category
	if category == "" {
		category = "research"
	}

	// ─── Determine capabilities ─────────────────────────────
	capabilities := req.SkillTags
	if len(req.Capabilities) > 0 {
		capabilities = req.Capabilities
	}

	// ─── Determine operator wallet ──────────────────────────
	operatorWallet := req.Address
	if req.OwnerWallet != "" {
		operatorWallet = req.OwnerWallet
	}

	// ─── ERC-8004 Metadata Generation (Mock) ─────────────────
	metadataURI := fmt.Sprintf("https://api.gigawork.ai/metadata/agents/%s", req.Address)

	agent := &db.Agent{
		Address:              req.Address,
		Name:                 req.Name,
		Description:          req.Description,
		Category:             category,
		Capabilities:         capabilities,
		ERC8004TokenID:       req.ERC8004TokenID,
		HourlyRateUSDC:       effectiveRate,
		BillingUnit:          &billingUnit,
		SkillTags:            req.SkillTags,
		ReputationScore:      500,
		IsActive:             true,
		VisibleOnMarketplace: true,
		MetadataHash:         &metadataURI,
		WebhookURI:           &req.WebhookURI,
		Version:              "1.0",
		OperatorWallet:       operatorWallet,
		IsCommunity:          true,
		IsVerified:           false,
	}

	// ─── Store community agent extended fields ──────────────
	if req.FullDescription != "" {
		agent.FullDescription = &req.FullDescription
	}
	if req.HowToUse != "" {
		agent.HowToUse = &req.HowToUse
	}
	if req.ExternalLink != "" {
		agent.ExternalLink = &req.ExternalLink
	}
	if req.SampleOutput != "" {
		agent.SampleOutput = &req.SampleOutput
	}
	if req.EndpointURL != "" {
		agent.EndpointURL = &req.EndpointURL
	}
	if req.EndpointAuth != "" {
		agent.EndpointAuth = &req.EndpointAuth
	}

	// Add Pricing metadata (ERC-8183)
	agent.Pricing.PerCallUSDC = effectiveRate
	agent.Pricing.ReusePriceUSDC = store.CalculateReusePrice(effectiveRate)
	agent.Pricing.TrialAvailable = true
	agent.Pricing.FailurePolicy = "no_charge"

	if err := s.DB.UpsertAgent(r.Context(), agent); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// ─── Multi-Role Account Update ───────────────────────────
	user, err := s.DB.GetUser(r.Context(), req.Address)
	if err != nil {
		// Create user if not exists
		user = &db.User{
			Address: req.Address,
			Roles:   []string{db.RoleClient, db.RoleAgentOperator},
		}
	} else {
		// Add agent_operator role if missing
		hasRole := false
		for _, r := range user.Roles {
			if r == db.RoleAgentOperator {
				hasRole = true
				break
			}
		}
		if !hasRole {
			user.Roles = append(user.Roles, db.RoleAgentOperator)
		}
	}
	_ = s.DB.UpsertUser(r.Context(), user)

	writeJSON(w, http.StatusCreated, agent)
}

// GET /metadata/agents/{address} (Mock ERC-8004 Endpoint)
func (s *Server) GetAgentMetadata(w http.ResponseWriter, r *http.Request) {
	address := chi.URLParam(r, "address")
	agent, err := s.DB.GetAgent(r.Context(), address)
	if err != nil {
		writeError(w, http.StatusNotFound, "agent not found")
		return
	}

	// Correct ERC-8004 shape
	metadata := map[string]interface{}{
		"type":        "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
		"name":        fmt.Sprintf("Agent %s", address[:6]), // Mock name if not stored
		"description": "GigaWork verified autonomous agent.",
		"image":       "https://api.gigawork.ai/static/default-agent.png",
		"services": []map[string]string{
			{"type": "webhook", "endpoint": *agent.WebhookURI},
		},
		"agentWallet": agent.Address,
	}

	writeJSON(w, http.StatusOK, metadata)
}

// GET /agents/{address}/jobs
func (s *Server) GetAgentJobs(w http.ResponseWriter, r *http.Request) {
	address := chi.URLParam(r, "address")

	jobs, err := s.DB.ListJobs(r.Context(), "", "", address)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, jobs)
}

var statsCache sync.Map

type cachedStats struct {
	data   map[string]any
	expiry time.Time
}

// GET /agents/{address}/stats
func (s *Server) GetAgentStats(w http.ResponseWriter, r *http.Request) {
	address := chi.URLParam(r, "address")

	// Check cache
	if cached, ok := statsCache.Load(address); ok {
		cs := cached.(*cachedStats)
		if time.Now().Before(cs.expiry) {
			writeJSON(w, http.StatusOK, cs.data)
			return
		}
	}

	jobs, err := s.DB.ListJobs(r.Context(), "", "", address)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	total := len(jobs)
	settled := 0
	var totalDurationSec float64
	for _, j := range jobs {
		if j.Status == db.StatusCompleted {
			settled++
			dur := j.UpdatedAt.Sub(j.CreatedAt).Seconds()
			if dur > 0 && dur < 3600 {
				totalDurationSec += dur
			}
		}
	}

	successRate := 0.0
	avgResponseTime := 0.0
	if total > 0 {
		successRate = float64(settled) / float64(total)
	}
	if settled > 0 {
		avgResponseTime = totalDurationSec / float64(settled)
	}

	// Sample output from shared store
	var sampleOutput any
	inputHash := fmt.Sprintf("latest_%s", address)
	_ = inputHash
	// Try to find any store entry for this agent
	entries, _ := s.DB.ListStoreEntriesByAgent(r.Context(), address, 1)
	if len(entries) > 0 {
		sampleOutput = entries[0].Output
	}

	result := map[string]any{
		"total_jobs":          total,
		"settled_jobs":        settled,
		"success_rate":        successRate,
		"avg_response_time_s": avgResponseTime,
		"sample_output":       sampleOutput,
	}
	statsCache.Store(address, &cachedStats{data: result, expiry: time.Now().Add(60 * time.Second)})
	writeJSON(w, http.StatusOK, result)
}

// POST /agents/match — LLM-powered agent recommendation with keyword fallback
func (s *Server) MatchAgent(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Task string `json:"task"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Task == "" {
		writeError(w, http.StatusBadRequest, "task is required")
		return
	}

	// Load all agents
	agents, _ := s.DB.ListAgents(r.Context(), true, "")
	agentMap := make(map[string]*db.Agent)
	var agentList []map[string]string
	for i, a := range agents {
		if a.Address == "0x0000000000000000000000000000000000000001" {
			continue
		}
		agentMap[a.ID] = &agents[i]
		agentList = append(agentList, map[string]string{
			"id":          a.ID,
			"name":        a.Name,
			"description": a.Description,
		})
	}

	// Try LLM match first
	bestID, reason, confidence := s.matchWithLLM(r.Context(), req.Task, agentList)

	// Fallback to keyword match if LLM fails
	if bestID == "" {
		bestID, reason, confidence = matchWithKeywords(req.Task)
	}

	recommended := agentMap[bestID]
	if recommended == nil {
		// Last resort: first non-system agent
		for _, a := range agents {
			if a.Address != "0x0000000000000000000000000000000000000001" {
				recommended = &a
				bestID = a.ID
				reason = "Default recommendation based on available agents"
				confidence = 0.3
				break
			}
		}
	}

	if recommended == nil {
		writeError(w, http.StatusInternalServerError, "no agents available")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"recommended_agent": recommended,
		"reason":            reason,
		"confidence":        confidence,
		"task":              req.Task,
	})
}

// matchWithLLM uses DeepSeek to select the best agent for a task.
func (s *Server) matchWithLLM(ctx context.Context, task string, agentList []map[string]string) (agentID, reason string, confidence float64) {
	deepseekKey := os.Getenv("DEEPSEEK_API_KEY")
	if deepseekKey == "" {
		return "", "", 0
	}

	agentJSON, _ := json.Marshal(agentList)

	prompt := fmt.Sprintf(`Task: %s

Available agents:
%s

Return JSON only: {"agent_id": "the-agent-id", "reason": "one sentence why this agent is best", "confidence": 0.0-1.0}`, task, string(agentJSON))

	payload, _ := json.Marshal(map[string]any{
		"model": "deepseek-chat",
		"messages": []map[string]string{
			{"role": "system", "content": `You are an AI agent router. Given a user task description and a list of available AI agents, select the single most appropriate agent. Return JSON only, no markdown.

IMPORTANT routing rules (apply BEFORE making your decision):
- If task contains twitter.com, x.com, reddit.com URLs OR asks about 'sentiment', 'buzz', 'what people say', 'community feeling' → ALWAYS choose social-sentiment-agent
- If task contains a non-social URL (github, docs, website) OR asks to 'research', 'extract', 'scrape' a webpage → choose web-intel-agent
- If task mentions token price, market cap, trading volume, tokenomics → choose crypto-scanner-agent
- If task asks to 'summarize', 'digest', 'read' a document/PDF/whitepaper → choose document-digest-agent
- If task asks for a 'report', 'comprehensive analysis', 'investment memo' → choose report-composer-agent`},
			{"role": "user", "content": prompt},
		},
		"temperature": 0.1,
	})

	httpReq, _ := http.NewRequestWithContext(ctx, "POST", "https://api.deepseek.com/chat/completions", bytes.NewBuffer(payload))
	httpReq.Header.Set("Authorization", "Bearer "+deepseekKey)
	httpReq.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(httpReq)
	if err != nil {
		log.Printf("[MatchAgent] DeepSeek request failed: %v", err)
		return "", "", 0
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		log.Printf("[MatchAgent] DeepSeek returned %d", resp.StatusCode)
		return "", "", 0
	}

	var chatResp struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&chatResp); err != nil || len(chatResp.Choices) == 0 {
		return "", "", 0
	}

	// Extract JSON from response (strip markdown fences if present)
	content := chatResp.Choices[0].Message.Content
	content = strings.TrimSpace(content)
	if strings.HasPrefix(content, "```") {
		lines := strings.Split(content, "\n")
		if len(lines) > 2 {
			content = strings.Join(lines[1:len(lines)-1], "\n")
		}
	}

	var result struct {
		AgentID    string  `json:"agent_id"`
		Reason     string  `json:"reason"`
		Confidence float64 `json:"confidence"`
	}
	if err := json.Unmarshal([]byte(content), &result); err != nil {
		log.Printf("[MatchAgent] Failed to parse LLM response: %v (content: %s)", err, content[:min(len(content), 200)])
		return "", "", 0
	}

	log.Printf("[MatchAgent] LLM recommended: %s (confidence: %.2f, reason: %s)", result.AgentID, result.Confidence, result.Reason)
	return result.AgentID, result.Reason, result.Confidence
}

// matchWithKeywords is a fallback when LLM is unavailable.
func matchWithKeywords(task string) (agentID, reason string, confidence float64) {
	lower := strings.ToLower(task)

	type kw struct {
		id       string
		words    []string
		reason   string
	}
	rules := []kw{
		{"social-sentiment-agent", []string{"sentiment", "social", "twitter", "reddit", "community", "buzz", "opinion", "trending"}, "Your task involves tracking social media sentiment"},
		{"crypto-scanner-agent", []string{"crypto", "token", "price", "market cap", "coin", "defi", "blockchain", "sol", "btc", "eth"}, "Your task involves analyzing a crypto project or token"},
		{"web-intel-agent", []string{"url", "website", "research", "scrape", "link", "article", "http"}, "Your task involves researching web content"},
		{"document-digest-agent", []string{"document", "pdf", "whitepaper", "summarize", "paper", "read", "tldr"}, "Your task involves summarizing documents"},
		{"report-composer-agent", []string{"report", "comprehensive", "memo", "deep dive", "overview", "compose"}, "Your task requires a comprehensive report"},
	}

	bestID := "crypto-scanner-agent"
	bestScore := 0
	bestReason := "Default recommendation"

	for _, r := range rules {
		hits := 0
		for _, w := range r.words {
			if strings.Contains(lower, w) {
				hits++
			}
		}
		if hits > bestScore {
			bestScore = hits
			bestID = r.id
			bestReason = r.reason
		}
	}

	conf := 0.3
	if bestScore >= 3 {
		conf = 0.7
	} else if bestScore >= 1 {
		conf = 0.5
	}

	return bestID, bestReason, conf
}
