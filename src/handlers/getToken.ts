import {RESERVOIR_API_KEY, RESERVOIR_BASE_URL} from "../env";

import {definitions, paths} from "@reservoir0x/reservoir-sdk";
import logger from "../utils/logger";
import {buildUrl} from "../utils/build-url";


/**
 * Retrieve collection data from Reservoir
 * @param {string} contractAddress collection address to search
 * @param {string} tokenId token to search
 * @returns token info
 */
export default async function getToken(
  contractAddress: string,
  tokenId: string,
): Promise<definitions["Model102"]> {
  // Log failure + throw if function not passed name or contract address
  if (!contractAddress || !tokenId) {
    throw new Error();
  }

  let tokenResult
  try {
    // Pull collection data from Reservoir
    const tokenResponse = await fetch(
      buildUrl(RESERVOIR_BASE_URL, 'tokens/v8', {
        includeAttributes: true,
        tokens: `${contractAddress}:${tokenId}`,
      }), {
        headers: {
          Accept: 'application/json',
          'x-api-key': RESERVOIR_API_KEY,
        },
      },
    )
    tokenResult = (await tokenResponse.json()) as paths["/tokens/v8"]["get"]["responses"]["200"]["schema"]
  } catch (e) {
    // Log failure + throw on error
    logger.error(
      `Failed to pull token data for token=${tokenId}, contractAddress=${contractAddress}`
    );
    throw new Error("Failed to pull token data");
  }
  const token = tokenResult.tokens?.[0].token
  if (!token) {
    logger.error(
      `Failed to pull token data for token=${tokenId}, contractAddress=${contractAddress}`
    )
    throw new Error("Failed to pull token data")
  }
  return token
}
