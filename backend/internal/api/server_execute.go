package api

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
)

// Commerce ABI — matches the deployed GigaWorkCommerce.sol exactly
const commerceABIJSON = `[
	{"name":"createJob","type":"function","stateMutability":"nonpayable",
	 "inputs":[{"name":"provider","type":"address"},{"name":"evaluator","type":"address"},
	           {"name":"expiredAt","type":"uint256"},{"name":"description","type":"string"},
	           {"name":"optParams","type":"bytes"}],
	 "outputs":[{"name":"jobId","type":"uint256"}]},
	{"name":"setBudget","type":"function","stateMutability":"nonpayable",
	 "inputs":[{"name":"jobId","type":"uint256"},{"name":"amount","type":"uint256"},
	           {"name":"optParams","type":"bytes"}],"outputs":[]},
	{"name":"fund","type":"function","stateMutability":"nonpayable",
	 "inputs":[{"name":"jobId","type":"uint256"},{"name":"expectedBudget","type":"uint256"},
	           {"name":"optParams","type":"bytes"}],"outputs":[]},
	{"name":"submit","type":"function","stateMutability":"nonpayable",
	 "inputs":[{"name":"jobId","type":"uint256"},{"name":"deliverable","type":"bytes32"},
	           {"name":"optParams","type":"bytes"}],"outputs":[]},
	{"name":"complete","type":"function","stateMutability":"nonpayable",
	 "inputs":[{"name":"jobId","type":"uint256"},{"name":"reason","type":"bytes32"},
	           {"name":"optParams","type":"bytes"}],"outputs":[]},
	{"type":"event","name":"JobCreated",
	 "inputs":[{"indexed":true,"name":"jobId","type":"uint256"},
	           {"indexed":true,"name":"client","type":"address"},
	           {"name":"provider","type":"address"},
	           {"name":"evaluator","type":"address"}]}
]`

const erc20ABIJSON = `[
	{"name":"approve","type":"function","stateMutability":"nonpayable",
	 "inputs":[{"name":"spender","type":"address"},{"name":"amount","type":"uint256"}],
	 "outputs":[{"name":"","type":"bool"}]}
]`

const (
	commerceAddrHex = "0xefe28b2fb1146a5d95c7e5e134cef7a180d47e34"
	usdcAddrHex     = "0x3600000000000000000000000000000000000000"
)

// txTimeout wraps a context with a per-transaction timeout.
func txTimeout(parent context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(parent, 60*time.Second)
}

// ExecuteJobOnChain performs the full Commerce lifecycle via server wallet.
// Steps: createJob → setBudget → approve USDC → fund
// Returns (on-chain jobId, createJob tx hash, error).
func (s *Server) ExecuteJobOnChain(ctx context.Context, agentAddr string, budget float64, description string) (int64, string, error) {
	if s.ChainClient == nil || s.ChainClient.PrivateKey == nil {
		return 0, "", fmt.Errorf("server chain client not configured")
	}

	commerceAddr := common.HexToAddress(commerceAddrHex)
	usdcAddr := common.HexToAddress(usdcAddrHex)

	commerceABI, err := abi.JSON(strings.NewReader(commerceABIJSON))
	if err != nil {
		return 0, "", fmt.Errorf("parse commerce ABI: %v", err)
	}
	erc20ABI, err := abi.JSON(strings.NewReader(erc20ABIJSON))
	if err != nil {
		return 0, "", fmt.Errorf("parse erc20 ABI: %v", err)
	}

	commerce := bind.NewBoundContract(commerceAddr, commerceABI, s.ChainClient.ETH, s.ChainClient.ETH, s.ChainClient.ETH)
	usdc := bind.NewBoundContract(usdcAddr, erc20ABI, s.ChainClient.ETH, s.ChainClient.ETH, s.ChainClient.ETH)

	provider := s.ChainClient.Address
	evaluator := s.ChainClient.Address
	expiredAt := big.NewInt(time.Now().Unix() + 3600)
	budgetWei := new(big.Int).SetInt64(int64(budget * 1e6))

	// Step 1: createJob (60s timeout)
	log.Printf("[ServerExec] Creating job on-chain: provider=%s evaluator=%s budget=%.2f (agent=%s)", provider.Hex(), evaluator.Hex(), budget, agentAddr)
	txCtx1, cancel1 := txTimeout(ctx)
	defer cancel1()
	auth1, err := s.ChainClient.Signer(txCtx1)
	if err != nil {
		return 0, "", fmt.Errorf("signer: %v", err)
	}
	tx1, err := commerce.Transact(auth1, "createJob", provider, evaluator, expiredAt, description, []byte{})
	if err != nil {
		return 0, "", fmt.Errorf("createJob tx: %v", err)
	}
	receipt1, err := bind.WaitMined(txCtx1, s.ChainClient.ETH, tx1)
	if err != nil {
		return 0, "", fmt.Errorf("createJob mine: %v", err)
	}
	if receipt1.Status == 0 {
		return 0, "", fmt.Errorf("createJob reverted")
	}

	createTxHash := tx1.Hash().Hex()

	var jobId int64
	jobCreatedEvent := commerceABI.Events["JobCreated"]
	for _, vLog := range receipt1.Logs {
		if len(vLog.Topics) > 0 && vLog.Topics[0] == jobCreatedEvent.ID {
			jobId = new(big.Int).SetBytes(vLog.Topics[1].Bytes()).Int64()
			break
		}
	}
	log.Printf("[ServerExec] Job #%d created (tx: %s)", jobId, createTxHash)
	time.Sleep(2 * time.Second)

	// Step 2: setBudget (60s timeout)
	txCtx2, cancel2 := txTimeout(ctx)
	defer cancel2()
	auth2, _ := s.ChainClient.Signer(txCtx2)
	tx2, err := commerce.Transact(auth2, "setBudget", big.NewInt(jobId), budgetWei, []byte{})
	if err != nil {
		return jobId, createTxHash, fmt.Errorf("setBudget: %v", err)
	}
	if _, err := bind.WaitMined(txCtx2, s.ChainClient.ETH, tx2); err != nil {
		return jobId, createTxHash, fmt.Errorf("setBudget mine timeout: %v", err)
	}
	log.Printf("[ServerExec] Budget set")
	time.Sleep(2 * time.Second)

	// Step 3: approve USDC (60s timeout)
	txCtx3, cancel3 := txTimeout(ctx)
	defer cancel3()
	auth3, _ := s.ChainClient.Signer(txCtx3)
	tx3, err := usdc.Transact(auth3, "approve", commerceAddr, budgetWei)
	if err != nil {
		return jobId, createTxHash, fmt.Errorf("approve: %v", err)
	}
	if _, err := bind.WaitMined(txCtx3, s.ChainClient.ETH, tx3); err != nil {
		return jobId, createTxHash, fmt.Errorf("approve mine timeout: %v", err)
	}
	log.Printf("[ServerExec] USDC approved")
	time.Sleep(2 * time.Second)

	// Step 4: fund (60s timeout)
	txCtx4, cancel4 := txTimeout(ctx)
	defer cancel4()
	auth4, _ := s.ChainClient.Signer(txCtx4)
	tx4, err := commerce.Transact(auth4, "fund", big.NewInt(jobId), budgetWei, []byte{})
	if err != nil {
		return jobId, createTxHash, fmt.Errorf("fund: %v", err)
	}
	if _, err := bind.WaitMined(txCtx4, s.ChainClient.ETH, tx4); err != nil {
		return jobId, createTxHash, fmt.Errorf("fund mine timeout: %v", err)
	}
	log.Printf("[ServerExec] Job #%d funded on-chain", jobId)

	return jobId, createTxHash, nil
}
