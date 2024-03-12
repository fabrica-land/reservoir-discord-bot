import Redis from "ioredis";
import {
  TextChannel,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ChannelType,
} from "discord.js";
import { paths } from "@reservoir0x/reservoir-sdk";
import logger from "../utils/logger";
import {
  ALERT_COOL_DOWN_SECONDS,
  ALERTS_ENABLED, CHAIN,
  PRICE_CHANGE_OVERRIDE,
  RESERVOIR_BASE_URL
} from "../env";
import {buildUrl} from "../utils/build-url";

/**
 * Check floor price events to see if it has changed since last alert
 * @param {TextChannel} channel channel to send floor price alert to
 * @param {string} contractAddress collection to check for top bid events
 * @param {string} apiKey Reservoir API Key
 * @param {Redis} redis Redis instance
 */
export async function floorPoll(
  channel: TextChannel,
  contractAddress: string,
  apiKey: string,
  redis: Redis
) {
  if (!ALERTS_ENABLED.floor || contractAddress?.length <= 0) {
    return;
  }
  if (channel === undefined) {
    logger.error("floor price channel is undefined");
    return;
  } else if (channel.type !== ChannelType.GuildText) {
    logger.error("floor price channel is not a text channel");
    return;
  }
  try {
    // Getting floor ask events from Reservoir
    const floorAskResponse = await fetch(
      buildUrl(RESERVOIR_BASE_URL, 'events/collections/floor-ask/v1', {
        collection: contractAddress,
        sortDirection: "desc",
        limit: 1,
      }), {
        headers: {
          Accept: 'application/json',
          'x-api-key': apiKey,
        },
      },
    )
    const floorAskResult = (await floorAskResponse.json()) as paths["/events/collections/floor-ask/v1"]["get"]["responses"]["200"]["schema"]

    // Getting the most recent floor ask event
    const floorAsk = floorAskResult.events?.[0];

    // Log failure + return if floor event couldn't be pulled
    if (
      !floorAsk?.event?.id ||
      !floorAsk.floorAsk?.tokenId ||
      !floorAsk.floorAsk?.price ||
      !floorAsk?.event?.createdAt ||
      !floorAsk?.floorAsk?.source
    ) {
      logger.error(`Could not pull floor ask for ${contractAddress}`);
      return;
    }

    // Pull cached floor ask event id from Redis
    const cacheKey = `reservoir:bot:floorEventId:${CHAIN}`
    const cachedId: string | null = await redis.get(cacheKey);

    // If most recent event matchs cached event exit function
    if (Number(floorAsk.event.id) === Number(cachedId)) {
      return;
    }

    // Pull cooldown for floor ask alert from Redis
    const coolDownCacheKey = `reservoir:bot:floorcooldown:${CHAIN}`
    let eventCooldown: string | null = await redis.get(coolDownCacheKey);

    // Pull cached floor ask price from Redis
    const floorPriceCacheKey = `reservoir:bot:floorPrice:${CHAIN}`
    const cachedPrice: string | null = await redis.get(floorPriceCacheKey);

    // On X% change in floor ask override alert cooldown
    if (
      Number(cachedPrice) / Number(floorAsk.floorAsk.price) >
        1 + PRICE_CHANGE_OVERRIDE ||
      Number(cachedPrice) / Number(floorAsk.floorAsk.price) <
        1 - PRICE_CHANGE_OVERRIDE
    ) {
      eventCooldown = null;
    }

    // If process is not on cooldown generate alert
    if (!eventCooldown) {
      // setting updated floor ask event id
      const idSuccess: "OK" = await redis.set(
        coolDownCacheKey,
        floorAsk.event.id
      );
      // setting updated floor ask cooldown
      const cooldownSuccess: "OK" = await redis.set(
        coolDownCacheKey,
        "true",
        "EX",
        ALERT_COOL_DOWN_SECONDS
      );
      // setting updated floor ask price
      const priceSuccess: "OK" = await redis.set(
        floorPriceCacheKey,
        floorAsk.floorAsk.price
      );

      // Log failure + return if floor ask info couldn't be set
      if (
        idSuccess !== "OK" ||
        cooldownSuccess !== "OK" ||
        priceSuccess !== "OK"
      ) {
        logger.error("Could not set new floorprice info");
        return;
      }

      // Getting floor ask token from Reservoir
      const tokenResponse = await fetch(
        buildUrl(RESERVOIR_BASE_URL, 'tokens/v5', {
          tokens: `${contractAddress}:${floorAsk.floorAsk.tokenId}`,
          sortBy: "floorAskPrice",
          limit: 1,
          includeTopBid: false,
          includeAttributes: true,
        }), {
          headers: {
            Accept: 'application/json',
            'x-api-key': apiKey,
          },
        },
      )
      const tokenResult = (await tokenResponse.json()) as paths["/tokens/v5"]["get"]["responses"]["200"]["schema"]

      // Getting the token details
      const floorToken = tokenResult.tokens?.[0];

      // Log failure + return if token details don't exist
      if (
        !floorToken?.token?.collection ||
        !floorToken?.token?.owner ||
        !floorToken?.token?.lastSell ||
        !floorToken?.token?.name
      ) {
        logger.error("Could not pull floor token");
        return;
      }

      // create attributes array for discord fields if the attributes exist
      const attributes: { name: string; value: string; inline: boolean }[] =
        floorToken.token.attributes?.map((attr) => {
          return {
            name: attr.key ?? "",
            value: attr.value ?? "",
            inline: true,
          };
        }) ?? [];

      // Generating floor token Discord alert embed
      const floorEmbed = new EmbedBuilder()
        .setColor(0x8b43e0)
        .setTitle("New Floor Listing!")
        .setAuthor({
          name: `${floorToken.token.collection.name}`,
          url: RESERVOIR_BASE_URL,
          iconURL: `${floorToken.token.collection.image}`,
        })
        .setDescription(
          `${floorToken.token.name} is now the floor token, listed for ${
            floorAsk.floorAsk.price
          }Ξ by [${floorToken.token.owner.substring(
            0,
            6
          )}](https://www.reservoir.market/address/${
            floorToken.token.owner
          })\nLast Sale: ${floorToken.token.lastSell.value ?? "N/A"}${
            floorToken.token.lastSell.value ? "Ξ" : ""
          }\nRarity Rank: ${floorToken.token.rarityRank}`
        )
        .addFields(attributes)
        .setThumbnail(`${floorToken.token.image}`)
        .setTimestamp(new Date(floorAsk.event.createdAt));

      // Generating floor token purchase button
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setLabel("Purchase")
          .setStyle(5)
          .setURL(
            `${RESERVOIR_BASE_URL}/redirect/sources/${floorAsk.floorAsk.source}/tokens/${floorToken.token.collection.id}%3A${floorToken.token.tokenId}/link/v2`
          )
      );

      // Sending floor token Discord alert
      channel.send({ embeds: [floorEmbed], components: [row] });
      logger.info(
        `Successfully alerted new floor price for ${JSON.stringify(
          floorToken.token
        )}`
      );
    }
  } catch (e) {
    logger.error(`Error ${e} updating new floor price`);
  }
}
