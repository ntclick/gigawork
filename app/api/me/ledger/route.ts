import { NextResponse } from 'next/server'
import { desc, eq } from 'drizzle-orm'

import { AuthRequiredError, getCurrentUser } from '@/lib/auth/session'
import { db } from '@/lib/db/client'
import { withDbRetry } from '@/lib/db/retry'
import { creditLedger } from '@/lib/db/schema'

export async function GET() {
  try {
    const u = await getCurrentUser()
    const rows = await withDbRetry(
      () => db
        .select()
        .from(creditLedger)
        .where(eq(creditLedger.userId, u.id))
        .orderBy(desc(creditLedger.createdAt))
        .limit(50),
      { label: 'ledger' },
    )
    return NextResponse.json({ ledger: rows })
  } catch (e) {
    if (e instanceof AuthRequiredError) {
      return NextResponse.json({ ledger: [], error: 'unauthenticated' }, { status: 401 })
    }
    console.error('[/api/me/ledger] failed after retries', e)
    return NextResponse.json({ ledger: [], error: 'db_unavailable' }, { status: 503 })
  }
}
