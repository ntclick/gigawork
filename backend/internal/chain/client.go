package chain

import (
	"context"
	"crypto/ecdsa"
	"fmt"
	"math/big"

	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"
)

// ArcChainID is the Arc Testnet chain ID.
const ArcChainID = 5042002

// Client provides access to Arc Network RPC.
type Client struct {
	ETH        *ethclient.Client
	PrivateKey *ecdsa.PrivateKey
	Address    common.Address
	ChainID    *big.Int
}

// NewClient creates a new Arc RPC client.
func NewClient(rpcURL string, privateKey string) (*Client, error) {
	eth, err := ethclient.Dial(rpcURL)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to Arc RPC: %w", err)
	}

	c := &Client{
		ETH:     eth,
		ChainID: big.NewInt(ArcChainID),
	}

	if privateKey != "" {
		pk, err := crypto.HexToECDSA(privateKey)
		if err != nil {
			return nil, fmt.Errorf("invalid private key: %w", err)
		}
		c.PrivateKey = pk
		c.Address = crypto.PubkeyToAddress(pk.PublicKey)
	}

	return c, nil
}

// NewWSClient creates a WebSocket client for event subscriptions.
func NewWSClient(wsURL string) (*ethclient.Client, error) {
	client, err := ethclient.Dial(wsURL)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to Arc WS: %w", err)
	}
	return client, nil
}

// Signer returns a transaction signer for the configured private key.
func (c *Client) Signer(ctx context.Context) (*bind.TransactOpts, error) {
	if c.PrivateKey == nil {
		return nil, fmt.Errorf("no private key configured")
	}

	nonce, err := c.ETH.PendingNonceAt(ctx, c.Address)
	if err != nil {
		return nil, fmt.Errorf("failed to get nonce: %w", err)
	}

	gasPrice, err := c.ETH.SuggestGasPrice(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to get gas price: %w", err)
	}

	auth, err := bind.NewKeyedTransactorWithChainID(c.PrivateKey, c.ChainID)
	if err != nil {
		return nil, fmt.Errorf("failed to create transactor: %w", err)
	}

	auth.Nonce = big.NewInt(int64(nonce))
	auth.GasPrice = gasPrice
	auth.Context = ctx

	return auth, nil
}

// Close closes the RPC connection.
func (c *Client) Close() {
	c.ETH.Close()
}
