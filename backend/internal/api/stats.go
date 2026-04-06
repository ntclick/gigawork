package api

import (
	"net/http"
)

type StatsResponse struct {
	TotalJobs       int     `json:"total_jobs"`
	TotalAgents     int     `json:"total_agents"`
	ActiveJobs      int     `json:"active_jobs"`
	TotalSettledUSD float64 `json:"total_settled_usdc"`
}

// GET /stats
func (s *Server) GetStats(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	// Total agents
	agents, err := s.DB.ListAgents(ctx, false, "")
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// All jobs
	allJobs, err := s.DB.ListJobs(ctx, "", "", "")
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	activeJobs := 0
	totalSettled := 0.0

	for _, j := range allJobs {
		switch j.Status {
		case "OPEN", "MATCHING", "IN_PROGRESS", "PENDING_REVIEW":
			activeJobs++
		case "SETTLED":
			if j.WorkerPayout != nil {
				totalSettled += *j.WorkerPayout
			}
			if j.PlatformFee != nil {
				totalSettled += *j.PlatformFee
			}
		}
	}

	writeJSON(w, http.StatusOK, StatsResponse{
		TotalJobs:       len(allJobs),
		TotalAgents:     len(agents),
		ActiveJobs:      activeJobs,
		TotalSettledUSD: totalSettled,
	})
}
