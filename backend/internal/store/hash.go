package store

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
)

// ComputeInputHash generates a stable SHA256 hash for agent inputs.
// It normalizes the input by marshaling it to a canonical JSON representation.
func ComputeInputHash(agentID string, input any) (string, error) {
	// Canonicalize: In Go, json.Marshal on map[string]any sorts keys by default.
	content, err := json.Marshal(input)
	if err != nil {
		return "", err
	}

	data := fmt.Sprintf("%s:%s", agentID, string(content))
	hash := sha256.Sum256([]byte(data))
	
	return fmt.Sprintf("%x", hash), nil
}

// ComputeContentHash generates a SHA256 hash for agent output data.
func ComputeContentHash(output any) (string, error) {
	content, err := json.Marshal(output)
	if err != nil {
		return "", err
	}

	hash := sha256.Sum256(content)
	return fmt.Sprintf("%x", hash), nil
}
