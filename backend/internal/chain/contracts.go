package chain

import (
	_ "embed"
	"fmt"
	"math/big"
	"strings"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"
)

//go:embed abis/GigaWorkEscrow.json
var escrowABIJSON string

//go:embed abis/GigaWorkRegistry.json
var registryABIJSON string

// Event topic hashes
var (
	JobPostedTopic       = crypto.Keccak256Hash([]byte("JobPosted(uint256,address,uint8,uint256,uint256)"))
	BidSubmittedTopic    = crypto.Keccak256Hash([]byte("BidSubmitted(uint256,address,uint256)"))
	BidAcceptedTopic     = crypto.Keccak256Hash([]byte("BidAccepted(uint256,address,uint256)"))
	ResultSubmittedTopic = crypto.Keccak256Hash([]byte("ResultSubmitted(uint256,address,bytes32)"))
	JobSettledTopic      = crypto.Keccak256Hash([]byte("JobSettled(uint256,uint256,uint256,uint256)"))
	DisputeRaisedTopic   = crypto.Keccak256Hash([]byte("DisputeRaised(uint256,address,string)"))
	DisputeResolvedTopic = crypto.Keccak256Hash([]byte("DisputeResolved(uint256,bool)"))
	AgentRegisteredTopic = crypto.Keccak256Hash([]byte("AgentRegistered(address,uint256,uint256)"))
	ReputationUpdatedTopic = crypto.Keccak256Hash([]byte("ReputationUpdated(address,uint256,uint256)"))
)

// Job type enum mapping
var JobTypeNames = map[uint8]string{
	0: "ONCHAIN",
	1: "OFFCHAIN_AI",
	2: "SCRAPING",
	3: "WORKFLOW",
}

// Job status enum mapping
var JobStatusNames = map[uint8]string{
	0: "OPEN",
	1: "MATCHING",
	2: "FUNDED",
	3: "IN_PROGRESS",
	4: "PENDING_REVIEW",
	5: "SETTLED",
	6: "DISPUTED",
	7: "EXPIRED",
}

// EscrowContract wraps GigaWorkEscrow interactions.
type EscrowContract struct {
	Address  common.Address
	ABI      abi.ABI
	contract *bind.BoundContract
}

// RegistryContract wraps GigaWorkRegistry interactions.
type RegistryContract struct {
	Address  common.Address
	ABI      abi.ABI
	contract *bind.BoundContract
}

func NewEscrowContract(address string, client *ethclient.Client) (*EscrowContract, error) {
	parsed, err := abi.JSON(strings.NewReader(escrowABIJSON))
	if err != nil {
		return nil, fmt.Errorf("failed to parse escrow ABI: %w", err)
	}

	addr := common.HexToAddress(address)
	bc := bind.NewBoundContract(addr, parsed, client, client, client)

	return &EscrowContract{
		Address:  addr,
		ABI:      parsed,
		contract: bc,
	}, nil
}

func NewRegistryContract(address string, client *ethclient.Client) (*RegistryContract, error) {
	parsed, err := abi.JSON(strings.NewReader(registryABIJSON))
	if err != nil {
		return nil, fmt.Errorf("failed to parse registry ABI: %w", err)
	}

	addr := common.HexToAddress(address)
	bc := bind.NewBoundContract(addr, parsed, client, client, client)

	return &RegistryContract{
		Address:  addr,
		ABI:      parsed,
		contract: bc,
	}, nil
}

// ─── Escrow Read Methods ─────────────────────────────────

type OnChainJob struct {
	JobId            *big.Int
	Employer         common.Address
	WorkerAgent      common.Address
	JobType          uint8
	HourlyRateUSDC   *big.Int
	EstimatedHours   *big.Int
	DepositAmount    *big.Int
	StartTimestamp   *big.Int
	EndTimestamp      *big.Int
	ResultSubmittedAt *big.Int
	ResultHash       [32]byte
	ProofURI         string
	Spec             []byte
	Status           uint8
	EmployerRating   *big.Int
}

func (e *EscrowContract) GetJob(opts *bind.CallOpts, jobId *big.Int) (*OnChainJob, error) {
	var result []interface{}
	err := e.contract.Call(opts, &result, "getJob", jobId)
	if err != nil {
		return nil, err
	}

	// The result is a struct tuple
	job := result[0].(struct {
		JobId             *big.Int       `json:"jobId"`
		Employer          common.Address `json:"employer"`
		WorkerAgent       common.Address `json:"workerAgent"`
		JobType           uint8          `json:"jobType"`
		HourlyRateUSDC    *big.Int       `json:"hourlyRateUSDC"`
		EstimatedHours    *big.Int       `json:"estimatedHours"`
		DepositAmount     *big.Int       `json:"depositAmount"`
		StartTimestamp    *big.Int       `json:"startTimestamp"`
		EndTimestamp       *big.Int       `json:"endTimestamp"`
		ResultSubmittedAt *big.Int       `json:"resultSubmittedAt"`
		ResultHash        [32]byte       `json:"resultHash"`
		ProofURI          string         `json:"proofURI"`
		Spec              []byte         `json:"spec"`
		Status            uint8          `json:"status"`
		EmployerRating    *big.Int       `json:"employerRating"`
	})

	return &OnChainJob{
		JobId:            job.JobId,
		Employer:         job.Employer,
		WorkerAgent:      job.WorkerAgent,
		JobType:          job.JobType,
		HourlyRateUSDC:   job.HourlyRateUSDC,
		EstimatedHours:   job.EstimatedHours,
		DepositAmount:    job.DepositAmount,
		StartTimestamp:   job.StartTimestamp,
		EndTimestamp:      job.EndTimestamp,
		ResultSubmittedAt: job.ResultSubmittedAt,
		ResultHash:       job.ResultHash,
		ProofURI:         job.ProofURI,
		Spec:             job.Spec,
		Status:           job.Status,
		EmployerRating:   job.EmployerRating,
	}, nil
}

func (e *EscrowContract) TotalJobs(opts *bind.CallOpts) (*big.Int, error) {
	var result []interface{}
	err := e.contract.Call(opts, &result, "totalJobs")
	if err != nil {
		return nil, err
	}
	return result[0].(*big.Int), nil
}

// ─── Escrow Write Methods ────────────────────────────────

func (e *EscrowContract) AutoSettle(opts *bind.TransactOpts, jobId *big.Int) (*types.Transaction, error) {
	return e.contract.Transact(opts, "autoSettle", jobId)
}

func (e *EscrowContract) Bid(opts *bind.TransactOpts, jobId *big.Int) (*types.Transaction, error) {
	return e.contract.Transact(opts, "bid", jobId)
}

func (e *EscrowContract) SubmitResult(opts *bind.TransactOpts, jobId *big.Int, resultHash [32]byte, proofURI string) (*types.Transaction, error) {
	return e.contract.Transact(opts, "submitResult", jobId, resultHash, proofURI)
}

// ─── Registry Read Methods ───────────────────────────────

type OnChainAgentProfile struct {
	ERC8004TokenId  *big.Int
	Owner           common.Address
	HourlyRateUSDC  *big.Int
	SkillTags       []string
	ReputationScore *big.Int
	TotalJobsDone   *big.Int
	TotalEarnedUSDC *big.Int
	IsActive        bool
	RegisteredAt    *big.Int
}

func (r *RegistryContract) GetProfile(opts *bind.CallOpts, agent common.Address) (*OnChainAgentProfile, error) {
	var result []interface{}
	err := r.contract.Call(opts, &result, "getProfile", agent)
	if err != nil {
		return nil, err
	}

	profile := result[0].(struct {
		Erc8004TokenId  *big.Int       `json:"erc8004TokenId"`
		Owner           common.Address `json:"owner"`
		HourlyRateUSDC  *big.Int       `json:"hourlyRateUSDC"`
		SkillTags       []string       `json:"skillTags"`
		ReputationScore *big.Int       `json:"reputationScore"`
		TotalJobsDone   *big.Int       `json:"totalJobsDone"`
		TotalEarnedUSDC *big.Int       `json:"totalEarnedUSDC"`
		IsActive        bool           `json:"isActive"`
		RegisteredAt    *big.Int       `json:"registeredAt"`
	})

	return &OnChainAgentProfile{
		ERC8004TokenId:  profile.Erc8004TokenId,
		Owner:           profile.Owner,
		HourlyRateUSDC:  profile.HourlyRateUSDC,
		SkillTags:       profile.SkillTags,
		ReputationScore: profile.ReputationScore,
		TotalJobsDone:   profile.TotalJobsDone,
		TotalEarnedUSDC: profile.TotalEarnedUSDC,
		IsActive:        profile.IsActive,
		RegisteredAt:    profile.RegisteredAt,
	}, nil
}

// ─── Registry Write Methods ──────────────────────────────

func (r *RegistryContract) RegisterAgent(opts *bind.TransactOpts, tokenId *big.Int, hourlyRateUSDC *big.Int, skillTags []string) (*types.Transaction, error) {
	return r.contract.Transact(opts, "registerAgent", tokenId, hourlyRateUSDC, skillTags)
}
