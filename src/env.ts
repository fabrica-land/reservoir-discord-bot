import logger from './utils/logger'
import dotenv from 'dotenv'

dotenv.config()

const error = (message: string): void => {
  logger.error(message)
  throw new Error(message)
}

const getString = (name: string): string => {
  const value = process.env[name]
  if (!value) {
    error(`Missing env var ${name}`)
  }
  return value as string
}

const getNumber = (name: string): number => {
  const str = getString(name)
  const value = parseFloat(str)
  if (Number.isNaN(value)) {
    error(`Env var ${name} must be a number`)
  }
  return value as number
}

const getJson = (name: string): unknown => {
  const str = getString(name)
  let value
  try {
    value = JSON.parse(str)
  } catch {
    error(`Env var ${name} must valid JSON`)
  }
  return value
}

const getStringToString = (name: string): Record<string, string> => {
  const value = getJson(name)
  if (typeof value !== 'object' || Array.isArray(value) || !Object.values(value as object).every(v => typeof v === 'string')) {
    error(`Env var ${name} must be a JSON object`)
  }
  return value as Record<string, string>
}

const getStringToBool = (name: string): Record<string, boolean> => {
  const value = getJson(name)
  if (typeof value !== 'object' || Array.isArray(value) || !Object.values(value as object).every(v => typeof v === 'boolean')) {
    error(`Env var ${name} must be a JSON object`)
  }
  return value as Record<string, boolean>
}

const getStringArray = (name: string): Array<string> => {
  const value = getJson(name)
  if (typeof value !== 'object' || !Array.isArray(value) || !value.every(v => typeof v === 'string')) {
    error(`Env var ${name} must be a JSON array of string values`)
  }
  return value as Array<string>
}

export const ALERT_CONTRACT_ADDRESS = getString('ALERT_CONTRACT_ADDRESS')
export const ALERT_COOL_DOWN_SECONDS = getNumber('ALERT_COOL_DOWN_SECONDS')
export const ALERTS_ENABLED = getStringToBool('ALERTS_ENABLED')
export const DISCORD_APPLICATION_ID = getString('DISCORD_APPLICATION_ID')
export const DISCORD_CHANNEL_IDS = getStringToString('DISCORD_CHANNEL_IDS')
export const DISCORD_TOKEN = getString('DISCORD_TOKEN')
export const ETHERSCAN_BASE_URL = getString('ETHERSCAN_BASE_URL')
export const PRICE_CHANGE_OVERRIDE = getNumber('PRICE_CHANGE_OVERRIDE')
export const REDIS_URL = getString('REDIS_URL')
export const RESERVOIR_API_KEY = getString('RESERVOIR_API_KEY')
export const RESERVOIR_BASE_URL = getString('RESERVOIR_BASE_URL')
export const RESERVOIR_ICON_URL = getString('RESERVOIR_ICON_URL')
export const TRACKED_CONTRACTS = getStringArray('TRACKED_CONTRACTS')
