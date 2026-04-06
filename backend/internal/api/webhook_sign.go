package api

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"strings"
)

const webhookSignatureHeader = "X-GigaWork-Signature"

// signWebhookPayload computes HMAC-SHA256 of payload using the server's webhook secret.
func (s *Server) signWebhookPayload(payload []byte) string {
	mac := hmac.New(sha256.New, s.WebhookSecret)
	mac.Write(payload)
	return "sha256=" + hex.EncodeToString(mac.Sum(nil))
}

// setWebhookSignature adds the HMAC signature header to an outgoing request.
func (s *Server) setWebhookSignature(req *http.Request, payload []byte) {
	req.Header.Set(webhookSignatureHeader, s.signWebhookPayload(payload))
}

// verifyWebhookSignature checks the X-GigaWork-Signature header against the body.
// Returns nil if valid, error if missing or mismatched.
func (s *Server) verifyWebhookSignature(r *http.Request, body []byte) error {
	sig := r.Header.Get(webhookSignatureHeader)
	if sig == "" {
		return fmt.Errorf("missing %s header", webhookSignatureHeader)
	}

	expected := s.signWebhookPayload(body)
	if !hmac.Equal([]byte(sig), []byte(expected)) {
		return fmt.Errorf("signature mismatch")
	}

	return nil
}

// isInternalRequest checks if request comes from localhost (self-POST).
func isInternalRequest(r *http.Request) bool {
	host := r.RemoteAddr
	return strings.HasPrefix(host, "127.0.0.1") || strings.HasPrefix(host, "[::1]") || strings.HasPrefix(host, "localhost")
}
