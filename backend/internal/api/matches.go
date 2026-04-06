package api

import (
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
)

// GET /jobs/{jobID}/matches
func (s *Server) GetMatches(w http.ResponseWriter, r *http.Request) {
	if s.Matching == nil {
		writeError(w, http.StatusServiceUnavailable, "matching engine not available")
		return
	}

	jobIDStr := chi.URLParam(r, "jobID")
	jobID, err := strconv.ParseInt(jobIDStr, 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid job ID")
		return
	}

	job, err := s.DB.GetJob(r.Context(), jobID)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}

	matches, err := s.Matching.FindMatches(r.Context(), job, 10)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, matches)
}

// GET /jobs/{jobID}/bids
func (s *Server) GetBids(w http.ResponseWriter, r *http.Request) {
	jobIDStr := chi.URLParam(r, "jobID")
	jobID, err := strconv.ParseInt(jobIDStr, 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid job ID")
		return
	}

	bids, err := s.DB.GetBidsByJob(r.Context(), jobID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, bids)
}
