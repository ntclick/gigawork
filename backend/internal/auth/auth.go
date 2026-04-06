package auth

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
)

type contextKey string

const AddressKey contextKey = "wallet_address"

// ─── Nonce Store ─────────────────────────────────────────

type nonce struct {
	Value     string
	ExpiresAt time.Time
}

type NonceStore struct {
	mu     sync.RWMutex
	nonces map[string]nonce // address → nonce
}

func NewNonceStore() *NonceStore {
	return &NonceStore{nonces: make(map[string]nonce)}
}

func (s *NonceStore) Generate(address string) string {
	b := make([]byte, 16)
	rand.Read(b)
	n := hex.EncodeToString(b)

	s.mu.Lock()
	s.nonces[strings.ToLower(address)] = nonce{
		Value:     n,
		ExpiresAt: time.Now().Add(5 * time.Minute),
	}
	s.mu.Unlock()
	return n
}

func (s *NonceStore) Validate(address, value string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()

	key := strings.ToLower(address)
	n, ok := s.nonces[key]
	if !ok || n.Value != value || time.Now().After(n.ExpiresAt) {
		return false
	}
	delete(s.nonces, key)
	return true
}

// BuildMessage creates the SIWE-style message to be signed.
func BuildMessage(address, nonceVal string) string {
	return fmt.Sprintf(`GigaWork wants you to sign in with your Ethereum account:
%s

Nonce: %s
Chain ID: 5042002`, address, nonceVal)
}

// ─── Signature Verification ──────────────────────────────

// VerifySignature recovers the signer from an EIP-191 personal_sign signature.
func VerifySignature(address, message, signature string) (bool, error) {
	sig, err := hex.DecodeString(strings.TrimPrefix(signature, "0x"))
	if err != nil {
		return false, fmt.Errorf("invalid signature hex: %w", err)
	}

	if len(sig) != 65 {
		return false, fmt.Errorf("invalid signature length: %d", len(sig))
	}

	// Fix recovery ID (v): MetaMask uses 27/28, go-ethereum expects 0/1
	if sig[64] >= 27 {
		sig[64] -= 27
	}

	// Hash with Ethereum signed message prefix
	prefixed := fmt.Sprintf("\x19Ethereum Signed Message:\n%d%s", len(message), message)
	hash := crypto.Keccak256Hash([]byte(prefixed))

	pubKey, err := crypto.SigToPub(hash.Bytes(), sig)
	if err != nil {
		return false, fmt.Errorf("failed to recover public key: %w", err)
	}

	recovered := crypto.PubkeyToAddress(*pubKey)
	expected := common.HexToAddress(address)

	return recovered == expected, nil
}

// ─── Session Cookie ──────────────────────────────────────

const (
	CookieName    = "gigawork_session"
	SessionMaxAge = 24 * time.Hour
)

func CreateSessionCookie(address string, secret []byte) *http.Cookie {
	expiry := time.Now().Add(SessionMaxAge).Unix()
	payload := fmt.Sprintf("%s|%d", strings.ToLower(address), expiry)
	mac := computeHMAC(payload, secret)

	return &http.Cookie{
		Name:     CookieName,
		Value:    fmt.Sprintf("%s|%s", payload, mac),
		Path:     "/",
		MaxAge:   int(SessionMaxAge.Seconds()),
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	}
}

func ValidateSession(r *http.Request, secret []byte) (string, error) {
	cookie, err := r.Cookie(CookieName)
	if err != nil {
		return "", fmt.Errorf("no session cookie")
	}

	parts := strings.SplitN(cookie.Value, "|", 3)
	if len(parts) != 3 {
		return "", fmt.Errorf("malformed session")
	}

	address, expiryStr, mac := parts[0], parts[1], parts[2]
	payload := fmt.Sprintf("%s|%s", address, expiryStr)

	if !verifyHMAC(payload, mac, secret) {
		return "", fmt.Errorf("invalid session signature")
	}

	var expiry int64
	fmt.Sscanf(expiryStr, "%d", &expiry)
	if time.Now().Unix() > expiry {
		return "", fmt.Errorf("session expired")
	}

	return address, nil
}

func ClearSessionCookie() *http.Cookie {
	return &http.Cookie{
		Name:     CookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
	}
}

// ─── Middleware ───────────────────────────────────────────

// RequireAuth is a chi middleware that validates the session cookie.
func RequireAuth(secret []byte) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			address, err := ValidateSession(r, secret)
			if err != nil {
				http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
				return
			}
			ctx := context.WithValue(r.Context(), AddressKey, address)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// GetAddress extracts the wallet address from request context.
func GetAddress(ctx context.Context) string {
	if addr, ok := ctx.Value(AddressKey).(string); ok {
		return addr
	}
	return ""
}

// ─── HMAC Helpers ────────────────────────────────────────

func computeHMAC(payload string, secret []byte) string {
	h := hmac.New(sha256.New, secret)
	h.Write([]byte(payload))
	return hex.EncodeToString(h.Sum(nil))
}

func verifyHMAC(payload, mac string, secret []byte) bool {
	expected := computeHMAC(payload, secret)
	return hmac.Equal([]byte(expected), []byte(mac))
}
