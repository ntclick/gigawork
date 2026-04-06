package api

import (
	"encoding/json"
	"net/http"
	"strconv"

	"gigawork/internal/db"

	"github.com/go-chi/chi/v5"
)

type SubmitBidRequest struct {
	AgentAddress string  `json:"agent_address"`
	ProposedRate float64 `json:"proposed_rate"`
	Note         string  `json:"note,omitempty"`
}

// POST /jobs/{jobID}/bid
func (s *Server) SubmitBid(w http.ResponseWriter, r *http.Request) {
	jobIDStr := chi.URLParam(r, "jobID")
	jobID, err := strconv.ParseInt(jobIDStr, 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid job ID")
		return
	}

	var req SubmitBidRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.AgentAddress == "" || req.ProposedRate <= 0 {
		writeError(w, http.StatusBadRequest, "agent_address and proposed_rate are required")
		return
	}

	// Verify job exists and is OPEN
	job, err := s.DB.GetJob(r.Context(), jobID)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	if job.Status != "OPEN" {
		writeError(w, http.StatusBadRequest, "job is not open for bids")
		return
	}

	var note *string
	if req.Note != "" {
		note = &req.Note
	}

	bid := &db.Bid{
		JobID:        jobID,
		AgentAddress: req.AgentAddress,
		ProposedRate: req.ProposedRate,
		Note:         note,
		Status:       "PENDING",
	}

	if err := s.DB.InsertBid(r.Context(), bid); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusCreated, bid)
}

type AcceptBidRequest struct {
	WorkerAddress string `json:"worker_address"`
}

// POST /jobs/{jobID}/accept-bid
func (s *Server) AcceptBid(w http.ResponseWriter, r *http.Request) {
	jobIDStr := chi.URLParam(r, "jobID")
	jobID, err := strconv.ParseInt(jobIDStr, 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid job ID")
		return
	}

	var req AcceptBidRequest
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

	if job.Status != "OPEN" && job.Status != "MATCHING" {
		writeError(w, http.StatusBadRequest, "job is not available for bid acceptance")
		return
	}

	job.WorkerAgent = &req.WorkerAddress
	job.Status = "IN_PROGRESS"

	if err := s.DB.UpsertJob(r.Context(), job); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Update bid status
	bids, err := s.DB.GetBidsByJob(r.Context(), jobID)
	if err == nil {
		for _, b := range bids {
			if b.AgentAddress == req.WorkerAddress {
				s.DB.UpdateBidStatus(r.Context(), b.ID, "ACCEPTED")
			} else {
				s.DB.UpdateBidStatus(r.Context(), b.ID, "REJECTED")
			}
		}
	}

	writeJSON(w, http.StatusOK, job)
}
