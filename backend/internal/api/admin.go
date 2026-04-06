package api

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
)

type ResolveDisputeRequest struct {
	WorkerWon  bool   `json:"worker_won"`
	Resolution string `json:"resolution"`
}

// POST /admin/disputes/{jobID}/resolve
func (s *Server) ResolveDispute(w http.ResponseWriter, r *http.Request) {
	jobIDStr := chi.URLParam(r, "jobID")
	jobID, err := strconv.ParseInt(jobIDStr, 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid job ID")
		return
	}

	var req ResolveDisputeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Update job status
	job, err := s.DB.GetJob(r.Context(), jobID)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}

	if job.Status != "DISPUTED" {
		writeError(w, http.StatusBadRequest, "job is not in disputed state")
		return
	}

	if req.WorkerWon {
		job.Status = "SETTLED"
	} else {
		job.Status = "EXPIRED"
	}

	if err := s.DB.UpsertJob(r.Context(), job); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Update dispute record
	disputes, err := s.DB.GetDisputesByJob(r.Context(), jobID)
	if err == nil && len(disputes) > 0 {
		d := disputes[0]
		d.WorkerWon = &req.WorkerWon
		d.Resolution = &req.Resolution
		now := time.Now()
		d.ResolvedAt = &now
		if err := s.DB.UpdateDispute(r.Context(), &d); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to persist dispute resolution: "+err.Error())
			return
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"job_id":     jobID,
		"worker_won": req.WorkerWon,
		"status":     job.Status,
	})
}

// GET /admin/disputes?status=open
func (s *Server) ListDisputes(w http.ResponseWriter, r *http.Request) {
	// List all disputed jobs
	jobs, err := s.DB.ListJobs(r.Context(), "DISPUTED", "", "")
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, jobs)
}
