package worker

import (
	"context"
	"encoding/hex"
	"log"
	"math/big"
	"time"

	"gigawork/internal/chain"
	"gigawork/internal/db"
	"gigawork/internal/matching"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/ethclient"
)

// Listener watches on-chain events and syncs to Supabase.
type Listener struct {
	wsClient     *ethclient.Client
	escrow       *chain.EscrowContract
	registry     *chain.RegistryContract
	escrowAddr   common.Address
	registryAddr common.Address
	db           *db.Client
	matching     *matching.Engine
	notifier     *TelegramNotifier
}

func NewListener(
	wsClient *ethclient.Client,
	escrow *chain.EscrowContract,
	registry *chain.RegistryContract,
	dbClient *db.Client,
	matchEngine *matching.Engine,
	notifier *TelegramNotifier,
) *Listener {
	return &Listener{
		wsClient:     wsClient,
		escrow:       escrow,
		registry:     registry,
		escrowAddr:   escrow.Address,
		registryAddr: registry.Address,
		db:           dbClient,
		matching:     matchEngine,
		notifier:     notifier,
	}
}

func (l *Listener) Start(ctx context.Context) {
	query := ethereum.FilterQuery{
		Addresses: []common.Address{
			l.escrowAddr,
			l.registryAddr,
		},
	}

	logs := make(chan types.Log, 100)
	sub, err := l.wsClient.SubscribeFilterLogs(ctx, query, logs)
	if err != nil {
		log.Printf("[listener] failed to subscribe: %v, falling back to polling", err)
		l.startPolling(ctx)
		return
	}

	log.Println("[listener] subscribed to on-chain events")

	for {
		select {
		case vLog := <-logs:
			l.handleLog(ctx, vLog)
		case err := <-sub.Err():
			log.Printf("[listener] subscription error: %v, reconnecting...", err)
			time.Sleep(5 * time.Second)
			sub, err = l.wsClient.SubscribeFilterLogs(ctx, query, logs)
			if err != nil {
				log.Printf("[listener] reconnect failed: %v", err)
				return
			}
		case <-ctx.Done():
			log.Println("[listener] shutting down")
			return
		}
	}
}

func (l *Listener) startPolling(ctx context.Context) {
	ticker := time.NewTicker(10 * time.Second)
	var lastBlock uint64

	for {
		select {
		case <-ticker.C:
			currentBlock, err := l.wsClient.BlockNumber(ctx)
			if err != nil {
				log.Printf("[listener-poll] block number error: %v", err)
				continue
			}

			if lastBlock == 0 {
				lastBlock = currentBlock
				continue
			}

			if currentBlock <= lastBlock {
				continue
			}

			query := ethereum.FilterQuery{
				FromBlock: new(big.Int).SetUint64(lastBlock + 1),
				ToBlock:   new(big.Int).SetUint64(currentBlock),
				Addresses: []common.Address{l.escrowAddr, l.registryAddr},
			}

			logs, err := l.wsClient.FilterLogs(ctx, query)
			if err != nil {
				log.Printf("[listener-poll] filter logs error: %v", err)
				continue
			}

			for _, vLog := range logs {
				l.handleLog(ctx, vLog)
			}

			lastBlock = currentBlock
		case <-ctx.Done():
			return
		}
	}
}

func (l *Listener) handleLog(ctx context.Context, vLog types.Log) {
	if len(vLog.Topics) == 0 {
		return
	}

	switch vLog.Topics[0] {
	case chain.JobPostedTopic:
		l.handleJobPosted(ctx, vLog)
	case chain.BidAcceptedTopic:
		l.handleBidAccepted(ctx, vLog)
	case chain.ResultSubmittedTopic:
		l.handleResultSubmitted(ctx, vLog)
	case chain.JobSettledTopic:
		l.handleJobSettled(ctx, vLog)
	case chain.AgentRegisteredTopic:
		l.handleAgentRegistered(ctx, vLog)
	case chain.ReputationUpdatedTopic:
		l.handleReputationUpdated(ctx, vLog)
	case chain.DisputeRaisedTopic:
		l.handleDisputeRaised(ctx, vLog)
	}
}

func (l *Listener) handleJobPosted(ctx context.Context, vLog types.Log) {
	if len(vLog.Topics) < 3 {
		return
	}

	jobID := new(big.Int).SetBytes(vLog.Topics[1].Bytes()).Int64()
	employer := common.BytesToAddress(vLog.Topics[2].Bytes()).Hex()
	txHash := vLog.TxHash.Hex()

	// Parse non-indexed data
	data := vLog.Data
	if len(data) < 96 {
		return
	}

	jobType := new(big.Int).SetBytes(data[0:32]).Uint64()
	estimatedHours := new(big.Int).SetBytes(data[32:64])
	deposit := new(big.Int).SetBytes(data[64:96])

	jobTypeName := chain.JobTypeNames[uint8(jobType)]
	hours := float64(estimatedHours.Int64())
	depositF := usdcToFloat(deposit)

	status := "OPEN"
	if deposit.Sign() > 0 {
		status = "MATCHING"
	}

	job := &db.Job{
		JobID:          jobID,
		Employer:       employer,
		JobType:        jobTypeName,
		EstimatedHours: &hours,
		DepositAmount:  &depositF,
		Status:         status,
	}

	if err := l.db.UpsertJob(ctx, job); err != nil {
		log.Printf("[listener] failed to upsert job %d: %v", jobID, err)
	} else {
		log.Printf("[listener] job posted: #%d by %s", jobID, employer)
		_ = l.db.InsertJobEvent(ctx, &db.JobEvent{JobID: jobID, EventType: "POSTED", Actor: &employer, TxHash: &txHash})
	}

	// Trigger matching engine for the new job
	if l.matching != nil {
		go l.matching.NotifyMatches(ctx, job)
	}
}

func (l *Listener) handleBidAccepted(ctx context.Context, vLog types.Log) {
	if len(vLog.Topics) < 3 {
		return
	}

	jobID := new(big.Int).SetBytes(vLog.Topics[1].Bytes()).Int64()
	worker := common.BytesToAddress(vLog.Topics[2].Bytes()).Hex()
	txHash := vLog.TxHash.Hex()

	data := vLog.Data
	if len(data) < 32 {
		return
	}

	agreedRate := new(big.Int).SetBytes(data[0:32])
	rateF := usdcToFloat(agreedRate)

	now := time.Now()
	job := &db.Job{
		JobID:          jobID,
		WorkerAgent:    &worker,
		HourlyRateUSDC: &rateF,
		Status:         "IN_PROGRESS",
		StartTS:        &now,
	}

	if err := l.db.UpsertJob(ctx, job); err != nil {
		log.Printf("[listener] failed to update job %d on bid accepted: %v", jobID, err)
	} else {
		log.Printf("[listener] bid accepted: job #%d → worker %s", jobID, worker)
		_ = l.db.InsertJobEvent(ctx, &db.JobEvent{JobID: jobID, EventType: "BID_ACCEPTED", Actor: &worker, TxHash: &txHash})
		_ = l.db.InsertAgentActivity(ctx, &db.AgentActivityLog{Agent: worker, Action: "BID_ACCEPTED", JobID: &jobID, TxHash: &txHash})
	}
}

func (l *Listener) handleResultSubmitted(ctx context.Context, vLog types.Log) {
	if len(vLog.Topics) < 3 {
		return
	}

	jobID := new(big.Int).SetBytes(vLog.Topics[1].Bytes()).Int64()
	txHash := vLog.TxHash.Hex()

	data := vLog.Data
	if len(data) < 32 {
		return
	}

	resultHash := "0x" + hex.EncodeToString(data[0:32])
	now := time.Now()

	job := &db.Job{
		JobID:             jobID,
		ResultHash:        &resultHash,
		Status:            "PENDING_REVIEW",
		EndTS:             &now,
		ResultSubmittedAt: &now,
	}

	if err := l.db.UpsertJob(ctx, job); err != nil {
		log.Printf("[listener] failed to update job %d on result submitted: %v", jobID, err)
	} else {
		log.Printf("[listener] result submitted: job #%d", jobID)
		dbJob, _ := l.db.GetJob(ctx, jobID)
		var workerActor *string
		if dbJob != nil && dbJob.WorkerAgent != nil {
			workerActor = dbJob.WorkerAgent
			_ = l.db.InsertAgentActivity(ctx, &db.AgentActivityLog{Agent: *dbJob.WorkerAgent, Action: "SUBMITTED_RESULT", JobID: &jobID, TxHash: &txHash})
		}
		_ = l.db.InsertJobEvent(ctx, &db.JobEvent{JobID: jobID, EventType: "RESULT_SUBMITTED", Actor: workerActor, TxHash: &txHash})
	}
}

func (l *Listener) handleJobSettled(ctx context.Context, vLog types.Log) {
	if len(vLog.Topics) < 2 {
		return
	}

	jobID := new(big.Int).SetBytes(vLog.Topics[1].Bytes()).Int64()
	txHash := vLog.TxHash.Hex()

	data := vLog.Data
	if len(data) < 96 {
		return
	}

	workerPayout := usdcToFloat(new(big.Int).SetBytes(data[0:32]))
	platformFee := usdcToFloat(new(big.Int).SetBytes(data[32:64]))
	refund := usdcToFloat(new(big.Int).SetBytes(data[64:96]))

	actualCharge := workerPayout + platformFee

	job := &db.Job{
		JobID:        jobID,
		WorkerPayout: &workerPayout,
		PlatformFee:  &platformFee,
		ActualCharge: &actualCharge,
		Status:       "SETTLED",
	}
	_ = refund // refund goes back to employer

	if err := l.db.UpsertJob(ctx, job); err != nil {
		log.Printf("[listener] failed to update job %d on settled: %v", jobID, err)
	} else {
		log.Printf("[listener] job settled: #%d (payout: %.2f USDC, fee: %.2f USDC)", jobID, workerPayout, platformFee)

		dbJob, _ := l.db.GetJob(ctx, jobID)
		var workerActor *string
		if dbJob != nil && dbJob.WorkerAgent != nil {
			workerActor = dbJob.WorkerAgent
			_ = l.db.InsertAgentActivity(ctx, &db.AgentActivityLog{Agent: *dbJob.WorkerAgent, Action: "GOT_PAID", JobID: &jobID, AmountUSDC: &workerPayout, TxHash: &txHash})
		}
		_ = l.db.InsertJobEvent(ctx, &db.JobEvent{JobID: jobID, EventType: "SETTLED", Actor: workerActor, TxHash: &txHash})
	}
}

func (l *Listener) handleAgentRegistered(ctx context.Context, vLog types.Log) {
	if len(vLog.Topics) < 2 {
		return
	}

	agentAddr := common.BytesToAddress(vLog.Topics[1].Bytes()).Hex()
	txHash := vLog.TxHash.Hex()

	data := vLog.Data
	if len(data) < 64 {
		return
	}

	tokenID := new(big.Int).SetBytes(data[0:32]).Int64()
	hourlyRate := usdcToFloat(new(big.Int).SetBytes(data[32:64]))

	agent := &db.Agent{
		Address:         agentAddr,
		ERC8004TokenID:  tokenID,
		HourlyRateUSDC:  hourlyRate,
		ReputationScore: 500,
		IsActive:        true,
	}

	if err := l.db.UpsertAgent(ctx, agent); err != nil {
		log.Printf("[listener] failed to upsert agent %s: %v", agentAddr, err)
	} else {
		log.Printf("[listener] agent registered: %s (rate: %.2f USDC/hr)", agentAddr, hourlyRate)
		_ = l.db.InsertAgentActivity(ctx, &db.AgentActivityLog{Agent: agentAddr, Action: "REGISTERED", TxHash: &txHash})
	}
}

func (l *Listener) handleReputationUpdated(ctx context.Context, vLog types.Log) {
	if len(vLog.Topics) < 2 {
		return
	}

	agentAddr := common.BytesToAddress(vLog.Topics[1].Bytes()).Hex()
	txHash := vLog.TxHash.Hex()

	data := vLog.Data
	if len(data) < 64 {
		return
	}

	newScore := int(new(big.Int).SetBytes(data[0:32]).Int64())
	jobsDone := int(new(big.Int).SetBytes(data[32:64]).Int64())

	agent, err := l.db.GetAgent(ctx, agentAddr)
	if err != nil {
		log.Printf("[listener] agent %s not found for reputation update: %v", agentAddr, err)
		return
	}

	oldScore := agent.ReputationScore
	agent.ReputationScore = newScore
	agent.TotalJobsDone = jobsDone

	if err := l.db.UpsertAgent(ctx, agent); err != nil {
		log.Printf("[listener] failed to update agent %s reputation: %v", agentAddr, err)
	} else {
		_ = l.db.InsertAgentActivity(ctx, &db.AgentActivityLog{
			Agent:    agentAddr,
			Action:   "REPUTATION_UPDATED",
			TxHash:   &txHash,
			Metadata: map[string]int{"old_score": oldScore, "new_score": newScore},
		})
	}
}

func (l *Listener) handleDisputeRaised(ctx context.Context, vLog types.Log) {
	if len(vLog.Topics) < 3 {
		return
	}

	jobID := new(big.Int).SetBytes(vLog.Topics[1].Bytes()).Int64()
	txHash := vLog.TxHash.Hex()

	job := &db.Job{
		JobID:  jobID,
		Status: "DISPUTED",
	}

	if err := l.db.UpsertJob(ctx, job); err != nil {
		log.Printf("[listener] failed to update job %d on dispute: %v", jobID, err)
	} else {
		log.Printf("[listener] dispute raised: job #%d", jobID)
		_ = l.db.InsertJobEvent(ctx, &db.JobEvent{JobID: jobID, EventType: "DISPUTED", TxHash: &txHash})
		
		dbJob, _ := l.db.GetJob(ctx, jobID)
		if dbJob != nil && dbJob.WorkerAgent != nil {
			_ = l.db.InsertAgentActivity(ctx, &db.AgentActivityLog{Agent: *dbJob.WorkerAgent, Action: "DISPUTED", JobID: &jobID, TxHash: &txHash})
		}
	}
}

// usdcToFloat converts USDC amount (6 decimals) to float64.
func usdcToFloat(amount *big.Int) float64 {
	f := new(big.Float).SetInt(amount)
	divisor := new(big.Float).SetInt64(1_000_000)
	result, _ := new(big.Float).Quo(f, divisor).Float64()
	return result
}
