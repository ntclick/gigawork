package api

import (
	"encoding/json"
	"log"
	"net/http"
	"time"

	"gigawork/internal/auth"
	"gigawork/internal/db"
)

// GET /api/deposit-address
// Returns the server wallet address where users should send USDC.
func (s *Server) GetDepositAddress(w http.ResponseWriter, r *http.Request) {
	addr := ""
	if s.ChainClient != nil {
		addr = s.ChainClient.Address.Hex()
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"address": addr,
		"network": "Arc Testnet",
		"chain_id": "5042002",
	})
}

// GET /api/balance?wallet=0x...
func (s *Server) GetBalance(w http.ResponseWriter, r *http.Request) {
	wallet := r.URL.Query().Get("wallet")
	if wallet == "" {
		// Try from session
		addr, err := auth.ValidateSession(r, s.AuthSecret)
		if err != nil {
			writeError(w, http.StatusBadRequest, "wallet param or auth session required")
			return
		}
		wallet = addr
	}

	balance, err := s.DB.GetBalance(r.Context(), wallet)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"wallet":  wallet,
		"balance": balance,
	})
}

type DepositRequest struct {
	Wallet string  `json:"wallet"`
	Amount float64 `json:"amount"`
	TxHash string  `json:"tx_hash"`
}

// POST /api/balance/deposit
func (s *Server) Deposit(w http.ResponseWriter, r *http.Request) {
	var req DepositRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Wallet == "" || req.TxHash == "" {
		writeError(w, http.StatusBadRequest, "wallet and tx_hash are required")
		return
	}

	// If amount not specified, default to 5 USDC (manual deposit)
	if req.Amount <= 0 {
		req.Amount = 5.0
	}

	// Record the deposit
	if err := s.DB.InsertDeposit(r.Context(), &db.USDCDeposit{
		Wallet:      req.Wallet,
		Amount:      req.Amount,
		TxHash:      req.TxHash,
		ConfirmedAt: time.Now(),
	}); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to record deposit: "+err.Error())
		return
	}

	// Credit balance
	if err := s.DB.CreditBalance(r.Context(), req.Wallet, req.Amount); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to credit balance: "+err.Error())
		return
	}

	balance, _ := s.DB.GetBalance(r.Context(), req.Wallet)

	log.Printf("[Balance] Deposit: %s +%.6f USDC (tx: %s) → balance: %.6f",
		req.Wallet, req.Amount, req.TxHash, balance)

	writeJSON(w, http.StatusOK, map[string]any{
		"status":      "deposited",
		"wallet":      req.Wallet,
		"deposited":   req.Amount,
		"new_balance": balance,
	})
}

type WithdrawRequest struct {
	Wallet string  `json:"wallet"`
	Amount float64 `json:"amount"`
}

// POST /api/balance/withdraw
func (s *Server) Withdraw(w http.ResponseWriter, r *http.Request) {
	var req WithdrawRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Wallet == "" || req.Amount <= 0 {
		writeError(w, http.StatusBadRequest, "wallet and amount > 0 required")
		return
	}

	if err := s.DB.DebitBalance(r.Context(), req.Wallet, req.Amount); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	balance, _ := s.DB.GetBalance(r.Context(), req.Wallet)

	log.Printf("[Balance] Withdraw: %s -%.6f USDC → balance: %.6f",
		req.Wallet, req.Amount, balance)

	writeJSON(w, http.StatusOK, map[string]any{
		"status":      "withdrawn",
		"wallet":      req.Wallet,
		"withdrawn":   req.Amount,
		"new_balance": balance,
	})
}
