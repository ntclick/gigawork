package api

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
)

// GetPlatformAnalytics handles GET /api/analytics/platform
// Here we could query the platform_metrics table, or compute dynamically.
func (s *Server) GetPlatformAnalytics(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	
	// Example: just grab the overall stats we already compute + placeholder for the new series data
	// In a complete implementation, this would query the `platform_metrics` table
	
	// Getting total agents
	agents, err := s.DB.ListAgents(ctx, false, "")
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	allJobs, err := s.DB.ListJobs(ctx, "", "", "")
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	var totalSettledUSD float64
	for _, j := range allJobs {
		if j.Status == "SETTLED" {
			if j.WorkerPayout != nil {
				totalSettledUSD += *j.WorkerPayout
			}
			if j.PlatformFee != nil {
				totalSettledUSD += *j.PlatformFee
			}
		}
	}

	response := map[string]interface{}{
		"total_agents":       len(agents),
		"total_jobs":         len(allJobs),
		"total_settled_usdc": totalSettledUSD,
		// Placeholder for time-series data which the UI might expect
		"daily_metrics": []interface{}{},
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// GetAgentAnalytics handles GET /api/analytics/agent/{address}
func (s *Server) GetAgentAnalytics(w http.ResponseWriter, r *http.Request) {
	address := chi.URLParam(r, "address")
	if address == "" {
		writeError(w, http.StatusBadRequest, "agent address is required")
		return
	}
	
	ctx := r.Context()
	agent, err := s.DB.GetAgent(ctx, address)
	if err != nil {
		writeError(w, http.StatusNotFound, "agent not found")
		return
	}

	// Just return the agent object augmented with analytics fields
	response := map[string]interface{}{
		"address": agent.Address,
		"reputation": agent.ReputationScore,
		"total_jobs_done": agent.TotalJobsDone,
		"total_earned": agent.TotalEarnedUSDC,
		"dispute_count": agent.DisputeCount,
		"win_rate": agent.WinRate,
		"total_bids": agent.TotalBids,
		"avg_response_s": agent.AvgResponseTimeS,
		"avg_complete_s": agent.AvgCompletionTimeS,
		"last_active": agent.LastActiveAt,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}
