import Redis from "ioredis";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ChannelType,
  EmbedBuilder,
  TextChannel,
} from "discord.js";
import { paths } from "@reservoir0x/reservoir-sdk";
import logger from "../utils/logger";
import handleMediaConversion from "../utils/media";
import {ALERTS_ENABLED, CHAIN, MARKETPLACE_BASE_URL, RESERVOIR_BASE_URL, RESERVOIR_ICON_URL} from "../env";
import {buildUrl} from "../utils/build-url";

/**
 * Check listings to see if there are new ones since the last alert
 * @param {TextChannel} channel channel to send new listings alerts
 * @param {string[]} contractArray collections to check for new listings
 * @param {string} apiKey Reservoir API Key
 * @param {Redis} redis Redis instance to save order ids
 */
export async function listingPoll(
  channel: TextChannel,
  contractArray: string[],
  apiKey: string,
  redis: Redis
) {
  if (!ALERTS_ENABLED.listings || contractArray?.length <= 0) {
    return;
  }
  if (channel === undefined) {
    logger.error("listings channel is undefined");
    return;
  } else if (channel.type !== ChannelType.GuildText) {
    logger.error("listings channel is not a text channel");
    return;
  }
  try {
    // Getting floor ask events from Reservoir
    const listingsUrl = buildUrl(RESERVOIR_BASE_URL, 'orders/asks/v3', [
      ...contractArray.map<[string, string | number | boolean]>(address => (['contracts', address])),
      ['includePrivate', false],
      ['includeMetadata', true],
      ['includeRawData', false],
      ['sortBy', 'createdAt'],
      ['limit', 500],
    ])
    const listingsResponse = await fetch(listingsUrl, {
      headers: {
        'x-api-key': apiKey,
        Accept: 'application/json',
      },
    })
    const listingsResult = (await listingsResponse.json()) as paths["/orders/asks/v3"]["get"]["responses"]["200"]["schema"]

    // Getting the most recent floor ask event
    const listings = listingsResult.orders;

    // Log failure + return if floor event couldn't be pulled
    if (!listings) {
      logger.error(`Could not pull listings for ${contractArray}`);
      return;
    }
    if (!listings.length) {
      logger.debug(`There are no listings for ${contractArray}`)
      return
    }

    // Pull cached listing event id from Redis
    const cacheKey = `reservoir:bot:listingsOrderId:${CHAIN}`
    const cachedId: string | null = await redis.get(cacheKey);

    if (!cachedId) {
      channel.send(
        "Restarting listing bot, new listings will begin to populate from here..."
      );
      await redis.set(cacheKey, listings[0].id);
      return;
    }

    // If most recent event matchs cached event exit function
    if (listings[0].id === cachedId) {
      return;
    }

    const cachedListingIndex =
      listings.findIndex((order) => {
        return order.id === cachedId;
      }) - 1;

    if (cachedListingIndex < 0) {
      await redis.del(cacheKey);
      logger.info("cached listing not found, resetting");
    }

    for (let i = cachedListingIndex; i >= 0; i--) {
      if (listings[i].tokenSetId === listings[i + 1].tokenSetId) {
        logger.info(
          `skipping duplicated listing order from other marketplace ${listings[i].id}`
        );
        continue;
      }

      if (!listings[i].source?.icon || !listings[i].source?.name) {
        logger.error(
          `couldn't return listing order source for ${listings[i].id}`
        );
        continue;
      }

      const tokenResponse = await fetch(
        buildUrl(RESERVOIR_BASE_URL, 'tokens/v5', {
          tokenSetId: listings[i].tokenSetId,
          sortBy: "floorAskPrice",
          limit: "20",
          includeTopBid: "false",
          includeAttributes: "true",
        }), {
          headers: {
            Accept: 'application/json',
            'x-api-key': apiKey,
          },
        },
      )
      const tokenResult = (await tokenResponse.json()) as paths["/tokens/v5"]["get"]["responses"]["200"]["schema"]
      const tokenDetails = tokenResult.tokens?.[0].token;

      if (
        !tokenDetails ||
        !tokenDetails?.collection ||
        !tokenDetails.attributes ||
        !tokenDetails.collection.name ||
        !tokenDetails.image ||
        !tokenDetails.name
      ) {
        logger.error(
          `couldn't return listing order collection data for ${listings[i].id}`
        );
        continue;
      }

      // create attributes array for discord fields if the attributes exist
      const attributes: { name: string; value: string; inline: boolean }[] =
        tokenDetails.attributes.map((attr) => {
          return {
            name: attr.key ?? "",
            value: attr.value ?? "",
            inline: true,
          };
        }) ?? [];

      const authorIcon = await handleMediaConversion(
        tokenDetails.collection.image ?? RESERVOIR_ICON_URL,
        tokenDetails.collection.name
      );

      const image = await handleMediaConversion(
        tokenDetails.image,
        tokenDetails.name
      );

      const listingEmbed = new EmbedBuilder()
        .setColor(0x8b43e0)
        .setTitle(`${tokenDetails.name?.trim()} has been listed!`)
        .setAuthor({
          name: `${tokenDetails.collection.name}`,
          url: MARKETPLACE_BASE_URL,
          iconURL: `attachment://${authorIcon.name}`,
        })
        .setDescription(
          `Item: ${tokenDetails.name}\nPrice: ${listings[i].price?.amount?.native}Ξ ($${listings[i].price?.amount?.usd})\nFrom: ${listings[i].maker}`
        )
        .addFields(attributes)
        .setImage(`attachment://${image.name}`)
        .setFooter({ text: `${listings[i].source?.name}` })
        .setTimestamp();

      // Generating floor token purchase button
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setLabel("Purchase")
          .setStyle(5)
          .setURL(`${MARKETPLACE_BASE_URL}/property/${tokenDetails.tokenId}`)
      );
      channel.send({
        embeds: [listingEmbed],
        components: [row],
        files: [authorIcon, image],
      });
    }
    await redis.set(cacheKey, listings[0].id);
  } catch (e) {
    logger.error(`Error ${e} updating new listings`);
  }
}
