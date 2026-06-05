import { pgTable, uuid, text, jsonb, timestamp, integer, index, boolean } from 'drizzle-orm/pg-core'

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  // Privy DID is the stable account identifier across wallet switches.
  // Nullable for backward-compat with legacy rows created pre-Privy; the
  // first /api/auth/login call attaches it. Once set, multiple OKX wallets
  // can share one user row by mapping to the same privy_id.
  privyId: text('privy_id').unique(),
  // Current active wallet for this Privy account. Updates whenever the
  // user switches accounts in their external wallet (OKX, MetaMask, …)
  // and re-authenticates — see getOrCreateUserByPrivy() in service.ts.
  wallet: text('wallet').notNull().unique(),
  credits: integer('credits').default(0).notNull(),
  identityTokenId: text('identity_token_id'),
  identityTxHash: text('identity_tx_hash'),
  identityMintedAt: timestamp('identity_minted_at', { withTimezone: true }),
  // Set by lib/credits/postMintHooks.prefundUserWallet — non-null means the
  // admin already shipped this user their starter native gas + USDC after
  // mint. Used to keep the side-effect idempotent across retries.
  prefundedAt: timestamp('prefunded_at', { withTimezone: true }),
  // ─── Notification preferences (all user-supplied) ──────────────
  // User runs their own Resend (or compatible) email account + their own
  // Telegram bot. Platform doesn't host a shared bot or pay for email —
  // each user is fully independent. Both api_key and bot_token are
  // sensitive: redact before logging to messages.tool_payload.
  notifyEmail: text('notify_email'),
  emailApiKey: text('email_api_key'),
  emailFrom: text('email_from'),
  telegramBotToken: text('telegram_bot_token'),
  telegramChatId: text('telegram_chat_id'),
  reputationScore: integer('reputation_score').default(0).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const workflows = pgTable('workflows', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  prompt: text('prompt').notNull(),
  status: text('status').default('planning').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  // ─── ERC-8183 lifecycle (one job per workflow). All optional — when
  //     ERC8183_ENABLED is off these stay null and the workflow still runs
  //     through the off-chain skill dispatch path. When enabled, the
  //     create+fund tx hashes are written on workflow create and the
  //     submit+complete tx hashes are written from finalizeReport. ────
  erc8183JobId: text('erc8183_job_id'),
  erc8183CreateTx: text('erc8183_create_tx'),
  // Admin-signed setBudget tx (Plan A only — provider role) between
  // user's createJob and approve/fund. Null in legacy admin-self-loop mode.
  erc8183SetBudgetTx: text('erc8183_set_budget_tx'),
  erc8183ApproveTx: text('erc8183_approve_tx'),
  erc8183FundTx: text('erc8183_fund_tx'),
  erc8183SubmitTx: text('erc8183_submit_tx'),
  erc8183CompleteTx: text('erc8183_complete_tx'),
  erc8183DeliverableHash: text('erc8183_deliverable_hash'),
  erc8183BudgetUsdc: text('erc8183_budget_usdc'),
  erc8183ReputationTx: text('erc8183_reputation_tx'),
})

export const creditLedger = pgTable('credit_ledger', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  delta: integer('delta').notNull(),
  reason: text('reason').notNull(),
  workflowId: uuid('workflow_id').references(() => workflows.id, { onDelete: 'set null' }),
  txHash: text('tx_hash'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export type User = typeof users.$inferSelect
export type CreditLedger = typeof creditLedger.$inferSelect

export const skills = pgTable('skills', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  manifest: jsonb('manifest').notNull(),
  endpoint: text('endpoint').notNull(),
  ownerId: uuid('owner_id'),
  agentTokenId: text('agent_token_id'),
  agentTxHash: text('agent_tx_hash'),
  agentMintedAt: timestamp('agent_minted_at', { withTimezone: true }),
  reputationScore: integer('reputation_score').default(0).notNull(),
})

export const nodes = pgTable('nodes', {
  id: uuid('id').primaryKey().defaultRandom(),
  workflowId: uuid('workflow_id').references(() => workflows.id, { onDelete: 'cascade' }).notNull(),
  kind: text('kind').notNull(),
  label: text('label').notNull(),
  skillId: uuid('skill_id').references(() => skills.id),
  status: text('status').default('pending').notNull(),
  output: jsonb('output'),
  dependsOn: text('depends_on').array(),
  input: jsonb('input'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  timing: jsonb('timing'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  workflowId: uuid('workflow_id').references(() => workflows.id, { onDelete: 'cascade' }).notNull(),
  role: text('role').notNull(),
  content: text('content'),
  nodeId: uuid('node_id').references(() => nodes.id, { onDelete: 'set null' }),
  toolName: text('tool_name'),
  toolPayload: jsonb('tool_payload'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export type Workflow = typeof workflows.$inferSelect
export type NewWorkflow = typeof workflows.$inferInsert
export type Skill = typeof skills.$inferSelect
export type Node = typeof nodes.$inferSelect
export type Message = typeof messages.$inferSelect
export type NewMessage = typeof messages.$inferInsert

export const deployments = pgTable('deployments', {
  id: uuid('id').primaryKey().defaultRandom(),
  workflowId: uuid('workflow_id').references(() => workflows.id, { onDelete: 'cascade' }).notNull(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  cronExpression: text('cron_expression').default('*/30 * * * *').notNull(),
  status: text('status').default('active').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('deployments_workflow_id_idx').on(table.workflowId),
  index('deployments_user_id_idx').on(table.userId),
])

export type Deployment = typeof deployments.$inferSelect
export type NewDeployment = typeof deployments.$inferInsert

export const raffles = pgTable('raffles', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  title: text('title').notNull(),
  description: text('description'),
  prizeDescription: text('prize_description'),
  winnerCount: integer('winner_count').notNull(),
  totalEntries: integer('total_entries').notNull(),
  merkleRoot: text('merkle_root').notNull(),
  commitBlock: integer('commit_block').notNull(),
  drawn: boolean('drawn').default(false).notNull(),
  seed: text('seed'),
  onChainRaffleId: integer('on_chain_raffle_id'),
  txHash: text('tx_hash'),
  contractAddress: text('contract_address'),
  cosmicProof: jsonb('cosmic_proof'),
  rawEntries: text('raw_entries').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('raffles_user_id_idx').on(table.userId),
])

export const raffleWinners = pgTable('raffle_winners', {
  id: uuid('id').primaryKey().defaultRandom(),
  raffleId: uuid('raffle_id').references(() => raffles.id, { onDelete: 'cascade' }).notNull(),
  index: integer('index').notNull(),
  username: text('username').notNull(),
  merkleProof: jsonb('merkle_proof').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('raffle_winners_raffle_id_idx').on(table.raffleId),
])

export type Raffle = typeof raffles.$inferSelect
export type NewRaffle = typeof raffles.$inferInsert
export type RaffleWinner = typeof raffleWinners.$inferSelect
export type NewRaffleWinner = typeof raffleWinners.$inferInsert

export const chainJobs = pgTable('chain_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  workflowId: uuid('workflow_id').references(() => workflows.id, { onDelete: 'cascade' }).notNull(),
  kind: text('kind').notNull(),
  status: text('status').default('pending').notNull(),
  idempotencyKey: text('idempotency_key').notNull().unique(),
  payload: jsonb('payload').notNull(),
  attempts: integer('attempts').default(0).notNull(),
  lastError: text('last_error'),
  txHash: text('tx_hash'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export type ChainJob = typeof chainJobs.$inferSelect
export type NewChainJob = typeof chainJobs.$inferInsert
