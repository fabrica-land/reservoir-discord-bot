import dotenv from 'dotenv'
import logger from './utils/logger'
import Discord from './discord'
import waitPort from 'wait-port'
import {DISCORD_TOKEN, REDIS_URL, RESERVOIR_API_KEY} from './env'

(async () => {
  try {
    // Setup env vars
    dotenv.config()

    // Setup Discord
    const discord = new Discord(DISCORD_TOKEN, RESERVOIR_API_KEY, REDIS_URL)
    const url = new URL(REDIS_URL)

    const params = {
      host: url.hostname,
      port: parseInt(url.port, 10),
    }

    waitPort(params).then(async ({ open, ipVersion }) => {
      if (open) {
        logger.info(`The port is now open on IPv${ipVersion}!`)
        // Listen for Discord events
        await discord.handleEvents()
      } else logger.info('The port did not open before the timeout...')
    })
  } catch (e) {
    if (e instanceof Error) {
      logger.error(e)
      throw new Error(e.message)
    } else {
      logger.error(e)
      throw new Error('Unexpected error')
    }
  }
})()
