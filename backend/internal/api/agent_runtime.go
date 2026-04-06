package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"gigawork/internal/agents"
	"gigawork/internal/db"
	"gigawork/internal/store"

	"github.com/go-chi/chi/v5"
)

type JobPacket struct {
	SchemaVersion string         `json:"schema_version"`
	JobID         int64          `json:"job_id"`
	Mode          string         `json:"mode"`
	AgentID       string         `json:"agent_id"`
	TaskType      string         `json:"task_type"`
	Inputs        map[string]any `json:"inputs"`
	Wallet        string         `json:"wallet"`
	PaymentTxHash string         `json:"payment_tx_hash,omitempty"`
	UseBalance    bool           `json:"use_balance,omitempty"`
}

type RunAgentResponse struct {
	JobID       int64     `json:"job_id"`
	Status      string    `json:"status"` // success | failed | cached
	StoreID     string    `json:"store_id,omitempty"`
	ContentHash string    `json:"content_hash,omitempty"`
	Output      any       `json:"output"`
	ChargedUSDC float64   `json:"charged_usdc"`
	CacheHit    bool      `json:"cache_hit"`
	ProducedAt  time.Time `json:"produced_at"`
}

// POST /agents/{address}/run
func (s *Server) RunAgent(w http.ResponseWriter, r *http.Request) {
	address := chi.URLParam(r, "address")
	var req JobPacket
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	log.Printf("[RunAgent] Wallet: %s, Agent: %s, Input: %v", req.Wallet, address, req.Inputs)

	agent, err := s.DB.GetAgent(r.Context(), address)
	if err != nil {
		writeError(w, http.StatusNotFound, "agent not found")
		return
	}

	// 0. Platform balance check + debit
	jobCost := agent.Pricing.PerCallUSDC
	if req.UseBalance && req.Wallet != "" && jobCost > 0 {
		balance, _ := s.DB.GetBalance(r.Context(), req.Wallet)
		if balance < jobCost {
			writeError(w, http.StatusPaymentRequired, fmt.Sprintf("insufficient balance: have %.2f, need %.2f USDC", balance, jobCost))
			return
		}
		if err := s.DB.DebitBalance(r.Context(), req.Wallet, jobCost); err != nil {
			writeError(w, http.StatusInternalServerError, "balance debit failed: "+err.Error())
			return
		}
		log.Printf("[RunAgent] Debited %.6f USDC from %s balance (remaining: %.6f)", jobCost, req.Wallet, balance-jobCost)

		// Execute on-chain via server wallet (async, don't block response)
		go func() {
			onChainJobId, _, err := s.ExecuteJobOnChain(context.Background(), agent.Address, jobCost, "GigaWork Platform Job")
			if err != nil {
				log.Printf("[RunAgent] Server on-chain execution failed: %v (balance already debited)", err)
			} else {
				log.Printf("[RunAgent] Server on-chain job #%d created for %s", onChainJobId, agent.Address)
			}
		}()
	}

	// 1. Compute Input Hash for Caching
	inputHash, _ := store.ComputeInputHash(address, req.Inputs)

	// 2. Check Shared Store (Cache)
	cachedEntry, err := s.DB.GetStoreEntry(r.Context(), inputHash)
	if err == nil && time.Now().Before(cachedEntry.ExpiresAt) {
		writeJSON(w, http.StatusOK, RunAgentResponse{
			JobID:       req.JobID,
			Status:      "cached",
			StoreID:     cachedEntry.ID,
			ContentHash: cachedEntry.ContentHash,
			Output:      cachedEntry.Output,
			ChargedUSDC: agent.Pricing.ReusePriceUSDC,
			CacheHit:    true,
			ProducedAt:  cachedEntry.ProducedAt,
		})
		return
	}

	// 3. Dispatch to Agent Webhook (Async with Retries)
	webhookURL := ""
	if agent.WebhookURI != nil {
		webhookURL = *agent.WebhookURI
	}
	if webhookURL == "" {
		webhookURL = "http://127.0.0.1:8181/api/webhooks/dummy"
	}

	if req.SchemaVersion == "" {
		req.SchemaVersion = "1.0"
	}

	if req.JobID == 0 {
		req.JobID = time.Now().UnixNano() / 1e6
	}

	// Declare before goto targets to avoid "jumps over declaration" error
	var packetBytes []byte

	// ─── Built-in agent: web-intel-agent ─────────────────────
	// Route to real execution code instead of webhook dispatch
	if agent.ID == "web-intel-agent" {
		go func(jID int64, inputs map[string]any) {
			log.Printf("[WebIntel] Starting built-in execution for job %d", jID)

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

			ctx := context.Background()
			output, err := agents.RunWebIntelAgent(ctx, agents.WebIntelInput{
				URL:           urlStr,
				ExtractFields: fields,
			})

			if err != nil {
				log.Printf("[WebIntel] Job %d execution failed: %v", jID, err)
				job, dbErr := s.DB.GetJob(ctx, jID)
				if dbErr == nil {
					job.Status = db.StatusFailed
					job.UpdatedAt = time.Now()
					_ = s.DB.UpsertJob(ctx, job)
				}
				_ = s.DB.InsertJobEvent(ctx, &db.JobEvent{
					JobID:     jID,
					EventType: "AGENT_FAILED",
					Data:      map[string]any{"error": err.Error()},
				})
				return
			}

			log.Printf("[WebIntel] Job %d completed, submitting result", jID)

			// Submit result through the same path as webhook agents
			outputData := map[string]any{
				"url":              output.URL,
				"title":            output.Title,
				"summary":          output.Summary,
				"key_facts":        output.KeyFacts,
				"entities":         output.Entities,
				"published_date":   output.PublishedDate,
				"source_language":  output.SourceLanguage,
				"confidence_score": output.ConfidenceScore,
			}
			contentHash, _ := store.ComputeContentHash(outputData)

			submitPayload, _ := json.Marshal(map[string]any{
				"content_hash": contentHash,
				"output_data":  outputData,
			})

			submitURL := fmt.Sprintf("http://127.0.0.1:8181/api/jobs/%d/submit", jID)
			submitReq, _ := http.NewRequest("POST", submitURL, bytes.NewBuffer(submitPayload))
			submitReq.Header.Set("Content-Type", "application/json")
			s.setWebhookSignature(submitReq, submitPayload)

			client := &http.Client{Timeout: 10 * time.Second}
			resp, err := client.Do(submitReq)
			if err != nil {
				log.Printf("[WebIntel] Job %d submit POST failed: %v", jID, err)
			} else {
				resp.Body.Close()
				log.Printf("[WebIntel] Job %d result submitted, status %s", jID, resp.Status)
			}
		}(req.JobID, req.Inputs)

		goto recordJob
	}

	// ─── Built-in agent: crypto-scanner-agent ────────────────
	if agent.ID == "crypto-scanner-agent" {
		go func(jID int64, inputs map[string]any) {
			log.Printf("[CryptoScanner] Starting built-in execution for job %d", jID)

			ctx := context.Background()
			deepseekKey := os.Getenv("DEEPSEEK_API_KEY")
			birdeyeKey := os.Getenv("BIRDEYE_API_KEY")

			output, err := agents.RunCryptoScannerAgent(ctx, inputs, deepseekKey, birdeyeKey)
			if err != nil {
				log.Printf("[CryptoScanner] Job %d execution failed: %v", jID, err)
				job, dbErr := s.DB.GetJob(ctx, jID)
				if dbErr == nil {
					job.Status = db.StatusFailed
					job.UpdatedAt = time.Now()
					_ = s.DB.UpsertJob(ctx, job)
				}
				_ = s.DB.InsertJobEvent(ctx, &db.JobEvent{
					JobID:     jID,
					EventType: "AGENT_FAILED",
					Data:      map[string]any{"error": err.Error()},
				})
				return
			}

			log.Printf("[CryptoScanner] Job %d completed: %s (%s)", jID, output.TokenName, output.Symbol)

			outputData := map[string]any{
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
			}
			contentHash, _ := store.ComputeContentHash(outputData)

			submitPayload, _ := json.Marshal(map[string]any{
				"content_hash": contentHash,
				"output_data":  outputData,
			})

			submitURL := fmt.Sprintf("http://127.0.0.1:8181/api/jobs/%d/submit", jID)
			submitReq, _ := http.NewRequest("POST", submitURL, bytes.NewBuffer(submitPayload))
			submitReq.Header.Set("Content-Type", "application/json")
			s.setWebhookSignature(submitReq, submitPayload)

			client := &http.Client{Timeout: 10 * time.Second}
			resp, err := client.Do(submitReq)
			if err != nil {
				log.Printf("[CryptoScanner] Job %d submit POST failed: %v", jID, err)
			} else {
				resp.Body.Close()
				log.Printf("[CryptoScanner] Job %d result submitted, status %s", jID, resp.Status)
			}
		}(req.JobID, req.Inputs)

		goto recordJob
	}

	// ─── Built-in agent: social-sentiment-agent ──────────────
	if agent.ID == "social-sentiment-agent" {
		go func(jID int64, inputs map[string]any) {
			log.Printf("[Sentiment] Starting built-in execution for job %d", jID)

			ctx := context.Background()
			deepseekKey := os.Getenv("DEEPSEEK_API_KEY")

			output, err := agents.RunSocialSentimentAgent(ctx, inputs, deepseekKey)
			if err != nil {
				log.Printf("[Sentiment] Job %d execution failed: %v", jID, err)
				job, dbErr := s.DB.GetJob(ctx, jID)
				if dbErr == nil {
					job.Status = db.StatusFailed
					job.UpdatedAt = time.Now()
					_ = s.DB.UpsertJob(ctx, job)
				}
				_ = s.DB.InsertJobEvent(ctx, &db.JobEvent{
					JobID:     jID,
					EventType: "AGENT_FAILED",
					Data:      map[string]any{"error": err.Error()},
				})
				return
			}

			log.Printf("[Sentiment] Job %d completed: %s → %s (score %d)",
				jID, output.Topic, output.OverallSentiment, output.SentimentScore)

			outputData := map[string]any{
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
			}
			contentHash, _ := store.ComputeContentHash(outputData)

			submitPayload, _ := json.Marshal(map[string]any{
				"content_hash": contentHash,
				"output_data":  outputData,
			})

			submitURL := fmt.Sprintf("http://127.0.0.1:8181/api/jobs/%d/submit", jID)
			submitReq, _ := http.NewRequest("POST", submitURL, bytes.NewBuffer(submitPayload))
			submitReq.Header.Set("Content-Type", "application/json")
			s.setWebhookSignature(submitReq, submitPayload)

			client := &http.Client{Timeout: 10 * time.Second}
			resp, err := client.Do(submitReq)
			if err != nil {
				log.Printf("[Sentiment] Job %d submit POST failed: %v", jID, err)
			} else {
				resp.Body.Close()
				log.Printf("[Sentiment] Job %d result submitted, status %s", jID, resp.Status)
			}
		}(req.JobID, req.Inputs)

		goto recordJob
	}

	// ─── Built-in agent: document-digest-agent ───────────────
	if agent.ID == "document-digest-agent" {
		go func(jID int64, inputs map[string]any) {
			log.Printf("[Digest] Starting built-in execution for job %d", jID)

			ctx := context.Background()
			deepseekKey := os.Getenv("DEEPSEEK_API_KEY")
			apifyKey := os.Getenv("APIFY_API_TOKEN")

			output, err := agents.RunDocumentDigestAgent(ctx, inputs, deepseekKey, apifyKey)
			if err != nil {
				log.Printf("[Digest] Job %d execution failed: %v", jID, err)
				job, dbErr := s.DB.GetJob(ctx, jID)
				if dbErr == nil {
					job.Status = db.StatusFailed
					job.UpdatedAt = time.Now()
					_ = s.DB.UpsertJob(ctx, job)
				}
				_ = s.DB.InsertJobEvent(ctx, &db.JobEvent{
					JobID:     jID,
					EventType: "AGENT_FAILED",
					Data:      map[string]any{"error": err.Error()},
				})
				return
			}

			log.Printf("[Digest] Job %d completed: %s (%d words)", jID, output.Title, output.WordCount)

			outputData := map[string]any{
				"title":                output.Title,
				"source_url":           output.SourceURL,
				"document_type":        output.DocumentType,
				"word_count":           output.WordCount,
				"reading_time_minutes": output.ReadingTimeMinutes,
				"summary":             output.Summary,
				"key_points":          output.KeyPoints,
				"sections":            output.Sections,
				"entities":            output.Entities,
				"focus_analysis":      output.FocusAnalysis,
				"sentiment":           output.Sentiment,
				"credibility_signals": output.CredibilitySignals,
				"red_flags":           output.RedFlags,
			}
			contentHash, _ := store.ComputeContentHash(outputData)

			submitPayload, _ := json.Marshal(map[string]any{
				"content_hash": contentHash,
				"output_data":  outputData,
			})

			submitURL := fmt.Sprintf("http://127.0.0.1:8181/api/jobs/%d/submit", jID)
			submitReq, _ := http.NewRequest("POST", submitURL, bytes.NewBuffer(submitPayload))
			submitReq.Header.Set("Content-Type", "application/json")
			s.setWebhookSignature(submitReq, submitPayload)

			client := &http.Client{Timeout: 10 * time.Second}
			resp, err := client.Do(submitReq)
			if err != nil {
				log.Printf("[Digest] Job %d submit POST failed: %v", jID, err)
			} else {
				resp.Body.Close()
				log.Printf("[Digest] Job %d result submitted, status %s", jID, resp.Status)
			}
		}(req.JobID, req.Inputs)

		goto recordJob
	}

	// ─── Built-in agent: report-composer-agent ───────────────
	if agent.ID == "report-composer-agent" {
		go func(jID int64, inputs map[string]any) {
			log.Printf("[Composer] Starting built-in execution for job %d", jID)

			ctx := context.Background()
			deepseekKey := os.Getenv("DEEPSEEK_API_KEY")
			birdeyeKey := os.Getenv("BIRDEYE_API_KEY")
			apifyKey := os.Getenv("APIFY_API_TOKEN")
			_ = apifyKey // reserved for future web content gathering

			output, err := agents.RunReportComposerAgent(ctx, inputs, deepseekKey, birdeyeKey, "")
			if err != nil {
				log.Printf("[Composer] Job %d execution failed: %v", jID, err)
				job, dbErr := s.DB.GetJob(ctx, jID)
				if dbErr == nil {
					job.Status = db.StatusFailed
					job.UpdatedAt = time.Now()
					_ = s.DB.UpsertJob(ctx, job)
				}
				_ = s.DB.InsertJobEvent(ctx, &db.JobEvent{
					JobID:     jID,
					EventType: "AGENT_FAILED",
					Data:      map[string]any{"error": err.Error()},
				})
				return
			}

			log.Printf("[Composer] Job %d completed: %s (%d words, confidence %.2f)",
				jID, output.Title, output.WordCount, output.ConfidenceScore)

			outputData := map[string]any{
				"title":             output.Title,
				"report_type":      output.ReportType,
				"topic":            output.Topic,
				"generated_at":     output.GeneratedAt,
				"word_count":       output.WordCount,
				"executive_summary": output.ExecutiveSummary,
				"sections":         output.Sections,
				"key_findings":     output.KeyFindings,
				"risks":            output.Risks,
				"opportunities":    output.Opportunities,
				"conclusion":       output.Conclusion,
				"data_sources_used": output.DataSourcesUsed,
				"confidence_score": output.ConfidenceScore,
			}
			contentHash, _ := store.ComputeContentHash(outputData)

			submitPayload, _ := json.Marshal(map[string]any{
				"content_hash": contentHash,
				"output_data":  outputData,
			})

			submitURL := fmt.Sprintf("http://127.0.0.1:8181/api/jobs/%d/submit", jID)
			submitReq, _ := http.NewRequest("POST", submitURL, bytes.NewBuffer(submitPayload))
			submitReq.Header.Set("Content-Type", "application/json")
			s.setWebhookSignature(submitReq, submitPayload)

			client := &http.Client{Timeout: 60 * time.Second}
			resp, err := client.Do(submitReq)
			if err != nil {
				log.Printf("[Composer] Job %d submit POST failed: %v", jID, err)
			} else {
				resp.Body.Close()
				log.Printf("[Composer] Job %d result submitted, status %s", jID, resp.Status)
			}
		}(req.JobID, req.Inputs)

		goto recordJob
	}

	packetBytes, _ = json.Marshal(req)

	go func(pktBytes []byte, url string, jID int64) {
		maxRetries := 3
		backoff := 2 * time.Second
		var lastErr string

		for i := 0; i < maxRetries; i++ {
			req, _ := http.NewRequest("POST", url, bytes.NewBuffer(pktBytes))
			req.Header.Set("Content-Type", "application/json")
			s.setWebhookSignature(req, pktBytes)

			client := &http.Client{Timeout: 15 * time.Second}
			resp, err := client.Do(req)

			if err == nil && resp.StatusCode == http.StatusOK {
				log.Printf("[Webhook] Successfully dispatched Job %d to %s", jID, url)
				resp.Body.Close()
				return
			}

			if err != nil {
				lastErr = err.Error()
			} else {
				lastErr = fmt.Sprintf("HTTP %d", resp.StatusCode)
			}

			if resp != nil {
				resp.Body.Close()
			}

			log.Printf("[Webhook] Dispatch failed for Job %d (Attempt %d/%d): %s, retrying in %v...", jID, i+1, maxRetries, lastErr, backoff)
			time.Sleep(backoff)
			backoff *= 2
		}

		log.Printf("[Webhook] Job %d failed all %d retry attempts. Marking as FAILED.", jID, maxRetries)

		ctx := context.Background()

		// Update job status to FAILED
		job, err := s.DB.GetJob(ctx, jID)
		if err == nil {
			job.Status = db.StatusFailed
			job.UpdatedAt = time.Now()
			if err := s.DB.UpsertJob(ctx, job); err != nil {
				log.Printf("[Webhook] Failed to mark job %d as FAILED in DB: %v", jID, err)
			}
		}

		// Record failure event
		errMsg := fmt.Sprintf("Webhook %s failed after %d retries: %s", url, maxRetries, lastErr)
		_ = s.DB.InsertJobEvent(ctx, &db.JobEvent{
			JobID:     jID,
			EventType: "WEBHOOK_FAILED",
			Data:      map[string]any{"error": errMsg, "webhook_url": url, "retries": maxRetries},
		})
	}(packetBytes, webhookURL, req.JobID)

recordJob:
	// 4. Record the Job/Mission for the Dashboard
	// If job already exists in DB (e.g. created by frontend POST /api/jobs), skip creation
	ptrString := func(s string) *string { return &s }
	ptrFloat := func(f float64) *float64 { return &f }

	existingJob, _ := s.DB.GetJob(r.Context(), req.JobID)
	if existingJob == nil {
		if err := s.DB.UpsertJob(r.Context(), &db.Job{
			JobID:          req.JobID,
			Employer:       req.Wallet,
			WorkerAgent:    ptrString(agent.Address),
			JobType:        "OFFCHAIN_AI",
			HourlyRateUSDC: ptrFloat(agent.Pricing.PerCallUSDC),
			MetadataHash:   ptrString(inputHash),
			Status:         db.StatusActive,
			CreatedAt:      time.Now(),
			UpdatedAt:      time.Now(),
		}); err != nil {
			log.Printf("[RunAgent] Failed to UpsertJob: %v", err)
		}
	} else {
		log.Printf("[RunAgent] Job %d already exists in DB, skipping creation", req.JobID)
	}

	writeJSON(w, http.StatusOK, RunAgentResponse{
		JobID:       req.JobID,
		Status:      "submitted",
		ChargedUSDC: agent.Pricing.PerCallUSDC,
		CacheHit:    false,
		ProducedAt:  time.Now(),
	})
}

// POST /agents/{address}/preview
func (s *Server) PreviewAgent(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"preview": "This is a partial preview of the agent output.",
		"cost":    0,
	})
}

// POST /agents/{address}/trial
func (s *Server) TrialAgent(w http.ResponseWriter, r *http.Request) {
	address := chi.URLParam(r, "address")
	var req JobPacket
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Check eligibility
	_, err := s.DB.GetTrialRun(r.Context(), req.Wallet, address)
	if err == nil {
		writeError(w, http.StatusForbidden, "TRIAL_EXHAUSTED")
		return
	}

	// Record trial usage
	_ = s.DB.RecordTrialRun(r.Context(), &db.TrialRun{
		Wallet:  req.Wallet,
		AgentID: address,
		UsedAt:  time.Now(),
	})

	log.Printf("[TrialAgent] Wallet: %s, Agent: %s", req.Wallet, address)

	// NEW: Record Trial Mission for Dashboard
	ptrString := func(s string) *string { return &s }
	ptrFloat := func(f float64) *float64 { return &f }
	trialJobID := time.Now().UnixNano() / 1e6
	_ = s.DB.UpsertJob(r.Context(), &db.Job{
		JobID:          trialJobID,
		Employer:       req.Wallet,
		WorkerAgent:    ptrString(address),
		JobType:        "OFFCHAIN_AI",
		HourlyRateUSDC: ptrFloat(0.0),
		Status:         db.StatusTrialCompleted,
		CreatedAt:      time.Now(),
		UpdatedAt:      time.Now(),
	})

	writeJSON(w, http.StatusOK, map[string]any{
		"job_id": trialJobID,
		"status": "success",
		"output": "[TRIAL] This is your one-time free trial output from " + address,
	})
}

// GET /agents/{address}/trial-eligibility
func (s *Server) CheckTrialEligibility(w http.ResponseWriter, r *http.Request) {
	address := chi.URLParam(r, "address")
	wallet := r.URL.Query().Get("wallet")
	if wallet == "" {
		writeError(w, http.StatusBadRequest, "wallet param required")
		return
	}

	_, err := s.DB.GetTrialRun(r.Context(), wallet, address)
	eligible := err != nil // If err is not nil, no trial found -> eligible
	
	writeJSON(w, http.StatusOK, map[string]any{
		"eligible": eligible,
		"reason":   func() string { if !eligible { return "TRIAL_EXHAUSTED" }; return "OK" }(),
	})
}

// GET /agents/{address}/outputs/{storeID}
func (s *Server) GetStoredOutput(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"message": "Feature coming soon"})
}
