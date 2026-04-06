package worker

import (
	"context"
	"log"
	"math/big"
	"time"

	"gigawork/internal/chain"
	"gigawork/internal/db"
)

// AutoSettleWorker checks for PENDING_REVIEW jobs past 24h and calls autoSettle.
type AutoSettleWorker struct {
	chainClient *chain.Client
	escrow      *chain.EscrowContract
	db          *db.Client
	interval    time.Duration
}

func NewAutoSettleWorker(
	chainClient *chain.Client,
	escrow *chain.EscrowContract,
	dbClient *db.Client,
) *AutoSettleWorker {
	return &AutoSettleWorker{
		chainClient: chainClient,
		escrow:      escrow,
		db:          dbClient,
		interval:    5 * time.Minute,
	}
}

func (w *AutoSettleWorker) Start(ctx context.Context) {
	log.Printf("[auto-settle] started (interval: %s)", w.interval)
	ticker := time.NewTicker(w.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			w.checkAndSettle(ctx)
		case <-ctx.Done():
			log.Println("[auto-settle] shutting down")
			return
		}
	}
}

func (w *AutoSettleWorker) checkAndSettle(ctx context.Context) {
	cutoff := time.Now().Add(-24 * time.Hour)

	jobs, err := w.db.GetPendingReviewJobs(ctx, cutoff)
	if err != nil {
		log.Printf("[auto-settle] failed to query pending jobs: %v", err)
		return
	}

	if len(jobs) == 0 {
		return
	}

	log.Printf("[auto-settle] found %d jobs eligible for auto-settlement", len(jobs))

	for _, job := range jobs {
		if err := w.settleJob(ctx, job.JobID); err != nil {
			log.Printf("[auto-settle] failed to settle job #%d: %v", job.JobID, err)
		} else {
			log.Printf("[auto-settle] settled job #%d", job.JobID)
		}
	}
}

func (w *AutoSettleWorker) settleJob(ctx context.Context, jobID int64) error {
	auth, err := w.chainClient.Signer(ctx)
	if err != nil {
		return err
	}

	tx, err := w.escrow.AutoSettle(auth, big.NewInt(jobID))
	if err != nil {
		return err
	}

	log.Printf("[auto-settle] tx sent for job #%d: %s", jobID, tx.Hash().Hex())
	return nil
}
