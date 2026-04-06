package api

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"
	"strings"

	"gigawork/internal/auth"
	"gigawork/internal/db"
)

// POST /api/auth/privy-send-otp
// Proxy to Privy API to send email verification code
func (s *Server) PrivySendOTP(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email string `json:"email"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Email == "" {
		writeError(w, http.StatusBadRequest, "email is required")
		return
	}

	appID := os.Getenv("PRIVY_APP_ID")
	appSecret := os.Getenv("PRIVY_APP_SECRET")
	if appID == "" || appSecret == "" {
		writeError(w, http.StatusInternalServerError, "Privy not configured")
		return
	}

	// Call Privy API to init email auth
	payload := map[string]string{"email": req.Email}
	body, _ := json.Marshal(payload)

	privyReq, _ := http.NewRequestWithContext(r.Context(), "POST",
		"https://auth.privy.io/api/v1/passwordless/init",
		bytes.NewReader(body))
	privyReq.Header.Set("Content-Type", "application/json")
	privyReq.Header.Set("privy-app-id", appID)
	privyReq.Header.Set("Origin", "http://localhost:8181")
	privyReq.SetBasicAuth(appID, appSecret)

	resp, err := http.DefaultClient.Do(privyReq)
	if err != nil {
		log.Printf("[Privy] OTP send failed: %v", err)
		writeError(w, http.StatusBadGateway, "failed to reach Privy API")
		return
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode >= 400 {
		log.Printf("[Privy] OTP API error %d: %s", resp.StatusCode, string(respBody))
		writeError(w, http.StatusBadGateway, "Privy API error: "+string(respBody))
		return
	}

	log.Printf("[Privy] OTP sent to %s", req.Email)
	writeJSON(w, http.StatusOK, map[string]string{
		"status": "otp_sent",
		"email":  req.Email,
	})
}

// POST /api/auth/privy-verify
// Verify OTP code via Privy, create/login user with embedded wallet address
func (s *Server) PrivyVerify(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email string `json:"email"`
		Code  string `json:"code"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Email == "" || req.Code == "" {
		writeError(w, http.StatusBadRequest, "email and code are required")
		return
	}

	appID := os.Getenv("PRIVY_APP_ID")
	appSecret := os.Getenv("PRIVY_APP_SECRET")
	if appID == "" || appSecret == "" {
		writeError(w, http.StatusInternalServerError, "Privy not configured")
		return
	}

	// Call Privy API to verify OTP
	payload := map[string]string{
		"email": req.Email,
		"code":  req.Code,
	}
	body, _ := json.Marshal(payload)

	privyReq, _ := http.NewRequestWithContext(r.Context(), "POST",
		"https://auth.privy.io/api/v1/passwordless/authenticate",
		bytes.NewReader(body))
	privyReq.Header.Set("Content-Type", "application/json")
	privyReq.Header.Set("privy-app-id", appID)
	privyReq.Header.Set("Origin", "http://localhost:8181")
	privyReq.SetBasicAuth(appID, appSecret)

	resp, err := http.DefaultClient.Do(privyReq)
	if err != nil {
		log.Printf("[Privy] Verify failed: %v", err)
		writeError(w, http.StatusBadGateway, "failed to reach Privy API")
		return
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode >= 400 {
		log.Printf("[Privy] Verify error %d: %s", resp.StatusCode, string(respBody))
		writeError(w, http.StatusUnauthorized, "invalid code")
		return
	}

	// Parse Privy response
	var privyResp struct {
		User struct {
			ID             string `json:"id"`
			LinkedAccounts []struct {
				Type      string `json:"type"`
				Address   string `json:"address"`
				ChainType string `json:"chain_type"`
			} `json:"linked_accounts"`
		} `json:"user"`
		Token string `json:"token"`
	}
	if err := json.Unmarshal(respBody, &privyResp); err != nil {
		log.Printf("[Privy] Response parse error: %v | body: %s", err, string(respBody))
		writeError(w, http.StatusInternalServerError, "failed to parse Privy response")
		return
	}

	// Extract wallet address from linked accounts
	// Priority: ethereum wallet > any wallet > email-derived
	walletAddr := ""
	walletSource := ""
	for _, acct := range privyResp.User.LinkedAccounts {
		if acct.Type == "wallet" && acct.Address != "" {
			if acct.ChainType == "ethereum" || acct.ChainType == "" {
				walletAddr = acct.Address
				walletSource = "privy_embedded"
				break
			}
			if walletAddr == "" {
				walletAddr = acct.Address
				walletSource = "privy_wallet"
			}
		}
	}

	// Fallback: derive deterministic address from email (platform-only, no on-chain signing)
	if walletAddr == "" {
		hash := sha256.Sum256([]byte("gigawork:email:" + strings.ToLower(req.Email)))
		walletAddr = "0x" + hex.EncodeToString(hash[:20])
		walletSource = "email_derived"
	}

	log.Printf("[Privy] User verified: %s → wallet %s (source: %s, privy_id: %s)",
		req.Email, walletAddr, walletSource, privyResp.User.ID)

	// Upsert user in DB
	user, err := s.DB.GetUser(r.Context(), walletAddr)
	if err != nil {
		user = &db.User{
			Address: walletAddr,
			Roles:   []string{db.RoleClient},
		}
	}
	_ = s.DB.UpsertUser(r.Context(), user)

	// Create session cookie (same as SIWE flow)
	cookie := auth.CreateSessionCookie(walletAddr, s.AuthSecret)
	http.SetCookie(w, cookie)

	// Check if agent
	isAgent := false
	agent, err := s.DB.GetAgent(r.Context(), walletAddr)
	if err == nil && agent != nil {
		isAgent = true
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"address":       walletAddr,
		"privy_user_id": privyResp.User.ID,
		"wallet_source": walletSource,
		"is_agent":      isAgent,
		"email":         req.Email,
	})
}
