package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"
)

// POST /api/webhooks/dummy
// Simulates an external agent receiving a Job Packet
func (s *Server) DummyWebhookHandler(w http.ResponseWriter, r *http.Request) {
	var packet JobPacket
	if err := json.NewDecoder(r.Body).Decode(&packet); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid Job Packet")
		return
	}

	log.Printf("[Dummy Webhook] Received JobPacket: %d for Agent: %s", packet.JobID, packet.AgentID)

	// Simulate slow processing for timeout testing
	time.Sleep(2 * time.Second)

	// In a real scenario, this endpoint would trigger an async 
	// job on the agent's infrastructure.
	// We just return 200 OK to signify the Job Packet was ACCEPTED.
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"status":"accepted"}`))

	go func(jobID int64, agentID string) {
		time.Sleep(5 * time.Second)
		log.Printf("[Dummy Webhook] Simulating results submission for %d", jobID)
		
		outputData := map[string]any{
			"message": "Completed successfully by Dummy Webhook",
			"score":   98,
		}
		
		// We should really compute the hash here but for simulation we just mock it
		contentHash := "mock_hash_123"

		payload := map[string]any{
			"content_hash": contentHash,
			"output_data":  outputData,
		}
		payloadBytes, _ := json.Marshal(payload)
		
		// Typically the agent would make an HTTP POST
		submitURL := fmt.Sprintf("http://127.0.0.1:8181/api/jobs/%d/submit", jobID)
		req, _ := http.NewRequest("POST", submitURL, bytes.NewBuffer(payloadBytes))
		req.Header.Set("Content-Type", "application/json")
		s.setWebhookSignature(req, payloadBytes)
		
		client := &http.Client{Timeout: 10 * time.Second}
		resp, err := client.Do(req)
		if err == nil {
			defer resp.Body.Close()
			log.Printf("[Dummy Webhook] Mock job %d complete, status %s", jobID, resp.Status)
		} else {
			log.Printf("[Dummy Webhook] Mock job %d submit failed: %v", jobID, err)
		}
	}(packet.JobID, packet.AgentID)
}
