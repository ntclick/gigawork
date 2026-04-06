package api

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"gigawork/internal/db"
)

type RatingRequest struct {
	JobID   int64  `json:"job_id"`
	AgentID string `json:"agent_id"`
	Wallet  string `json:"wallet"`
	Stars   int    `json:"stars"`
	Comment string `json:"comment"`
}

func (s *Server) SubmitRating(w http.ResponseWriter, r *http.Request) {
	var req RatingRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	rating := &db.AgentRating{
		JobID:     req.JobID,
		AgentID:   req.AgentID,
		Wallet:    req.Wallet,
		Stars:     req.Stars,
		Comment:   req.Comment,
		CreatedAt: time.Now(),
	}

	if err := s.DB.InsertRating(r.Context(), rating); err != nil {
		http.Error(w, "Failed to insert rating: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Trigger Trust Score Recalculation
	if err := s.RecalculateTrustScore(r.Context(), req.AgentID); err != nil {
		// Log error but don't fail the rating submission
		s.DB.InsertAgentActivity(r.Context(), &db.AgentActivityLog{
			Agent:  req.AgentID,
			Action: "trust_score_calc_failed",
		})
	}

	json.NewEncoder(w).Encode(map[string]string{"status": "success"})
}

func (s *Server) RecalculateTrustScore(ctx context.Context, agentID string) error {
	// 1. Get All Ratings
	ratings, err := s.DB.ListRatings(ctx, agentID)
	if err != nil {
		return err
	}

	var avgStars float64
	if len(ratings) > 0 {
		var sum int
		for _, r := range ratings {
			sum += r.Stars
		}
		avgStars = float64(sum) / float64(len(ratings))
	} else {
		avgStars = 4.0 // Default for new agents
	}

	// 2. Compute Client Score (0-100)
	clientScore := (avgStars / 5.0) * 100

	// 3. Compute System Score (Logic from spec)
	// success_rate  * 0.35 + on_time_rate * 0.25 + schema_validity_rate * 0.25 + (1 - rejection_rate) * 0.15
	
	metrics, err := s.DB.GetMetrics(ctx, agentID)
	if err != nil || metrics == nil {
		// Create default metrics if missing
		metrics = &db.AgentMetrics{
			AgentID:            agentID,
			SuccessRate:        0.95,
			OnTimeRate:         1.0,
			SchemaValidityRate: 1.0,
			RejectionRate:      0.0,
			TrustScore:         80,
		}
	}

	systemScore := (metrics.SuccessRate * 0.35 +
		metrics.OnTimeRate * 0.25 +
		metrics.SchemaValidityRate * 0.25 +
		(1.0-metrics.RejectionRate)*0.15) * 100

	// 4. Final Trust Score
	// trust_score = (client_score * 0.6) + (system_score * 0.4)
	finalTrustScore := (clientScore * 0.6) + (systemScore * 0.4)

	// Update Metrics Table
	metrics.TrustScore = finalTrustScore
	metrics.UpdatedAt = time.Now()
	if err := s.DB.UpsertMetrics(ctx, metrics); err != nil {
		return err
	}

	// Update Agents Table
	agent, err := s.DB.GetAgent(ctx, agentID)
	if err == nil {
		agent.TrustScore = finalTrustScore
		agent.SuccessRate = metrics.SuccessRate
		_ = s.DB.UpsertAgent(ctx, agent)
	}

	return nil
}
