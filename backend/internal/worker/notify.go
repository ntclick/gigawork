package worker

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"
)

// TelegramNotifier sends job notifications to agents via Telegram.
type TelegramNotifier struct {
	botToken   string
	httpClient *http.Client
}

func NewTelegramNotifier(botToken string) *TelegramNotifier {
	return &TelegramNotifier{
		botToken:   botToken,
		httpClient: &http.Client{Timeout: 10 * time.Second},
	}
}

// SendMessage sends a text message to a Telegram chat.
func (n *TelegramNotifier) SendMessage(ctx context.Context, chatID string, text string) error {
	if n.botToken == "" {
		log.Printf("[telegram] bot token not configured, skipping notification")
		return nil
	}

	url := fmt.Sprintf("https://api.telegram.org/bot%s/sendMessage", n.botToken)

	payload := map[string]string{
		"chat_id":    chatID,
		"text":       text,
		"parse_mode": "HTML",
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := n.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("telegram API error: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("telegram API returned status %d", resp.StatusCode)
	}

	return nil
}

// NotifyNewJob sends a notification about a new job posting.
func (n *TelegramNotifier) NotifyNewJob(ctx context.Context, chatID string, jobID int64, jobType string, hours float64, rate float64) error {
	text := fmt.Sprintf(
		"<b>New Job Posted!</b>\n\n"+
			"Job #%d\n"+
			"Type: %s\n"+
			"Estimated: %.0f hours\n"+
			"Rate: $%.2f USDC/hr\n\n"+
			"Bid now on GigaWork!",
		jobID, jobType, hours, rate,
	)

	return n.SendMessage(ctx, chatID, text)
}

// NotifyBidAccepted notifies a worker that their bid was accepted.
func (n *TelegramNotifier) NotifyBidAccepted(ctx context.Context, chatID string, jobID int64) error {
	text := fmt.Sprintf(
		"<b>Bid Accepted!</b>\n\n"+
			"Your bid on Job #%d has been accepted.\n"+
			"The clock is running — get to work!",
		jobID,
	)

	return n.SendMessage(ctx, chatID, text)
}

// NotifyJobSettled notifies a worker that a job has been settled.
func (n *TelegramNotifier) NotifyJobSettled(ctx context.Context, chatID string, jobID int64, payout float64) error {
	text := fmt.Sprintf(
		"<b>Job Settled!</b>\n\n"+
			"Job #%d has been completed.\n"+
			"Payout: $%.2f USDC",
		jobID, payout,
	)

	return n.SendMessage(ctx, chatID, text)
}
