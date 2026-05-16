import { db } from '../../lib/db/client'
import { workflows, users } from '../../lib/db/schema'
import { eq } from 'drizzle-orm'

async function run() {
  const [wf] = await db.select({
    wfId: workflows.id,
    userId: workflows.userId,
  }).from(workflows).where(eq(workflows.id, 'b4899df8-b9be-41c7-9ab8-6260a006fd59'));

  if (!wf) {
    console.log('Workflow not found');
    process.exit(0);
  }

  const [u] = await db.select().from(users).where(eq(users.id, wf.userId));
  console.log('Workflow user:', u.wallet);

  const [connectedUser] = await db.select().from(users).where(eq(users.wallet, '0x4c77584f57d385e0f2996bd4ff178c93dff034c0'));
  console.log('Connected user:', connectedUser?.id);
  console.log('Workflow user id:', u.id);

  process.exit(0);
}

run();
