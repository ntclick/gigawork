package api

import (
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"strings"

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

	// ─── ERC-8004 Metadata Generation (Mock) ─────────────────
	metadataURI := fmt.Sprintf("https://api.gigawork.ai/metadata/agents/%s", req.Address)
	
	agent := &db.Agent{
		Address:         req.Address,
		Name:            req.Name,
		Description:     req.Description,
		Category:        "research", // Default or from request
		Capabilities:    req.SkillTags,
		ERC8004TokenID:  req.ERC8004TokenID,
		HourlyRateUSDC:  req.HourlyRateUSDC,
		BillingUnit:     &billingUnit,
		SkillTags:       req.SkillTags,
		ReputationScore: 500,
		IsActive:        true,
		MetadataHash:    &metadataURI,
		WebhookURI:      &req.WebhookURI,
		Version:         "1.0",
		OperatorWallet:  req.Address,
	}

	// Add Pricing metadata (ERC-8183)
	agent.Pricing.PerCallUSDC = req.HourlyRateUSDC // For demo, we use the same field
	agent.Pricing.ReusePriceUSDC = store.CalculateReusePrice(req.HourlyRateUSDC)
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

// GET /agents/{address}/stats
func (s *Server) GetAgentStats(w http.ResponseWriter, r *http.Request) {
	address := chi.URLParam(r, "address")

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

	writeJSON(w, http.StatusOK, map[string]any{
		"total_jobs":         total,
		"settled_jobs":       settled,
		"success_rate":       successRate,
		"avg_response_time_s": avgResponseTime,
		"sample_output":      sampleOutput,
	})
}
