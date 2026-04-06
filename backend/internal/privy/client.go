package privy

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math/big"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
)

const baseURL = "https://api.privy.io/v1"

// Client handles Privy server-side API calls including delegated actions.
type Client struct {
	appID     string
	appSecret string
	http      *http.Client
}

// NewClient creates a Privy API client from env vars.
func NewClient() (*Client, error) {
	appID := os.Getenv("PRIVY_APP_ID")
	appSecret := os.Getenv("PRIVY_APP_SECRET")
	if appID == "" || appSecret == "" {
		return nil, fmt.Errorf("PRIVY_APP_ID and PRIVY_APP_SECRET required")
	}

	return &Client{
		appID:     appID,
		appSecret: appSecret,
		http:      &http.Client{Timeout: 60 * time.Second},
	}, nil
}

func (c *Client) basicAuth() string {
	return "Basic " + base64.StdEncoding.EncodeToString([]byte(c.appID+":"+c.appSecret))
}

// ─── Get user's embedded wallet ─────────────────────────────────────

type UserWallet struct {
	ID              string `json:"id"`
	Address         string `json:"address"`
	ChainType       string `json:"chain_type"`
	WalletClientType string `json:"wallet_client_type"`
	Delegated       bool   `json:"delegated"`
}

// GetUserByWallet looks up a Privy user by wallet address and returns their wallet ID.
func (c *Client) GetUserByWallet(walletAddress string) (*UserWallet, error) {
	body, _ := json.Marshal(map[string]string{
		"address": strings.ToLower(walletAddress),
	})

	req, _ := http.NewRequest("POST", baseURL+"/users/wallet/address", bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", c.basicAuth())
	req.Header.Set("privy-app-id", c.appID)

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("privy request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("privy API error %d: %s", resp.StatusCode, string(respBody))
	}

	var user struct {
		LinkedAccounts []struct {
			Type            string `json:"type"`
			Address         string `json:"address"`
			WalletClientType string `json:"wallet_client_type"`
			WalletClient    string `json:"wallet_client"`
			DelegatedAccess *struct {
				Status string `json:"status"`
			} `json:"delegated,omitempty"`
		} `json:"linked_accounts"`
	}
	if err := json.Unmarshal(respBody, &user); err != nil {
		return nil, fmt.Errorf("parse privy user: %w", err)
	}

	// Find embedded ethereum wallet
	for _, acc := range user.LinkedAccounts {
		if acc.Type == "wallet" && (acc.WalletClientType == "privy" || acc.WalletClient == "privy") {
			delegated := acc.DelegatedAccess != nil && acc.DelegatedAccess.Status == "active"
			return &UserWallet{
				Address:          acc.Address,
				ChainType:        "ethereum",
				WalletClientType: "privy",
				Delegated:        delegated,
			}, nil
		}
	}

	return nil, fmt.Errorf("no embedded wallet found for %s", walletAddress)
}

// ─── List wallets to find wallet ID ─────────────────────────────────

type WalletInfo struct {
	ID               string   `json:"id"`
	Address          string   `json:"address"`
	ChainType        string   `json:"chain_type"`
	AdditionalSigners []string `json:"additional_signers"`
}

// FindWalletByAddress finds a wallet's ID by its address from the Privy wallets API.
func (c *Client) FindWalletByAddress(address string) (*WalletInfo, error) {
	url := fmt.Sprintf("%s/wallets?chain_type=ethereum", baseURL)

	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("Authorization", c.basicAuth())
	req.Header.Set("privy-app-id", c.appID)

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("privy wallets request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("privy wallets API error %d: %s", resp.StatusCode, string(respBody))
	}

	var result struct {
		Data []WalletInfo `json:"data"`
	}
	if err := json.Unmarshal(respBody, &result); err != nil {
		return nil, fmt.Errorf("parse wallets: %w", err)
	}

	lowerAddr := strings.ToLower(address)
	for _, w := range result.Data {
		if strings.ToLower(w.Address) == lowerAddr {
			return &w, nil
		}
	}

	return nil, fmt.Errorf("wallet %s not found in privy", address)
}

// ─── Send transaction via delegated actions ─────────────────────────

type SendTxRequest struct {
	WalletID string
	ChainID  int64
	To       string
	Value    string // hex string, e.g. "0x0"
	Data     string // hex-encoded calldata
}

type SendTxResponse struct {
	Hash          string `json:"hash"`
	TransactionID string `json:"transaction_id"`
}

// SendTransaction sends an EVM transaction via Privy delegated actions.
// The wallet must have an active signer (delegation granted by user).
func (c *Client) SendTransaction(tx SendTxRequest) (*SendTxResponse, error) {
	caip2 := fmt.Sprintf("eip155:%d", tx.ChainID)

	payload := map[string]any{
		"method":     "eth_sendTransaction",
		"caip2":      caip2,
		"chain_type": "ethereum",
		"params": map[string]any{
			"transaction": map[string]any{
				"to":    tx.To,
				"value": tx.Value,
				"data":  tx.Data,
			},
		},
	}
	body, _ := json.Marshal(payload)

	url := fmt.Sprintf("%s/wallets/%s/rpc", baseURL, tx.WalletID)
	req, _ := http.NewRequest("POST", url, bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", c.basicAuth())
	req.Header.Set("privy-app-id", c.appID)

	log.Printf("[Privy] SendTransaction wallet=%s chain=%d to=%s", tx.WalletID, tx.ChainID, tx.To)

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("privy rpc request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("privy rpc error %d: %s", resp.StatusCode, string(respBody))
	}

	var result struct {
		Data SendTxResponse `json:"data"`
	}
	if err := json.Unmarshal(respBody, &result); err != nil {
		return nil, fmt.Errorf("parse rpc response: %w", err)
	}

	log.Printf("[Privy] Transaction sent: hash=%s", result.Data.Hash)
	return &result.Data, nil
}

// ─── High-level helpers for ERC-8183 flow ───────────────────────────

const (
	ArcChainID      = 5042002
	CommerceAddress = "0xefe28B2FB1146A5d95c7E5e134cEF7a180D47e34"
	USDCAddress     = "0x3600000000000000000000000000000000000000"
)

// ApproveUSDC sends an ERC-20 approve(spender, amount) tx from the user's delegated wallet.
func (c *Client) ApproveUSDC(walletID string, spender string, amount *big.Int) (*SendTxResponse, error) {
	// Encode approve(address,uint256)
	erc20ABI, _ := abi.JSON(strings.NewReader(`[{"name":"approve","type":"function","inputs":[{"name":"spender","type":"address"},{"name":"amount","type":"uint256"}],"outputs":[{"name":"","type":"bool"}]}]`))
	data, err := erc20ABI.Pack("approve", common.HexToAddress(spender), amount)
	if err != nil {
		return nil, fmt.Errorf("encode approve: %w", err)
	}

	return c.SendTransaction(SendTxRequest{
		WalletID: walletID,
		ChainID:  ArcChainID,
		To:       USDCAddress,
		Value:    "0x0",
		Data:     "0x" + common.Bytes2Hex(data),
	})
}

// FundJob sends a fund(jobId, expectedBudget, optParams) tx from the user's delegated wallet.
func (c *Client) FundJob(walletID string, jobID *big.Int, budget *big.Int) (*SendTxResponse, error) {
	commerceABI, _ := abi.JSON(strings.NewReader(`[{"name":"fund","type":"function","inputs":[{"name":"jobId","type":"uint256"},{"name":"expectedBudget","type":"uint256"},{"name":"optParams","type":"bytes"}],"outputs":[]}]`))
	data, err := commerceABI.Pack("fund", jobID, budget, []byte{})
	if err != nil {
		return nil, fmt.Errorf("encode fund: %w", err)
	}

	return c.SendTransaction(SendTxRequest{
		WalletID: walletID,
		ChainID:  ArcChainID,
		To:       CommerceAddress,
		Value:    "0x0",
		Data:     "0x" + common.Bytes2Hex(data),
	})
}

// CreateJob sends createJob(provider, evaluator, expiredAt, description, optParams) from user's wallet.
func (c *Client) CreateJob(walletID string, provider, evaluator string, expiredAt *big.Int, description string) (*SendTxResponse, error) {
	commerceABI, _ := abi.JSON(strings.NewReader(`[{"name":"createJob","type":"function","inputs":[{"name":"provider","type":"address"},{"name":"evaluator","type":"address"},{"name":"expiredAt","type":"uint256"},{"name":"description","type":"string"},{"name":"optParams","type":"bytes"}],"outputs":[{"name":"jobId","type":"uint256"}]}]`))
	data, err := commerceABI.Pack("createJob",
		common.HexToAddress(provider),
		common.HexToAddress(evaluator),
		expiredAt,
		description,
		[]byte{},
	)
	if err != nil {
		return nil, fmt.Errorf("encode createJob: %w", err)
	}

	return c.SendTransaction(SendTxRequest{
		WalletID: walletID,
		ChainID:  ArcChainID,
		To:       CommerceAddress,
		Value:    "0x0",
		Data:     "0x" + common.Bytes2Hex(data),
	})
}
