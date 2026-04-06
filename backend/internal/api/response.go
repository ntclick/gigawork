package api

import (
	"encoding/json"
	"net/http"
	"regexp"
	"strings"
)

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// ─── Input Validation Helpers ───────────────────────────────

var evmAddressRegex = regexp.MustCompile(`^0x[0-9a-fA-F]{40}$`)

var promptInjectionPatterns = []string{
	"ignore previous instructions",
	"ignore all previous",
	"system:",
	"assistant:",
	"<script",
	"</script>",
	"javascript:",
	"onerror=",
	"onload=",
}

func isValidEVMAddress(addr string) bool {
	return evmAddressRegex.MatchString(addr)
}

func sanitizeInput(s string, maxLen int) string {
	if len(s) > maxLen {
		s = s[:maxLen]
	}
	// Strip HTML tags
	s = regexp.MustCompile(`<[^>]*>`).ReplaceAllString(s, "")
	return strings.TrimSpace(s)
}

func containsPromptInjection(s string) bool {
	lower := strings.ToLower(s)
	for _, pattern := range promptInjectionPatterns {
		if strings.Contains(lower, pattern) {
			return true
		}
	}
	return false
}
