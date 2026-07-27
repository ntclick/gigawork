/**
 * SignalThesis — defensible thesis format for strategy and trading signal outputs.
 * Every strategy call includes supporting arguments, a mandatory counterpoint,
 * an invalidation condition, a calibrated confidence score, and data source attribution.
 */
export interface SignalThesis {
  /** Overall verdict: 'Long' | 'Short' | 'Neutral' | 'Skip' or strategy-specific label */
  verdict: string
  /** Calibrated confidence score (0-100) */
  confidence: number
  /** 2-3 concrete, checkable reasons supporting the call */
  supporting: string[]
  /** Mandatory single strongest reason this call could be wrong */
  counterpoint: string
  /** Specific condition that would flip this call */
  invalidation: string
  /** Data source attribution, e.g. "Binance BTC/USDT 4h klines, RSI(14) + EMA(50,200)" */
  dataSource: string
}

/**
 * Type guard to check if an object satisfies the SignalThesis shape.
 */
export function isSignalThesis(obj: unknown): obj is SignalThesis {
  if (!obj || typeof obj !== 'object') return false
  const r = obj as Record<string, unknown>
  return (
    typeof r.verdict === 'string' &&
    typeof r.confidence === 'number' &&
    Array.isArray(r.supporting) &&
    typeof r.counterpoint === 'string' &&
    typeof r.invalidation === 'string' &&
    typeof r.dataSource === 'string'
  )
}
