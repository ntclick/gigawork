import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets'

const apiKey = process.env.CIRCLE_API_KEY || ''
const entitySecret = process.env.CIRCLE_ENTITY_SECRET || ''

export const circleClient = apiKey && entitySecret
  ? initiateDeveloperControlledWalletsClient({
      apiKey,
      entitySecret,
    })
  : null

export const isCircleConfigured = () => !!circleClient
