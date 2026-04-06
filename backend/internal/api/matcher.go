package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"sort"
	"time"

	"gigawork/internal/db"
)

type MatcherRequest struct {
	JobID        int64     `json:"job_id"`
	TaskType     string    `json:"task_type"`
	Goal         string    `json:"goal"`
	OutputFormat string    `json:"output_format"`
	Deadline     time.Time `json:"deadline"`
	BudgetUSDC   float64   `json:"budget_usdc"`
}

type MatchResult struct {
	Rank            int     `json:"rank"`
	AgentID         string  `json:"agent_id"`
	AgentName       string  `json:"agent_name"`
	MatchScore      float64 `json:"match_score"`
	CapabilityMatch float64 `json:"capability_match"`
	TrustScore      float64 `json:"trust_score"`
	ReuseAvailable  bool    `json:"reuse_available"`
	Reason          string  `json:"reason"`
}

type MatcherResponse struct {
	JobID             int64         `json:"job_id"`
	Matches           []MatchResult `json:"matches"`
	AutoAssignAt      time.Time     `json:"auto_assign_at"`
	TopRecommendation string        `json:"top_recommendation"`
}

func (s *Server) MatchAgents(w http.ResponseWriter, r *http.Request) {
	var req MatcherRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// 1. Fetch All Active Agents
	agents, err := s.DB.ListAgents(r.Context(), true, "")
	if err != nil {
		http.Error(w, "Failed to list agents: "+err.Error(), http.StatusInternalServerError)
		return
	}

	var results []MatchResult
	for _, agent := range agents {
		if agent.IsSystem {
			continue // Skip system agents like Matcher
		}

		// 2. Score Match (Logic from spec)
		// match_score = (capability_match * 0.40 + trust_score_norm * 0.25 + availability * 0.15 + reuse_potential * 0.10 + price_fit * 0.10) * 100
		
		capMatch, reason, _ := s.scoreCapabilityMatch(r.Context(), agent, req)
		
		trustScoreNorm := agent.TrustScore / 100.0
		availability := 1.0 // Default for demo: 1.0 (available)
		reusePotential := 0.0 // Default for demo: 0.0
		
		priceFit := 1.0
		if agent.Pricing.PerCallUSDC > req.BudgetUSDC {
			if agent.Pricing.PerCallUSDC <= req.BudgetUSDC*1.5 {
				priceFit = 0.5
			} else {
				priceFit = 0.0
			}
		}

		matchScore := (capMatch*0.40 + trustScoreNorm*0.25 + availability*0.15 + reusePotential*0.10 + priceFit*0.10) * 100

		results = append(results, MatchResult{
			AgentID:         agent.ID,
			AgentName:       agent.Name,
			MatchScore:      matchScore,
			CapabilityMatch: capMatch,
			TrustScore:      agent.TrustScore,
			ReuseAvailable:  false,
			Reason:          reason,
		})
	}

	// Sort by matchScore descending
	sort.Slice(results, func(i, j int) bool {
		return results[i].MatchScore > results[j].MatchScore
	})

	// Limit to top 5
	if len(results) > 5 {
		results = results[:5]
	}

	// Assign ranks
	for i := range results {
		results[i].Rank = i + 1
	}

	if len(results) == 0 {
		writeError(w, http.StatusNotFound, "No matching agents found for this task")
		return
	}

	resp := MatcherResponse{
		JobID:             req.JobID,
		Matches:           results,
		AutoAssignAt:      time.Now().Add(5 * time.Minute),
		TopRecommendation: results[0].AgentID,
	}

	json.NewEncoder(w).Encode(resp)
}

func (s *Server) ActionAssignAgent(w http.ResponseWriter, r *http.Request) {
	// Logic to assign agent to job
	// POST /api/jobs/{id}/assign
	json.NewEncoder(w).Encode(map[string]string{"status": "assigned"})
}

// ─── DeepSeek Integration ─────────────────────────────────

func (s *Server) scoreCapabilityMatch(ctx context.Context, agent db.Agent, job MatcherRequest) (float64, string, error) {
	apiKey := os.Getenv("DEEPSEEK_API_KEY")
	if apiKey == "" {
		return 0.8, "DeepSeek API Key not configured. Using fallback score.", nil
	}

	payload := map[string]any{
		"model": "deepseek-chat",
		"messages": []map[string]string{
			{
				"role": "system",
				"content": "You are an agent matching system. Score how well the agent can handle this job. Return JSON only: {\"relevance_score\": 0.0, \"reason\": \"one sentence\"}",
			},
			{
				"role": "user",
				"content": fmt.Sprintf("JOB: type=%s, goal=%s, output=%s\nAGENT: name=%s, description=%s, cap=%v", 
					job.TaskType, job.Goal, job.OutputFormat, agent.Name, agent.Description, agent.Capabilities),
			},
		},
		"temperature": 0.1,
	}

	body, _ := json.Marshal(payload)
	req, _ := http.NewRequestWithContext(ctx, "POST", "https://api.deepseek.com/v1/chat/completions", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return 0.5, "Network error during scoring.", nil
	}
	defer resp.Body.Close()

	var dsResp struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&dsResp); err != nil || len(dsResp.Choices) == 0 {
		return 0.5, "Failed to parse DeepSeek response.", nil
	}

	var scoreData struct {
		Relevance float64 `json:"relevance_score"`
		Reason    string  `json:"reason"`
	}
	// Extract JSON from potential markdown blocks
	content := dsResp.Choices[0].Message.Content
	if err := json.Unmarshal([]byte(content), &scoreData); err != nil {
		return 0.7, "Capability appears relevant but structured scoring failed.", nil
	}

	return scoreData.Relevance, scoreData.Reason, nil
}
