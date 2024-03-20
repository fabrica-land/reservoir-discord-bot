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
  ALERTS_ENABLED, MARKETPLACE_BASE_URL,
  RESERVOIR_BASE_URL,
  RESERVOIR_ICON_URL
} from "../env";
import {buildUrl} from "../utils/build-url";
import getToken from "./getToken";

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
    // Getting bids from Reservoir
    const bidsResponse = await fetch(
      buildUrl(RESERVOIR_BASE_URL, 'orders/bids/v6', {
        contracts: contractAddress,
        sortDirection: "desc",
        limit: 100,
      }), {
        headers: {
          Accept: 'application/json',
          'x-api-key': apiKey,
        },
      },
    )
    const bidsResult = (await bidsResponse.json()) as  paths["/orders/bids/v6"]["get"]["responses"]["200"]["schema"]

    const bids = bidsResult.orders

    if (!bids) {
      logger.error(`Could not pull bids for ${contractAddress}`);
      return;
    }

    if (!bids.length) {
      logger.debug(`There are no bids for ${contractAddress}`)
      return
    }

    // Getting top bid collection from Reservoir
    const collectionResponse = await getCollection(
      undefined,
      contractAddress,
      1,
      false
    );

    // Getting top bid collection details
    const collection = collectionResponse?.[0];

    // Log failure + return if collection details don't exist
    if (!collection || !collection.name) {
      logger.error("Could not collect stats");
      return;
    }

    for (let i = 0 ; i < bids.length ; i++) {
      // Pull cached bid event id from Redis
      const bid = bids[i]
      // Log failure + return if bid event couldn't be pulled
      if (
        !bid?.id ||
        !bid?.price ||
        !bid?.maker
      ) {
        logger.error(`Could not pull bid for ${contractAddress}`);
        continue;
      }
      const cacheKey = `reservoir:bot:bid:${bid.id}}`
      const cached: string | null = await redis.get(cacheKey)
      if (cached) {
        logger.debug("bid is cached; stopping bid consideration");
        break;
      }

      const tokenIdParts = bid.tokenSetId.split(':')
      const tokenId = tokenIdParts[tokenIdParts.length - 1]
      const token = await getToken(contractAddress, tokenId)

      const name = token.name;
      const image = token.image;
      if (!name || !image) {
        logger.error(
          `couldn't return bid order name and image for ${bid.tokenSetId}`
        );
        continue;
      }

      const marketplaceUrl = buildUrl(MARKETPLACE_BASE_URL, `property/${tokenId}`)
      const county = token.attributes?.find((attr) => attr.key === 'County')?.value
      const state = token.attributes?.find((attr) => attr.key === 'State')?.value

      // Generating bid token Discord alert embed
      const bidEmbed = new EmbedBuilder()
        .setColor(0x8b43e0)
        .setTitle(`New Bid for ${token.name}`)
        .setAuthor({
          name: `${county}, ${state}`,
          url: marketplaceUrl,
          iconURL: collection.image ?? RESERVOIR_ICON_URL,
        })
        .setDescription(
          `Price: ${Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
          }).format(Math.round((bid.price?.amount?.usd ?? 0) * 100) / 100)}`
        )
        .setFooter({ text: `${bid.source?.name}` })
        .setTimestamp();

      if (token.image) {
        bidEmbed.setThumbnail(token.image)
      }
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setLabel("View Property")
          .setStyle(5)
          .setURL(marketplaceUrl)
      );

      // Sending top bid token Discord alert
      channel.send({embeds: [bidEmbed], components: [row]});
      logger.info(`Successfully alerted new bid by ${JSON.stringify(bid.maker)}`);
      await redis.set(cacheKey, '1');
    }
  } catch (e) {
    console.log(e)
    logger.error(`Error ${e} getting new bids`);
  }
}
