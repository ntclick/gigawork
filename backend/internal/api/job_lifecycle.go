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
	"strconv"
	"strings"
	"sync"
	"time"

	"gigawork/internal/agents"
	"gigawork/internal/blockchain"
	"gigawork/internal/db"
	"gigawork/internal/privy"
	"gigawork/internal/store"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/go-chi/chi/v5"
)

// ─── POST /jobs/execute ───────────────────────────────────────────────
// Single endpoint: 0 wallet popups.
// 1) If user has delegated their Privy embedded wallet → user pays (via delegated actions)
// 2) Fallback → server wallet pays
// Then runs agent and settles (submit → complete).

// ─── POST /agents/{address}/cached ───────────────────────────────────
// Check if a cached result exists for the given inputs.

type CheckCachedRequest struct {
	Inputs map[string]any `json:"inputs"`
}

func (s *Server) CheckCachedResult(w http.ResponseWriter, r *http.Request) {
	agentAddr := chi.URLParam(r, "address")

	var req CheckCachedRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	inputHash, _ := store.ComputeInputHash(agentAddr, req.Inputs)
	entry, err := s.DB.GetStoreEntry(r.Context(), inputHash)
	if err != nil || time.Now().After(entry.ExpiresAt) {
		writeJSON(w, http.StatusOK, map[string]any{
			"cached": false,
		})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"cached":      true,
		"output":      entry.Output,
		"content_hash": entry.ContentHash,
		"produced_at":  entry.ProducedAt,
		"expires_at":   entry.ExpiresAt,
		"reuse_price":  entry.ReusePriceUSDC,
		"original_price": entry.OriginalRunPriceUSDC,
	})
}

// ─── POST /jobs/execute ─────────────────────────────────────────────

type ExecuteJobRequest struct {
	AgentAddress string         `json:"agent_address"`
	Wallet       string         `json:"wallet"`
	ApproveTx    string         `json:"approve_tx"`
	Reuse        bool           `json:"reuse"`        // use cached result instead of running agent
	Inputs       map[string]any `json:"inputs"`
}

type ExecuteJobResponse struct {
	JobID    int64  `json:"job_id"`
	Status   string `json:"status"`
	PayMode  string `json:"pay_mode,omitempty"` // "delegated" or "server"
	TxHash   string `json:"tx_hash,omitempty"`
	Error    string `json:"error,omitempty"`
}

func (s *Server) ExecuteJob(w http.ResponseWriter, r *http.Request) {
	// Catch any panics so the server always returns JSON, never ERR_EMPTY_RESPONSE
	defer func() {
		if rec := recover(); rec != nil {
			log.Printf("[ExecuteJob] PANIC recovered: %v", rec)
			writeError(w, http.StatusInternalServerError, fmt.Sprintf("internal panic: %v", rec))
		}
	}()

	log.Printf("[ExecuteJob] Received request")

	var req ExecuteJobRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	log.Printf("[ExecuteJob] Parsed body: agent=%s wallet=%s inputs=%d fields", req.AgentAddress, req.Wallet, len(req.Inputs))

	if req.AgentAddress == "" {
		writeError(w, http.StatusBadRequest, "agent_address required")
		return
	}

	// Input validation
	if !isValidEVMAddress(req.AgentAddress) {
		writeError(w, http.StatusBadRequest, "invalid agent address format")
		return
	}
	if req.Wallet != "" && !isValidEVMAddress(req.Wallet) {
		writeError(w, http.StatusBadRequest, "invalid wallet address format")
		return
	}

	// Look up agent
	agent, err := s.DB.GetAgent(r.Context(), req.AgentAddress)
	if err != nil {
		writeError(w, http.StatusNotFound, "agent not found: "+req.AgentAddress)
		return
	}
	log.Printf("[ExecuteJob] Agent found: %s (%.2f USDC)", agent.Name, agent.Pricing.PerCallUSDC)

	cost := agent.Pricing.PerCallUSDC
	description := fmt.Sprintf("%s: %s", agent.Name, truncate(fmt.Sprintf("%v", req.Inputs), 100))

	// ─── Reuse cached result if requested ───────────────────────
	if req.Reuse {
		inputHash, _ := store.ComputeInputHash(agent.Address, req.Inputs)
		entry, cacheErr := s.DB.GetStoreEntry(r.Context(), inputHash)
		if cacheErr == nil && time.Now().Before(entry.ExpiresAt) {
			reusePrice := entry.ReusePriceUSDC
			log.Printf("[ExecuteJob] Reuse cache hit for agent %s, price=%.2f USDC", agent.Address, reusePrice)

			reuseJobID := time.Now().UnixNano() / 1e6
			ptrStr := func(v string) *string { return &v }
			ptrFloat := func(f float64) *float64 { return &f }
			chargedAmt := reusePrice
			paidLabel := "server"
			_ = s.DB.UpsertJob(r.Context(), &db.Job{
				JobID:          reuseJobID,
				Employer:       req.Wallet,
				WorkerAgent:    ptrStr(agent.Address),
				JobType:        "OFFCHAIN_AI",
				HourlyRateUSDC: ptrFloat(reusePrice),
				ActualCharge:   &chargedAmt,
				BillingUnit:    &paidLabel,
				ResultHash:     &entry.ContentHash,
				Status:         db.StatusCompleted,
				CreatedAt:      time.Now(),
				UpdatedAt:      time.Now(),
			})

			entry.ReuseCount++
			_ = s.DB.UpsertStoreEntry(r.Context(), entry)

			writeJSON(w, http.StatusOK, ExecuteJobResponse{
				JobID:   reuseJobID,
				Status:  "completed",
				PayMode: "reuse",
			})
			return
		}
		log.Printf("[ExecuteJob] Reuse requested but no cache available, running fresh")
	}

	costRaw := new(big.Int).SetInt64(int64(cost * 1e6)) // 6 decimals

	// ─── Collect USDC from user (if approve_tx provided) ────────
	payMode := "server"
	if req.ApproveTx != "" && req.Wallet != "" {
		log.Printf("[ExecuteJob] User provided approve_tx=%s, collecting %.2f USDC from %s", req.ApproveTx, cost, req.Wallet)
		signer, signerErr := blockchain.NewSigner(s.ChainClient)
		if signerErr == nil {
			userAddr := common.HexToAddress(req.Wallet)
			collectTx, collectErr := signer.CollectUSDC(r.Context(), userAddr, costRaw)
			if collectErr != nil {
				log.Printf("[ExecuteJob] USDC collection failed: %v", collectErr)
				writeError(w, http.StatusBadRequest, "USDC collection failed: "+collectErr.Error()+". Ensure you have approved and have sufficient USDC balance.")
				return
			}
			log.Printf("[ExecuteJob] Collected %.2f USDC from %s (tx=%s)", cost, req.Wallet, collectTx)
			payMode = "user"
		} else {
			log.Printf("[ExecuteJob] Signer init failed for collection: %v, using server wallet", signerErr)
		}
	}

	// Use a temp job ID (timestamp-based) so we can respond immediately.
	// The real on-chain jobId will update this record once createJob tx is mined.
	tempJobID := time.Now().UnixNano() / 1e6

	// Record pending job in DB immediately
	ptrStr := func(v string) *string { return &v }
	ptrFloat := func(f float64) *float64 { return &f }
	_ = s.DB.UpsertJob(r.Context(), &db.Job{
		JobID:          tempJobID,
		Employer:       req.Wallet,
		WorkerAgent:    ptrStr(agent.Address),
		JobType:        "OFFCHAIN_AI",
		HourlyRateUSDC: ptrFloat(cost),
		Status:         db.StatusOpen,
		CreatedAt:      time.Now(),
		UpdatedAt:      time.Now(),
	})

	log.Printf("[ExecuteJob] Responding immediately with temp job #%d, launching async on-chain flow", tempJobID)

	// Respond immediately — frontend will poll GET /jobs/{id} for status
	writeJSON(w, http.StatusOK, ExecuteJobResponse{
		JobID:   tempJobID,
		Status:  "submitted",
		PayMode: payMode,
	})

	// Run everything async: on-chain (createJob→setBudget→approve→fund) + agent + settle
	// IMPORTANT: all DB updates use tempJobID so the frontend can track progress via polling.
	go func() {
		defer func() {
			if rec := recover(); rec != nil {
				log.Printf("[ExecuteJob] PANIC in async flow for job #%d: %v", tempJobID, rec)
				job, _ := s.DB.GetJob(context.Background(), tempJobID)
				if job != nil {
					job.Status = db.StatusFailed
					job.UpdatedAt = time.Now()
					_ = s.DB.UpsertJob(context.Background(), job)
				}
			}
		}()

		ctx := context.Background()

		// Phase 1: On-chain (createJob→setBudget→approve→fund)
		log.Printf("[ExecuteJob] Async: starting on-chain flow for job #%d agent %s (%.2f USDC)", tempJobID, agent.Address, cost)

		// Update status to IN_PROGRESS so frontend sees movement
		if job, err := s.DB.GetJob(ctx, tempJobID); err == nil {
			job.Status = db.StatusActive
			job.UpdatedAt = time.Now()
			_ = s.DB.UpsertJob(ctx, job)
		}

		onChainJobID, createTxHash, err := s.ExecuteJobOnChain(ctx, agent.Address, cost, description)
		if err != nil {
			log.Printf("[ExecuteJob] Async: on-chain flow failed for job #%d: %v", tempJobID, err)
			if job, e := s.DB.GetJob(ctx, tempJobID); e == nil {
				job.Status = db.StatusFailed
				job.UpdatedAt = time.Now()
				_ = s.DB.UpsertJob(ctx, job)
			}
			// Refund user if they paid
			if payMode == "user" && req.Wallet != "" {
				log.Printf("[ExecuteJob] Refunding %.2f USDC to %s (job failed)", cost, req.Wallet)
				if refundSigner, sigErr := blockchain.NewSigner(s.ChainClient); sigErr == nil {
					refundTx, refErr := refundSigner.RefundUSDC(ctx, common.HexToAddress(req.Wallet), costRaw)
					if refErr != nil {
						log.Printf("[ExecuteJob] Refund FAILED: %v", refErr)
					} else {
						log.Printf("[ExecuteJob] Refunded to %s tx=%s", req.Wallet, refundTx)
					}
				}
			}
			return
		}

		log.Printf("[ExecuteJob] Async: on-chain done for job #%d (chain jobId=%d, createTx=%s)", tempJobID, onChainJobID, createTxHash)

		// Save createJob tx hash
		if j, e := s.DB.GetJob(ctx, tempJobID); e == nil {
			j.TxHashPosted = &createTxHash
			_ = s.DB.UpsertJob(ctx, j)
		}

		// Phase 2: Run agent + settle
		log.Printf("[ExecuteJob] Async: starting agent execution for job #%d (chain=%d)", tempJobID, onChainJobID)
		s.executeAndSettle(tempJobID, onChainJobID, agent, req.Inputs, payMode)
		log.Printf("[ExecuteJob] Async: fully complete for job #%d", tempJobID)
	}()
}

// executeDelegated performs the full on-chain flow using the user's delegated embedded wallet.
// User's USDC is spent, not the server's.
func (s *Server) executeDelegated(ctx context.Context, pc *privy.Client, wallet *privy.WalletInfo, agent *db.Agent, cost float64, description string) (jobId int64, err error) {
	// Catch panics inside delegated flow
	defer func() {
		if rec := recover(); rec != nil {
			log.Printf("[Delegated] PANIC recovered: %v", rec)
			err = fmt.Errorf("delegated flow panic: %v", rec)
		}
	}()

	serverAddr := s.ChainClient.Address.Hex()
	budgetRaw := new(big.Int).SetInt64(int64(cost * 1e6))
	expiredAt := big.NewInt(time.Now().Unix() + 3600)

	// Step 1: createJob from user wallet (server is provider + evaluator)
	log.Printf("[Delegated] Step 1: createJob from user wallet %s", wallet.Address)
	createResp, err := pc.CreateJob(wallet.ID, serverAddr, serverAddr, expiredAt, description)
	if err != nil {
		return 0, fmt.Errorf("delegated createJob: %w", err)
	}
	log.Printf("[Delegated] createJob tx: %s", createResp.Hash)

	// Wait for Privy tx to be mined — poll by tx hash (no go-ethereum Transaction object)
	log.Printf("[Delegated] Waiting for createJob tx to be mined...")
	for i := 0; i < 15; i++ {
		time.Sleep(3 * time.Second)
		if createResp.Hash != "" {
			receipt, rErr := s.ChainClient.ETH.TransactionReceipt(ctx, common.HexToHash(createResp.Hash))
			if rErr == nil && receipt != nil && receipt.BlockNumber != nil {
				log.Printf("[Delegated] createJob mined in block %d", receipt.BlockNumber.Int64())
				break
			}
		}
	}

	// Get jobId from totalJobs (latest job created)
	commerceABI, _ := abi.JSON(strings.NewReader(`[{"name":"totalJobs","type":"function","stateMutability":"view","inputs":[],"outputs":[{"name":"","type":"uint256"}]}]`))
	commerce := bind.NewBoundContract(common.HexToAddress(privy.CommerceAddress), commerceABI, s.ChainClient.ETH, s.ChainClient.ETH, s.ChainClient.ETH)
	var totalResult []interface{}
	err = commerce.Call(&bind.CallOpts{Context: ctx}, &totalResult, "totalJobs")
	if err != nil {
		return 0, fmt.Errorf("totalJobs query: %w", err)
	}
	if len(totalResult) == 0 || totalResult[0] == nil {
		return 0, fmt.Errorf("totalJobs returned empty result")
	}
	jobId = totalResult[0].(*big.Int).Int64()
	log.Printf("[Delegated] Job ID from totalJobs: %d", jobId)

	// Step 2: setBudget (server wallet — server is provider)
	log.Printf("[Delegated] Step 2: setBudget via server wallet")
	signer, err := blockchain.NewSigner(s.ChainClient)
	if err != nil {
		return jobId, fmt.Errorf("signer init: %w", err)
	}
	_, err = signer.SetBudget(ctx, big.NewInt(jobId), budgetRaw)
	if err != nil {
		return jobId, fmt.Errorf("delegated setBudget: %w", err)
	}

	// Step 3: approve USDC from user wallet
	log.Printf("[Delegated] Step 3: approve USDC from user wallet")
	_, err = pc.ApproveUSDC(wallet.ID, privy.CommerceAddress, budgetRaw)
	if err != nil {
		return jobId, fmt.Errorf("delegated approve: %w", err)
	}
	time.Sleep(3 * time.Second)

	// Step 4: fund from user wallet
	log.Printf("[Delegated] Step 4: fund from user wallet")
	_, err = pc.FundJob(wallet.ID, big.NewInt(jobId), budgetRaw)
	if err != nil {
		return jobId, fmt.Errorf("delegated fund: %w", err)
	}

	log.Printf("[Delegated] Job #%d fully funded from user wallet %s", jobId, wallet.Address)
	return jobId, nil
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}

// ─── GET /wallet/balance ─────────────────────────────────────────────
// Returns the server wallet USDC balance on-chain.

func (s *Server) GetWalletBalance(w http.ResponseWriter, r *http.Request) {
	if s.ChainClient == nil {
		writeError(w, http.StatusInternalServerError, "chain client not configured")
		return
	}

	// Query USDC balance of server wallet
	usdcAddr := common.HexToAddress(usdcAddrHex)
	erc20ABI, err := abi.JSON(strings.NewReader(`[
		{"name":"balanceOf","type":"function","stateMutability":"view",
		 "inputs":[{"name":"account","type":"address"}],
		 "outputs":[{"name":"","type":"uint256"}]}
	]`))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "abi parse error")
		return
	}

	usdc := bind.NewBoundContract(usdcAddr, erc20ABI, s.ChainClient.ETH, s.ChainClient.ETH, s.ChainClient.ETH)

	var result []interface{}
	err = usdc.Call(&bind.CallOpts{Context: r.Context()}, &result, "balanceOf", s.ChainClient.Address)
	if err != nil {
		log.Printf("[WalletBalance] balanceOf call failed: %v", err)
		writeError(w, http.StatusInternalServerError, "balance query failed: "+err.Error())
		return
	}

	balance := new(big.Int)
	if len(result) > 0 {
		if b, ok := result[0].(*big.Int); ok {
			balance = b
		}
	}

	// Convert from 6 decimals
	balFloat := float64(balance.Int64()) / 1e6

	writeJSON(w, http.StatusOK, map[string]any{
		"address":      s.ChainClient.Address.Hex(),
		"usdc_balance": balFloat,
		"usdc_raw":     balance.String(),
	})
}

// ─── POST /jobs/register ──────────────────────────────────────────────
// Registers an on-chain job in the DB before running it.

type RegisterJobRequest struct {
	JobID        string         `json:"job_id"`
	Employer     string         `json:"employer"`
	AgentAddress string         `json:"agent_address"`
	Amount       string         `json:"amount"`
	Input        map[string]any `json:"input"`
}

func (s *Server) RegisterJob(w http.ResponseWriter, r *http.Request) {
	var req RegisterJobRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	jobID, err := strconv.ParseInt(req.JobID, 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid job_id")
		return
	}

	if req.Employer == "" || req.AgentAddress == "" {
		writeError(w, http.StatusBadRequest, "employer and agent_address required")
		return
	}

	// Store input as JSON string in the spec field
	var specStr *string
	if req.Input != nil {
		b, _ := json.Marshal(req.Input)
		s := string(b)
		specStr = &s
	}

	ptrStr := func(v string) *string { return &v }
	amtFloat, _ := strconv.ParseFloat(req.Amount, 64)
	amtUSDC := amtFloat / 1e6
	ptrFloat := func(f float64) *float64 { return &f }

	job := &db.Job{
		JobID:          jobID,
		Employer:       req.Employer,
		WorkerAgent:    ptrStr(req.AgentAddress),
		JobType:        "OFFCHAIN_AI",
		Spec:           specStr,
		HourlyRateUSDC: ptrFloat(amtUSDC),
		Status:         db.StatusOpen,
		CreatedAt:      time.Now(),
		UpdatedAt:      time.Now(),
	}

	if err := s.DB.UpsertJob(r.Context(), job); err != nil {
		log.Printf("[RegisterJob] Failed to upsert job #%d: %v", jobID, err)
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	log.Printf("[RegisterJob] Job #%d registered: employer=%s agent=%s amount=%s",
		jobID, req.Employer, req.AgentAddress, req.Amount)

	writeJSON(w, http.StatusCreated, map[string]any{
		"job_id": jobID,
		"status": "registered",
	})
}

// ─── POST /jobs/{jobID}/set-budget ────────────────────────────────────
// Backend server wallet signs setBudget on the Commerce contract.

type SetBudgetRequest struct {
	AgentAddress string `json:"agent_address"`
	Amount       string `json:"amount"` // raw USDC units (6 decimals), e.g. "100000" = 0.10 USDC
}

type SetBudgetResponse struct {
	TxHash string `json:"tx_hash"`
	JobID  int64  `json:"job_id"`
}

func (s *Server) SetBudgetJob(w http.ResponseWriter, r *http.Request) {
	jobIDStr := chi.URLParam(r, "jobID")
	jobID, err := strconv.ParseInt(jobIDStr, 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid job ID")
		return
	}

	var req SetBudgetRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Amount == "" {
		writeError(w, http.StatusBadRequest, "amount required")
		return
	}

	amount := new(big.Int)
	if _, ok := amount.SetString(req.Amount, 10); !ok {
		writeError(w, http.StatusBadRequest, "invalid amount format")
		return
	}

	signer, err := blockchain.NewSigner(s.ChainClient)
	if err != nil {
		log.Printf("[SetBudget] Signer init failed: %v", err)
		writeError(w, http.StatusInternalServerError, "server wallet not configured")
		return
	}

	txHash, err := signer.SetBudget(r.Context(), big.NewInt(jobID), amount)
	if err != nil {
		log.Printf("[SetBudget] Job #%d failed: %v", jobID, err)
		writeError(w, http.StatusInternalServerError, "setBudget failed: "+err.Error())
		return
	}

	log.Printf("[SetBudget] Job #%d budget set, tx=%s", jobID, txHash)

	// Record job in DB if it doesn't exist
	existing, _ := s.DB.GetJob(r.Context(), jobID)
	if existing == nil {
		ptrStr := func(s string) *string { return &s }
		amtFloat, _ := strconv.ParseFloat(req.Amount, 64)
		amtUSDC := amtFloat / 1e6
		ptrFloat := func(f float64) *float64 { return &f }
		_ = s.DB.UpsertJob(r.Context(), &db.Job{
			JobID:          jobID,
			WorkerAgent:    ptrStr(req.AgentAddress),
			JobType:        "OFFCHAIN_AI",
			HourlyRateUSDC: ptrFloat(amtUSDC),
			Status:         "BUDGET_SET",
			CreatedAt:      time.Now(),
			UpdatedAt:      time.Now(),
		})
	}

	writeJSON(w, http.StatusOK, SetBudgetResponse{
		TxHash: txHash,
		JobID:  jobID,
	})
}

// ─── POST /jobs/{jobID}/run ───────────────────────────────────────────
// Triggered after frontend funds the job.
// Runs the agent, then calls submit() + complete() via server wallet.

type RunJobRequest struct {
	Inputs map[string]any `json:"inputs"`
	Wallet string         `json:"wallet"`
}

type RunJobResponse struct {
	JobID  int64  `json:"job_id"`
	Status string `json:"status"`
}

func (s *Server) RunJobOnChain(w http.ResponseWriter, r *http.Request) {
	jobIDStr := chi.URLParam(r, "jobID")
	jobID, err := strconv.ParseInt(jobIDStr, 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid job ID")
		return
	}

	var req RunJobRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Get job from DB
	job, err := s.DB.GetJob(r.Context(), jobID)
	if err != nil {
		writeError(w, http.StatusNotFound, "job not found in DB")
		return
	}

	if req.Wallet != "" {
		job.Employer = req.Wallet
	}

	// Update job status to IN_PROGRESS
	job.Status = db.StatusActive
	job.UpdatedAt = time.Now()
	_ = s.DB.UpsertJob(r.Context(), job)

	// Get agent info
	agentAddr := ""
	if job.WorkerAgent != nil {
		agentAddr = *job.WorkerAgent
	}
	agent, err := s.DB.GetAgent(r.Context(), agentAddr)
	if err != nil {
		writeError(w, http.StatusNotFound, "agent not found: "+agentAddr)
		return
	}

	// Launch async: run agent -> submit -> complete
	// jobID is already the on-chain job ID in this handler
	go s.executeAndSettle(jobID, jobID, agent, req.Inputs)

	writeJSON(w, http.StatusOK, RunJobResponse{
		JobID:  jobID,
		Status: "executing",
	})
}

// executeAndSettle runs the agent, then calls submit() and complete() on-chain.
// jobID = DB record ID (for status updates). chainJobID = on-chain job ID (for contract calls).
func (s *Server) executeAndSettle(jobID int64, chainJobID int64, agent *db.Agent, inputs map[string]any, paidBy ...string) {
	defer func() {
		if rec := recover(); rec != nil {
			log.Printf("[RunJob] PANIC in executeAndSettle for job #%d: %v", jobID, rec)
			// Mark job as failed on panic
			bgCtx := context.Background()
			if job, err := s.DB.GetJob(bgCtx, jobID); err == nil {
				job.Status = db.StatusFailed
				job.UpdatedAt = time.Now()
				_ = s.DB.UpsertJob(bgCtx, job)
			}
		}
	}()

	// 5-minute timeout for the entire execute+settle flow
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	log.Printf("[RunJob] Starting agent execution for job #%d (chain=%d, agent: %s)", jobID, chainJobID, agent.ID)

	// ─── Execute agent (reuse existing built-in agent logic) ────
	var outputData map[string]any
	var execErr error

	switch agent.ID {
	case "web-intel-agent":
		outputData, execErr = s.runBuiltinWebIntel(ctx, inputs)
	case "crypto-scanner-agent":
		outputData, execErr = s.runBuiltinCryptoScanner(ctx, inputs)
	case "social-sentiment-agent":
		outputData, execErr = s.runBuiltinSentiment(ctx, inputs)
	case "document-digest-agent":
		outputData, execErr = s.runBuiltinDocDigest(ctx, inputs)
	case "report-composer-agent":
		// Run sub-agents first to gather data
		subInputs := inputs
		if metadata, ok := agent.Metadata.(map[string]any); ok {
			if reqAgents, ok := metadata["requires_agents"].([]any); ok {
				log.Printf("[RunJob] Job #%d: running %d sub-agents for report-composer", jobID, len(reqAgents))
				subData := make(map[string]any)
				var wg sync.WaitGroup
				var mu sync.Mutex
				for _, ra := range reqAgents {
					subID, _ := ra.(string)
					if subID == "" {
						continue
					}
					wg.Add(1)
					go func(id string) {
						defer wg.Done()
						log.Printf("[RunJob] Job #%d: sub-agent %s starting (internal, no charge)", jobID, id)
						var subResult map[string]any
						var subErr error
						switch id {
						case "crypto-scanner-agent":
							subResult, subErr = s.runBuiltinCryptoScanner(ctx, inputs)
						case "social-sentiment-agent":
							subResult, subErr = s.runBuiltinSentiment(ctx, inputs)
						}
						if subErr != nil {
							log.Printf("[RunJob] Job #%d: sub-agent %s failed: %v", jobID, id, subErr)
						} else {
							mu.Lock()
							subData[id] = subResult
							mu.Unlock()
							log.Printf("[RunJob] Job #%d: sub-agent %s completed", jobID, id)
						}
					}(subID)
				}
				wg.Wait()
				if len(subData) > 0 {
					subJSON, _ := json.Marshal(subData)
					subInputs = make(map[string]any)
					for k, v := range inputs {
						subInputs[k] = v
					}
					subInputs["sub_agent_data"] = string(subJSON)
				}
			}
		}
		outputData, execErr = s.runBuiltinReportComposer(ctx, subInputs)
	default:
		// Community agent via HTTP endpoint or legacy webhook
		if agent.IsCommunity && agent.EndpointURL != nil && *agent.EndpointURL != "" {
			log.Printf("[RunJob] Job #%d: routing to community agent %s at %s", jobID, agent.ID, *agent.EndpointURL)
			outputData, execErr = agents.RunCommunityAgent(ctx, agent, jobID, inputs)
		} else {
			outputData, execErr = s.runWebhookAgent(ctx, jobID, agent, inputs)
		}
	}

	// Check timeout
	if ctx.Err() != nil {
		log.Printf("[RunJob] Job #%d TIMEOUT after agent execution: %v", jobID, ctx.Err())
		if job, err := s.DB.GetJob(ctx, jobID); err == nil {
			job.Status = db.StatusFailed
			job.UpdatedAt = time.Now()
			_ = s.DB.UpsertJob(context.Background(), job)
		}
		return
	}

	if execErr != nil {
		log.Printf("[RunJob] Job #%d agent execution failed: %v", jobID, execErr)

		// Attempt on-chain cancel to refund escrowed USDC
		var cancelTx string
		signer, signerErr := blockchain.NewSigner(s.ChainClient)
		if signerErr == nil {
			txHash, cancelErr := signer.CancelJob(ctx, big.NewInt(jobID))
			if cancelErr != nil {
				log.Printf("[RunJob] Job #%d cancel() failed: %v", jobID, cancelErr)
			} else {
				cancelTx = txHash
				log.Printf("[RunJob] Job #%d cancelled on-chain, refund tx=%s", jobID, txHash)
			}
		}

		job, _ := s.DB.GetJob(ctx, jobID)
		if job != nil {
			job.Status = db.StatusFailed
			job.UpdatedAt = time.Now()
			_ = s.DB.UpsertJob(ctx, job)
		}
		_ = s.DB.InsertJobEvent(ctx, &db.JobEvent{
			JobID:     jobID,
			EventType: "AGENT_FAILED",
			Data:      map[string]any{"error": execErr.Error(), "cancel_tx": cancelTx},
		})
		return
	}

	log.Printf("[RunJob] Job #%d agent completed, settling on-chain", jobID)

	// ─── Store result in DB ─────────────────────────────────────
	contentHash, _ := store.ComputeContentHash(outputData)
	job, _ := s.DB.GetJob(ctx, jobID)
	if job != nil {
		job.ResultHash = &contentHash
		proofURI := fmt.Sprintf("https://gigawork.ai/store/%s", contentHash)
		job.ProofURI = &proofURI
		job.ResultData = outputData
	}

	// Cache in shared store
	inputHash, _ := store.ComputeInputHash(agent.Address, inputs)
	rate := agent.Pricing.PerCallUSDC
	cacheTTL := 24 * time.Hour
	if agent.TTLSeconds > 0 {
		cacheTTL = time.Duration(agent.TTLSeconds) * time.Second
	}
	_ = s.DB.UpsertStoreEntry(ctx, &db.StoreEntry{
		InputHash:            inputHash,
		AgentID:              agent.Address,
		Output:               outputData,
		OutputSchemaVersion:  "1.0",
		ContentHash:          contentHash,
		ProducedAt:           time.Now(),
		ExpiresAt:            time.Now().Add(cacheTTL),
		OriginalRunPriceUSDC: rate,
		ReusePriceUSDC:       rate * 0.4,
	})

	// ─── On-chain: submit() + complete() ────────────────────────
	signer, err := blockchain.NewSigner(s.ChainClient)
	if err != nil {
		log.Printf("[RunJob] Job #%d signer init failed: %v — marking SETTLED (off-chain only)", jobID, err)
		if job != nil {
			job.Status = db.StatusCompleted
			job.UpdatedAt = time.Now()
			_ = s.DB.UpsertJob(ctx, job)
		}
		return
	}

	chainJobIdBig := big.NewInt(chainJobID)
	log.Printf("[RunJob] Job #%d: calling submit(chainJobId=%d) from server wallet %s", jobID, chainJobID, s.ChainClient.Address.Hex())

	// Compute deliverable hash = keccak256(result JSON)
	resultJSON, _ := json.Marshal(outputData)
	deliverableHash := crypto.Keccak256Hash(resultJSON)
	var deliverable [32]byte
	copy(deliverable[:], deliverableHash.Bytes())
	log.Printf("[RunJob] Job #%d: deliverable=%x", jobID, deliverable)

	// submit() — must be called by provider (server wallet)
	submitTx, submitErr := signer.Submit(ctx, chainJobIdBig, deliverable)
	if submitErr != nil {
		log.Printf("[RunJob] Job #%d submit() REVERTED: %v", jobID, submitErr)
		log.Printf("[RunJob] Job #%d — server wallet=%s, this wallet must be the provider on-chain", jobID, s.ChainClient.Address.Hex())
		if job != nil {
			job.Status = db.StatusFailed
			job.UpdatedAt = time.Now()
			_ = s.DB.UpsertJob(ctx, job)
		}
		_ = s.DB.InsertJobEvent(ctx, &db.JobEvent{
			JobID:     jobID,
			EventType: "SUBMIT_REVERTED",
			Data:      map[string]any{"error": submitErr.Error(), "server_wallet": s.ChainClient.Address.Hex()},
		})
		return
	}
	log.Printf("[RunJob] Job #%d submit() tx=%s", jobID, submitTx)

	// complete() — must be called by evaluator (server wallet)
	completeTx, completeErr := signer.Complete(ctx, chainJobIdBig)
	if completeErr != nil {
		log.Printf("[RunJob] Job #%d complete() REVERTED: %v", jobID, completeErr)
		if job != nil {
			job.Status = db.StatusFailed
			job.UpdatedAt = time.Now()
			_ = s.DB.UpsertJob(ctx, job)
		}
		_ = s.DB.InsertJobEvent(ctx, &db.JobEvent{
			JobID:     jobID,
			EventType: "COMPLETE_REVERTED",
			Data:      map[string]any{"error": completeErr.Error()},
		})
		return
	}
	log.Printf("[RunJob] Job #%d complete() tx=%s", jobID, completeTx)

	// Both on-chain ops succeeded → mark SETTLED
	payLabel := "server"
	if len(paidBy) > 0 && paidBy[0] != "" {
		payLabel = paidBy[0]
	}

	// ─── Revenue split: 80% to agent owner, 20% platform ────────
	ownerShare := rate * 0.8
	platformFee := rate * 0.2
	var ownerPayoutTx string

	if agent.OperatorWallet != "" && agent.OperatorWallet != s.ChainClient.Address.Hex() {
		ownerShareRaw := new(big.Int).SetInt64(int64(ownerShare * 1e6))
		log.Printf("[RunJob] Job #%d: paying agent owner %s → %.2f USDC (80%%)", jobID, agent.OperatorWallet, ownerShare)
		payoutTx, payoutErr := signer.RefundUSDC(ctx, common.HexToAddress(agent.OperatorWallet), ownerShareRaw)
		if payoutErr != nil {
			log.Printf("[RunJob] Job #%d owner payout FAILED: %v (platform keeps full amount)", jobID, payoutErr)
		} else {
			ownerPayoutTx = payoutTx
			log.Printf("[RunJob] Job #%d agent owner paid: %s tx=%s", jobID, agent.OperatorWallet, payoutTx)
		}
	} else {
		log.Printf("[RunJob] Job #%d: agent owner is server wallet, skipping payout", jobID)
	}

	// ─── Save to DB ─────────────────────────────────────────────
	if job != nil {
		job.Status = db.StatusCompleted
		chargedAmount := rate
		job.ActualCharge = &chargedAmount
		job.WorkerPayout = &ownerShare
		job.PlatformFee = &platformFee
		job.BillingUnit = &payLabel
		job.TxHashAccepted = &submitTx
		job.TxHashSettled = &completeTx
		job.UpdatedAt = time.Now()
		_ = s.DB.UpsertJob(ctx, job)
	}

	_ = s.DB.InsertJobEvent(ctx, &db.JobEvent{
		JobID:     jobID,
		EventType: "JOB_SETTLED",
		Data: map[string]any{
			"submit_tx":       submitTx,
			"complete_tx":     completeTx,
			"content_hash":    contentHash,
			"paid_by":         payLabel,
			"amount_usdc":     rate,
			"owner_payout":    ownerShare,
			"platform_fee":    platformFee,
			"owner_payout_tx": ownerPayoutTx,
		},
	})

	log.Printf("[RunJob] Job #%d fully settled (paid_by=%s, total=%.2f, owner=%.2f, platform=%.2f)", jobID, payLabel, rate, ownerShare, platformFee)
}

// ─── Built-in agent runners ─────────────────────────────────────────

func (s *Server) runBuiltinWebIntel(ctx context.Context, inputs map[string]any) (map[string]any, error) {
	urlStr, _ := inputs["url"].(string)
	var fields []string
	if raw, ok := inputs["extract_fields"]; ok {
		if arr, ok := raw.([]any); ok {
			for _, v := range arr {
				if s, ok := v.(string); ok {
					fields = append(fields, s)
				}
			}
		}
	}

	output, err := agents.RunWebIntelAgent(ctx, agents.WebIntelInput{
		URL:           urlStr,
		ExtractFields: fields,
	})
	if err != nil {
		return nil, err
	}

	return map[string]any{
		"url":              output.URL,
		"title":            output.Title,
		"summary":          output.Summary,
		"key_facts":        output.KeyFacts,
		"entities":         output.Entities,
		"published_date":   output.PublishedDate,
		"source_language":  output.SourceLanguage,
		"confidence_score": output.ConfidenceScore,
	}, nil
}

func (s *Server) runBuiltinCryptoScanner(ctx context.Context, inputs map[string]any) (map[string]any, error) {
	deepseekKey := os.Getenv("DEEPSEEK_API_KEY")
	birdeyeKey := os.Getenv("BIRDEYE_API_KEY")

	output, err := agents.RunCryptoScannerAgent(ctx, inputs, deepseekKey, birdeyeKey)
	if err != nil {
		return nil, err
	}

	return map[string]any{
		"token_name":       output.TokenName,
		"symbol":           output.Symbol,
		"price_usd":        output.PriceUSD,
		"market_cap_usd":   output.MarketCapUSD,
		"volume_24h":       output.Volume24h,
		"price_change_24h": output.PriceChange24h,
		"holders":          output.Holders,
		"description":      output.Description,
		"risk_score":       output.RiskScore,
		"risk_factors":     output.RiskFactors,
		"sentiment":        output.Sentiment,
		"summary":          output.Summary,
		"data_sources":     output.DataSources,
	}, nil
}

func (s *Server) runBuiltinSentiment(ctx context.Context, inputs map[string]any) (map[string]any, error) {
	deepseekKey := os.Getenv("DEEPSEEK_API_KEY")

	output, err := agents.RunSocialSentimentAgent(ctx, inputs, deepseekKey)
	if err != nil {
		return nil, err
	}

	return map[string]any{
		"topic":               output.Topic,
		"timeframe":           output.Timeframe,
		"overall_sentiment":   output.OverallSentiment,
		"sentiment_score":     output.SentimentScore,
		"confidence":          output.Confidence,
		"sources":             output.Sources,
		"key_narratives":      output.KeyNarratives,
		"risk_signals":        output.RiskSignals,
		"opportunity_signals": output.OpportunitySignals,
		"summary":             output.Summary,
	}, nil
}

func (s *Server) runBuiltinDocDigest(ctx context.Context, inputs map[string]any) (map[string]any, error) {
	deepseekKey := os.Getenv("DEEPSEEK_API_KEY")
	apifyKey := os.Getenv("APIFY_API_TOKEN")

	output, err := agents.RunDocumentDigestAgent(ctx, inputs, deepseekKey, apifyKey)
	if err != nil {
		return nil, err
	}

	return map[string]any{
		"title":                output.Title,
		"source_url":           output.SourceURL,
		"document_type":        output.DocumentType,
		"word_count":           output.WordCount,
		"reading_time_minutes": output.ReadingTimeMinutes,
		"summary":              output.Summary,
		"key_points":           output.KeyPoints,
		"sections":             output.Sections,
		"entities":             output.Entities,
		"focus_analysis":       output.FocusAnalysis,
		"sentiment":            output.Sentiment,
		"credibility_signals":  output.CredibilitySignals,
		"red_flags":            output.RedFlags,
	}, nil
}

func (s *Server) runBuiltinReportComposer(ctx context.Context, inputs map[string]any) (map[string]any, error) {
	deepseekKey := os.Getenv("DEEPSEEK_API_KEY")
	birdeyeKey := os.Getenv("BIRDEYE_API_KEY")

	output, err := agents.RunReportComposerAgent(ctx, inputs, deepseekKey, birdeyeKey, "")
	if err != nil {
		return nil, err
	}

	return map[string]any{
		"title":             output.Title,
		"report_type":       output.ReportType,
		"topic":             output.Topic,
		"generated_at":      output.GeneratedAt,
		"word_count":        output.WordCount,
		"executive_summary": output.ExecutiveSummary,
		"sections":          output.Sections,
		"key_findings":      output.KeyFindings,
		"risks":             output.Risks,
		"opportunities":     output.Opportunities,
		"conclusion":        output.Conclusion,
		"data_sources_used": output.DataSourcesUsed,
		"confidence_score":  output.ConfidenceScore,
	}, nil
}

func (s *Server) runWebhookAgent(ctx context.Context, jobID int64, agent *db.Agent, inputs map[string]any) (map[string]any, error) {
	webhookURL := ""
	if agent.WebhookURI != nil {
		webhookURL = *agent.WebhookURI
	}
	if webhookURL == "" {
		webhookURL = "http://127.0.0.1:8181/api/webhooks/dummy"
	}

	packet := JobPacket{
		SchemaVersion: "1.0",
		JobID:         jobID,
		Mode:          "execute",
		AgentID:       agent.ID,
		TaskType:      "OFFCHAIN_AI",
		Inputs:        inputs,
	}
	packetBytes, _ := json.Marshal(packet)

	req, _ := http.NewRequest("POST", webhookURL, bytes.NewBuffer(packetBytes))
	req.Header.Set("Content-Type", "application/json")
	s.setWebhookSignature(req, packetBytes)

	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("webhook dispatch failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("webhook returned status %d", resp.StatusCode)
	}

	// For webhook agents, we wait for them to POST back to /jobs/{id}/submit
	// Poll DB for result
	for i := 0; i < 60; i++ {
		time.Sleep(5 * time.Second)
		job, err := s.DB.GetJob(ctx, jobID)
		if err == nil && job.ResultHash != nil && *job.ResultHash != "" {
			// Result was submitted via webhook callback
			entry, err := s.DB.GetStoreEntry(ctx, fmt.Sprintf("job_input_%d", jobID))
			if err == nil {
				if m, ok := entry.Output.(map[string]any); ok {
					return m, nil
				}
			}
			return map[string]any{"status": "completed", "result_hash": *job.ResultHash}, nil
		}
		if err == nil && job.Status == db.StatusFailed {
			return nil, fmt.Errorf("agent execution failed")
		}
	}

	return nil, fmt.Errorf("agent execution timed out after 5 minutes")
}
