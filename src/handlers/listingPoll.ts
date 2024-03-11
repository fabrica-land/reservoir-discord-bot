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
import {ALERTS_ENABLED, RESERVOIR_API_KEY, RESERVOIR_BASE_URL, RESERVOIR_ICON_URL} from "../env";
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
    const listingsResponse = await fetch(
      buildUrl(RESERVOIR_BASE_URL, 'orders/asks/v3', [
        ...contractArray.map<[string, string | number | boolean]>(address => (['contract', address])),
        ['includePrivate', false],
        ['includeMetadata', true],
        ['includeRawData', false],
        ['sortBy', 'createdAt'],
        ['limit', 500],
      ]), {
        headers: {
          'x-api-key': RESERVOIR_API_KEY,
          Accept: 'application/json',
        },
      },
    )
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
    const cachedId: string | null = await redis.get("listingsorderid");

    if (!cachedId) {
      channel.send(
        "Restarting listing bot, new listings will begin to populate from here..."
      );
      await redis.set("listingsorderid", listings[0].id);
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
      await redis.del("listingsorderid");
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
            'x-api-key': RESERVOIR_API_KEY,
          },
        },
      )
      const tokenResult = (await tokenResponse.json()) as paths["/tokens/v5"]["get"]["responses"]["200"]["schema"]
      const tokenDetails = tokenResult.tokens?.[0].token;

      if (
        !tokenDetails ||
        !tokenDetails?.collection ||
        !tokenDetails.attributes ||
        !tokenDetails.collection.image ||
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

      const sourceIcon = await handleMediaConversion(
        `${listings[i].source?.icon}`,
        `${listings[i].source?.name}`
      );

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
          url: `https://forgotten.market/${tokenDetails.contract}`,
          iconURL: `attachment://${authorIcon.name}`,
        })
        .setDescription(
          `Item: ${tokenDetails.name}\nPrice: ${listings[i].price?.amount?.native}Ξ ($${listings[i].price?.amount?.usd})\nFrom: ${listings[i].maker}`
        )
        .addFields(attributes)
        .setImage(`attachment://${image.name}`)
        .setFooter({
          text: `${listings[i].source?.name}`,
          iconURL: `attachment://${sourceIcon.name}`,
        })
        .setTimestamp();

      // Generating floor token purchase button
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setLabel("Purchase")
          .setStyle(5)
          .setURL(
            `https://forgotten.market/${tokenDetails.contract}/${tokenDetails.tokenId}`
          )
      );
      channel.send({
        embeds: [listingEmbed],
        components: [row],
        files: [sourceIcon, authorIcon, image],
      });
    }
    await redis.set("listingsorderid", listings[0].id);
  } catch (e) {
    logger.error(`Error ${e} updating new listings`);
  }
}
