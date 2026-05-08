import { pgTable, uuid, text, jsonb, timestamp, integer } from 'drizzle-orm/pg-core'

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
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
