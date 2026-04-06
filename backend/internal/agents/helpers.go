package agents

import (
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"
)

// httpClient is a shared client with explicit timeout for all external calls.
var httpClient = &http.Client{Timeout: 30 * time.Second}

// retryDo executes an HTTP request with exponential backoff retry.
// Retries up to maxRetries times on network errors (DNS, connection, timeout).
// Returns the response on success, or the last error after all retries exhausted.
func retryDo(client *http.Client, req *http.Request, maxRetries int) (*http.Response, error) {
	backoff := 2 * time.Second
	var lastErr error

	for attempt := 0; attempt <= maxRetries; attempt++ {
		if attempt > 0 {
			log.Printf("[Retry] Attempt %d/%d after %v: %s %s", attempt+1, maxRetries+1, backoff, req.Method, req.URL)
			time.Sleep(backoff)
			backoff *= 2
		}

		resp, err := client.Do(req)
		if err == nil {
			return resp, nil
		}

		lastErr = err
		if !isNetworkError(err) {
			return nil, err // non-retryable error
		}

		log.Printf("[Retry] Network error on %s %s: %v", req.Method, req.URL, err)
	}

	return nil, fmt.Errorf("exhausted %d retries: %w", maxRetries+1, lastErr)
}

// isNetworkError returns true for DNS, connection, and timeout errors.
func isNetworkError(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	netPatterns := []string{
		"no such host",
		"connection refused",
		"i/o timeout",
		"dial tcp",
		"network is unreachable",
		"TLS handshake timeout",
		"connection reset",
	}
	for _, p := range netPatterns {
		if strings.Contains(msg, p) {
			return true
		}
	}
	return false
}

// extractJSON strips markdown code fences from DeepSeek API responses.
// DeepSeek often wraps JSON in ```json ... ``` blocks.
func extractJSON(raw string) string {
	raw = strings.TrimSpace(raw)

	if !strings.HasPrefix(raw, "```") {
		return raw
	}

	lines := strings.Split(raw, "\n")
	if len(lines) < 3 {
		// Single-line fenced: ```{"key":"val"}```
		raw = strings.TrimPrefix(raw, "```json")
		raw = strings.TrimPrefix(raw, "```")
		raw = strings.TrimSuffix(raw, "```")
		return strings.TrimSpace(raw)
	}

	// Multi-line: remove first line (```json) and last line (```)
	lines = lines[1 : len(lines)-1]
	return strings.TrimSpace(strings.Join(lines, "\n"))
}
