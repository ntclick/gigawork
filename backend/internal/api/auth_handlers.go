package api

import (
	"encoding/json"
	"net/http"
	"strings"

	"gigawork/internal/auth"
)

// GET /api/auth/nonce?address=0x...
func (s *Server) GetNonce(w http.ResponseWriter, r *http.Request) {
	address := r.URL.Query().Get("address")
	if address == "" || len(address) != 42 {
		writeError(w, http.StatusBadRequest, "valid address is required")
		return
	}

	nonceVal := s.Nonces.Generate(address)
	message := auth.BuildMessage(address, nonceVal)

	writeJSON(w, http.StatusOK, map[string]string{
		"nonce":   nonceVal,
		"message": message,
	})
}

type VerifyRequest struct {
	Address   string `json:"address"`
	Signature string `json:"signature"`
	Nonce     string `json:"nonce"`
}

// POST /api/auth/verify
func (s *Server) VerifySignature(w http.ResponseWriter, r *http.Request) {
	var req VerifyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Address == "" || req.Signature == "" || req.Nonce == "" {
		writeError(w, http.StatusBadRequest, "address, signature, and nonce are required")
		return
	}

	// Validate nonce
	if !s.Nonces.Validate(req.Address, req.Nonce) {
		writeError(w, http.StatusUnauthorized, "invalid or expired nonce")
		return
	}

	// Verify signature
	message := auth.BuildMessage(req.Address, req.Nonce)
	valid, err := auth.VerifySignature(req.Address, message, req.Signature)
	if err != nil || !valid {
		writeError(w, http.StatusUnauthorized, "invalid signature")
		return
	}

	// Check if registered agent
	isAgent := false
	agent, err := s.DB.GetAgent(r.Context(), strings.ToLower(req.Address))
	if err == nil && agent != nil {
		isAgent = true
	}

	// Set session cookie
	cookie := auth.CreateSessionCookie(req.Address, s.AuthSecret)
	http.SetCookie(w, cookie)

	writeJSON(w, http.StatusOK, map[string]any{
		"address":  strings.ToLower(req.Address),
		"is_agent": isAgent,
	})
}

// GET /api/auth/me
func (s *Server) GetMe(w http.ResponseWriter, r *http.Request) {
	address, err := auth.ValidateSession(r, s.AuthSecret)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}

	isAgent := false
	agent, err := s.DB.GetAgent(r.Context(), address)
	if err == nil && agent != nil {
		isAgent = true
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"address":  address,
		"is_agent": isAgent,
	})
}

// POST /api/auth/logout
func (s *Server) Logout(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, auth.ClearSessionCookie())
	writeJSON(w, http.StatusOK, map[string]string{"status": "logged out"})
}
