package blockchain

import (
	"context"
	"fmt"
	"log"
	"math/big"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/common"

	"gigawork/internal/chain"
)

const commerceABI = `[
	{"name":"setBudget","type":"function","stateMutability":"nonpayable",
	 "inputs":[{"name":"jobId","type":"uint256"},{"name":"amount","type":"uint256"},
	           {"name":"optParams","type":"bytes"}],"outputs":[]},
	{"name":"submit","type":"function","stateMutability":"nonpayable",
	 "inputs":[{"name":"jobId","type":"uint256"},{"name":"deliverable","type":"bytes32"},
	           {"name":"optParams","type":"bytes"}],"outputs":[]},
	{"name":"complete","type":"function","stateMutability":"nonpayable",
	 "inputs":[{"name":"jobId","type":"uint256"},{"name":"reason","type":"bytes32"},
	           {"name":"optParams","type":"bytes"}],"outputs":[]},
	{"name":"cancel","type":"function","stateMutability":"nonpayable",
	 "inputs":[{"name":"jobId","type":"uint256"}],"outputs":[]}
]`

const CommerceAddr = "0xefe28B2FB1146A5d95c7E5e134cEF7a180D47e34"

// Signer handles on-chain ERC-8183 operations via the server wallet.
type Signer struct {
	chain       *chain.Client
	commerceABI abi.ABI
	commerceAddr common.Address
}

// NewSigner creates a new blockchain signer for the Commerce contract.
func NewSigner(chainClient *chain.Client) (*Signer, error) {
	if chainClient == nil || chainClient.PrivateKey == nil {
		return nil, fmt.Errorf("chain client with private key required")
	}

	parsed, err := abi.JSON(strings.NewReader(commerceABI))
	if err != nil {
		return nil, fmt.Errorf("parse commerce ABI: %w", err)
	}

	return &Signer{
		chain:        chainClient,
		commerceABI:  parsed,
		commerceAddr: common.HexToAddress(CommerceAddr),
	}, nil
}

// SetBudget calls setBudget(jobId, amount, "0x") on the Commerce contract.
// amount is in USDC raw units (6 decimals, e.g. 100000 = 0.10 USDC).
func (s *Signer) SetBudget(ctx context.Context, jobId *big.Int, amount *big.Int) (string, error) {
	commerce := bind.NewBoundContract(s.commerceAddr, s.commerceABI, s.chain.ETH, s.chain.ETH, s.chain.ETH)

	auth, err := s.chain.Signer(ctx)
	if err != nil {
		return "", fmt.Errorf("signer: %w", err)
	}

	tx, err := commerce.Transact(auth, "setBudget", jobId, amount, []byte{})
	if err != nil {
		return "", fmt.Errorf("setBudget tx: %w", err)
	}

	receipt, err := bind.WaitMined(ctx, s.chain.ETH, tx)
	if err != nil {
		return "", fmt.Errorf("setBudget mine: %w", err)
	}
	if receipt.Status == 0 {
		return "", fmt.Errorf("setBudget reverted")
	}

	log.Printf("[Signer] setBudget(jobId=%s, amount=%s) tx=%s", jobId, amount, tx.Hash().Hex())
	time.Sleep(2 * time.Second)
	return tx.Hash().Hex(), nil
}

// Submit calls submit(jobId, deliverableHash, "0x") on the Commerce contract.
func (s *Signer) Submit(ctx context.Context, jobId *big.Int, deliverableHash [32]byte) (string, error) {
	commerce := bind.NewBoundContract(s.commerceAddr, s.commerceABI, s.chain.ETH, s.chain.ETH, s.chain.ETH)

	auth, err := s.chain.Signer(ctx)
	if err != nil {
		return "", fmt.Errorf("signer: %w", err)
	}

	tx, err := commerce.Transact(auth, "submit", jobId, deliverableHash, []byte{})
	if err != nil {
		return "", fmt.Errorf("submit tx: %w", err)
	}

	receipt, err := bind.WaitMined(ctx, s.chain.ETH, tx)
	if err != nil {
		return "", fmt.Errorf("submit mine: %w", err)
	}
	if receipt.Status == 0 {
		return "", fmt.Errorf("submit reverted")
	}

	log.Printf("[Signer] submit(jobId=%s) tx=%s", jobId, tx.Hash().Hex())
	time.Sleep(2 * time.Second)
	return tx.Hash().Hex(), nil
}

// Complete calls complete(jobId, keccak256("approved"), "0x") on the Commerce contract.
func (s *Signer) Complete(ctx context.Context, jobId *big.Int) (string, error) {
	commerce := bind.NewBoundContract(s.commerceAddr, s.commerceABI, s.chain.ETH, s.chain.ETH, s.chain.ETH)

	auth, err := s.chain.Signer(ctx)
	if err != nil {
		return "", fmt.Errorf("signer: %w", err)
	}

	// reason = keccak256("approved")
	reason := common.BytesToHash([]byte("approved"))

	tx, err := commerce.Transact(auth, "complete", jobId, reason, []byte{})
	if err != nil {
		return "", fmt.Errorf("complete tx: %w", err)
	}

	receipt, err := bind.WaitMined(ctx, s.chain.ETH, tx)
	if err != nil {
		return "", fmt.Errorf("complete mine: %w", err)
	}
	if receipt.Status == 0 {
		return "", fmt.Errorf("complete reverted")
	}

	log.Printf("[Signer] complete(jobId=%s) tx=%s", jobId, tx.Hash().Hex())
	return tx.Hash().Hex(), nil
}

// CancelJob calls cancel(jobId) on the Commerce contract to release escrowed funds.
func (s *Signer) CancelJob(ctx context.Context, jobId *big.Int) (string, error) {
	commerce := bind.NewBoundContract(s.commerceAddr, s.commerceABI, s.chain.ETH, s.chain.ETH, s.chain.ETH)

	auth, err := s.chain.Signer(ctx)
	if err != nil {
		return "", fmt.Errorf("signer: %w", err)
	}

	tx, err := commerce.Transact(auth, "cancel", jobId)
	if err != nil {
		return "", fmt.Errorf("cancel tx: %w", err)
	}

	receipt, err := bind.WaitMined(ctx, s.chain.ETH, tx)
	if err != nil {
		return "", fmt.Errorf("cancel mine: %w", err)
	}
	if receipt.Status == 0 {
		return "", fmt.Errorf("cancel reverted")
	}

	log.Printf("[Signer] cancel(jobId=%s) tx=%s", jobId, tx.Hash().Hex())
	return tx.Hash().Hex(), nil
}

// ─── USDC transfer helpers ──────────────────────────────────────────

const usdcABIJSON = `[
	{"name":"transferFrom","type":"function","stateMutability":"nonpayable",
	 "inputs":[{"name":"from","type":"address"},{"name":"to","type":"address"},{"name":"amount","type":"uint256"}],
	 "outputs":[{"name":"","type":"bool"}]},
	{"name":"transfer","type":"function","stateMutability":"nonpayable",
	 "inputs":[{"name":"to","type":"address"},{"name":"amount","type":"uint256"}],
	 "outputs":[{"name":"","type":"bool"}]}
]`

// CollectUSDC calls transferFrom(userAddr, serverWallet, amount) on USDC.
// Requires user to have approved serverWallet for >= amount.
func (s *Signer) CollectUSDC(ctx context.Context, userAddr common.Address, amount *big.Int) (string, error) {
	usdcABI, err := abi.JSON(strings.NewReader(usdcABIJSON))
	if err != nil {
		return "", fmt.Errorf("parse usdc ABI: %w", err)
	}

	usdcAddr := common.HexToAddress(CommerceAddr[:2] + "3600000000000000000000000000000000000000"[2:])
	// Correct USDC address
	usdcAddr = common.HexToAddress("0x3600000000000000000000000000000000000000")

	usdc := bind.NewBoundContract(usdcAddr, usdcABI, s.chain.ETH, s.chain.ETH, s.chain.ETH)

	auth, err := s.chain.Signer(ctx)
	if err != nil {
		return "", fmt.Errorf("signer: %w", err)
	}

	serverAddr := s.chain.Address
	log.Printf("[Signer] transferFrom(%s → %s, %s USDC raw)", userAddr.Hex(), serverAddr.Hex(), amount)

	tx, err := usdc.Transact(auth, "transferFrom", userAddr, serverAddr, amount)
	if err != nil {
		return "", fmt.Errorf("transferFrom tx: %w", err)
	}

	receipt, err := bind.WaitMined(ctx, s.chain.ETH, tx)
	if err != nil {
		return "", fmt.Errorf("transferFrom mine: %w", err)
	}
	if receipt.Status == 0 {
		return "", fmt.Errorf("transferFrom reverted (insufficient allowance or balance)")
	}

	log.Printf("[Signer] Collected %s USDC from %s tx=%s", amount, userAddr.Hex(), tx.Hash().Hex())
	return tx.Hash().Hex(), nil
}

// RefundUSDC sends USDC back to user via transfer(to, amount).
func (s *Signer) RefundUSDC(ctx context.Context, userAddr common.Address, amount *big.Int) (string, error) {
	usdcABI, err := abi.JSON(strings.NewReader(usdcABIJSON))
	if err != nil {
		return "", fmt.Errorf("parse usdc ABI: %w", err)
	}

	usdcAddr := common.HexToAddress("0x3600000000000000000000000000000000000000")
	usdc := bind.NewBoundContract(usdcAddr, usdcABI, s.chain.ETH, s.chain.ETH, s.chain.ETH)

	auth, err := s.chain.Signer(ctx)
	if err != nil {
		return "", fmt.Errorf("signer: %w", err)
	}

	tx, err := usdc.Transact(auth, "transfer", userAddr, amount)
	if err != nil {
		return "", fmt.Errorf("refund tx: %w", err)
	}

	receipt, err := bind.WaitMined(ctx, s.chain.ETH, tx)
	if err != nil {
		return "", fmt.Errorf("refund mine: %w", err)
	}
	if receipt.Status == 0 {
		return "", fmt.Errorf("refund reverted")
	}

	log.Printf("[Signer] Refunded %s USDC to %s tx=%s", amount, userAddr.Hex(), tx.Hash().Hex())
	return tx.Hash().Hex(), nil
}
