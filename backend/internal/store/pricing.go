package store

// CalculateReusePrice returns the discounted price for a cache hit.
// reuse_price = original_price * 0.4
func CalculateReusePrice(originalPrice float64) float64 {
	return originalPrice * 0.4
}

// RevenueSplit represents the distribution of a successful run or reuse.
type RevenueSplit struct {
	AgentOperator float64
	Platform      float64
	SharedPool    float64
}

// SplitRun calculates the revenue split for a fresh run.
func SplitRun(price float64) RevenueSplit {
	return RevenueSplit{
		AgentOperator: price * 0.90, // 90% for a fresh run
		Platform:      price * 0.10,
		SharedPool:    0,
	}
}

// SplitReuse calculates the revenue split for a reused output (cache hit).
// 60% original agent, 30% platform, 10% shared pool.
func SplitReuse(price float64) RevenueSplit {
	return RevenueSplit{
		AgentOperator: price * 0.60,
		Platform:      price * 0.30,
		SharedPool:    price * 0.10,
	}
}
