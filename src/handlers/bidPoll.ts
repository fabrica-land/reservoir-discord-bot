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
import getCollection from "./getCollection";
import {
  ALERT_COOL_DOWN_SECONDS,
  ALERTS_ENABLED,
  RESERVOIR_API_KEY,
  RESERVOIR_BASE_URL,
  RESERVOIR_ICON_URL
} from "../env";
import {buildUrl} from "../utils/build-url";

/**
 * Check top bid events to see if a new one was created since last alert
 * @param {TextChannel} channel channel to send top bid alert to
 * @param {string} contractAddress collection to check for top bid events
 * @param {string} apiKey Reservoir API Key
 * @param {Redis} redis Redis instance
 */
export async function bidPoll(
  channel: TextChannel,
  contractAddress: string,
  apiKey: string,
  redis: Redis
) {
  if (!ALERTS_ENABLED.bid || contractAddress?.length <= 0) {
    return;
  }
  if (channel === undefined) {
    logger.error("top bid channel is undefined");
    return;
  } else if (channel.type !== ChannelType.GuildText) {
    logger.error("top bid channel is not a text channel");
    return;
  }
  try {
    // Getting top bid events from Reservoir
    const topBidResponse = await fetch(
      buildUrl(RESERVOIR_BASE_URL, 'events/collections/top-bid/v1', {
        collection: contractAddress,
        sortDirection: "desc",
        limit: 1,
      }), {
        headers: {
          Accept: 'application/json',
          'x-api-key': RESERVOIR_API_KEY,
        },
      },
    )
    const topBidResult = (await topBidResponse.json()) as  paths["/events/collections/top-bid/v1"]["get"]["responses"]["200"]["schema"]

    // Getting the most recent top bid event
    const topBid = topBidResult.events?.[0];

    // Log failure + return if top bid event couldn't be pulled
    if (
      !topBid?.event?.id ||
      !topBid?.topBid?.price ||
      !topBid?.topBid?.maker
    ) {
      logger.error(`Could not pull top bid for ${contractAddress}`);
      return;
    }

    // Pull cached top bid event id from Redis
    const cachedId: string | null = await redis.get("bideventid");

    // If most recent event matches cached event exit function
    if (Number(topBid.event.id) === Number(cachedId)) {
      return;
    }

    // Pull cooldown for floor ask alert from Redis
    const eventCooldown: string | null = await redis.get("bidcooldown");

    // Pull cached top bid price from Redis
    const cachedPrice: string | null = await redis.get("bidprice");

    // If the cached price does not match the most recent price (false updates due to sudoswap pools) and process not on cooldown generate alert
    if (Number(topBid.topBid.price) !== Number(cachedPrice) && !eventCooldown) {
      // setting updated top bid event id
      const success: "OK" = await redis.set("bideventid", topBid.event.id);
      // setting updated top bid cooldown
      const cooldownSuccess: "OK" = await redis.set(
        "bidcooldown",
        "true",
        "EX",
        ALERT_COOL_DOWN_SECONDS,
      );

      // Log failure + return if top bid info couldn't be set
      if (success !== "OK" || cooldownSuccess !== "OK") {
        logger.error("Could not set new topbid eventid");
        return;
      }

      // Getting top bid collection from Reservoir
      const bidCollectionResponse = await getCollection(
        undefined,
        contractAddress,
        1,
        true
      );

      // Getting top bid collection details
      const bidCollection = bidCollectionResponse?.[0];

      // Log failure + return if collection details don't exist
      if (!bidCollection || !bidCollection.name) {
        logger.error("Could not collect stats");
        return;
      }

      // Generating top bid token Discord alert embed
      const bidEmbed = new EmbedBuilder()
        .setColor(0x8b43e0)
        .setTitle("New Top Bid!")
        .setAuthor({
          name: bidCollection.name,
          url: `https://reservoir.market/collections/${bidCollection.id}`,
          iconURL: bidCollection.image ?? RESERVOIR_ICON_URL,
        })
        .setDescription(
          `The top bid on the collection just changed to ${
            topBid.topBid.price
          }Ξ made by [${topBid.topBid.maker.substring(
            0,
            6
          )}](https://www.reservoir.market/address/${topBid.topBid.maker})`
        )
        .setThumbnail(bidCollection.image ?? RESERVOIR_ICON_URL)
        .setTimestamp();

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setLabel("Accept offer")
          .setStyle(5)
          .setURL(
            `https://www.reservoir.market/collections/${topBid.topBid.contract}`
          )
      );

      // Sending top bid token Discord alert
      channel.send({ embeds: [bidEmbed], components: [row] });
      logger.info(
        `Successfully alerted new top bid by ${JSON.stringify(
          topBid.topBid.maker
        )}`
      );
    }
  } catch (e) {
    logger.error(`Error ${e} updating new top bid`);
  }
}
