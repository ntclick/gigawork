package api

import (
	"encoding/json"
	"net/http"
	"strconv"

	"gigawork/internal/db"

	"github.com/go-chi/chi/v5"
)

type RaiseDisputeRequest struct {
	RaisedBy string `json:"raised_by"`
	Reason   string `json:"reason"`
}

// POST /jobs/{jobID}/dispute
func (s *Server) RaiseDispute(w http.ResponseWriter, r *http.Request) {
	jobIDStr := chi.URLParam(r, "jobID")
	jobID, err := strconv.ParseInt(jobIDStr, 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid job ID")
		return
	}

	var req RaiseDisputeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.RaisedBy == "" || req.Reason == "" {
		writeError(w, http.StatusBadRequest, "raised_by and reason are required")
		return
	}

	// Verify job exists and is disputable
	job, err := s.DB.GetJob(r.Context(), jobID)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}

	if job.Status != "IN_PROGRESS" && job.Status != "PENDING_REVIEW" {
		writeError(w, http.StatusBadRequest, "job cannot be disputed in current status")
		return
	}

	// Create dispute record
	dispute := &db.Dispute{
		JobID:    jobID,
		RaisedBy: req.RaisedBy,
		Reason:   req.Reason,
	}

	if err := s.DB.InsertDispute(r.Context(), dispute); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Update job status
	job.Status = "DISPUTED"
	if err := s.DB.UpsertJob(r.Context(), job); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusCreated, dispute)
}
