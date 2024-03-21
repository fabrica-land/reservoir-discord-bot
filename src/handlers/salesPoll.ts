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
import getCollection from "./getCollection";
import {
  ALERTS_ENABLED, CHAIN,
  MARKETPLACE_BASE_URL,
  RESERVOIR_BASE_URL,
  RESERVOIR_ICON_URL
} from "../env";
import {buildUrl} from "../utils/build-url";

/**
 * Check sales to see if there are new ones since the last alert
 * @param {TextChannel} channel channel to send new sales alerts
 * @param {string[]} contractArray collections to check for new sales
 * @param {string} apiKey Reservoir API Key
 * @param {Redis} redis Redis instance to save order ids
 */
export async function salePoll(
  channel: TextChannel,
  contractArray: string[],
  apiKey: string,
  redis: Redis
) {
  if (!ALERTS_ENABLED.sales || contractArray?.length <= 0) {
    return;
  }
  if (channel === undefined) {
    logger.error("sales channel is undefined");
    return;
  } else if (channel.type !== ChannelType.GuildText) {
    logger.error("sales channel is not a text channel");
    return;
  }
  try {
    // Authorizing with Reservoir API Key
    const salesResponse = await fetch(
      buildUrl(RESERVOIR_BASE_URL, 'sales/v4', [
        ...contractArray.map<[string, string | number | boolean]>(address => (['contract', address])),
        ['includeTokenMetadata', true],
        ['limit', 100],
      ]), {
      headers: {
        'x-api-key': apiKey,
        Accept: 'application/json',
      },
    })
    const salesResult = (await salesResponse.json()) as paths['/sales/v4']['get']['responses']["200"]["schema"]

    // Getting the most recent sales event
    const sales = salesResult.sales;

    // Log failure + return if floor event couldn't be pulled
    if (!sales) {
      logger.error(`Could not pull sales for ${contractArray}`);
      return;
    }

    if (!sales.length) {
      logger.debug(`There are no sales for ${contractArray}`)
      return
    }

    const cacheKey = `reservoir:bot:saleOrderId:${CHAIN}`
    // Pull cached sales event id from Redis
    const cachedId: string | null = await redis.get(cacheKey)
    if (!sales[0].saleId) {
      logger.error("Couldn't set latest sales order id");
      return;
    }

    if (!cachedId) {
      channel.send(
        "Restarting sales bot, new listings will begin to populate from here..."
      );
      await redis.set(cacheKey, sales[0].saleId);
      return;
    }

    // If most recent event matches cached event exit function
    if (sales[0].saleId === cachedId) {
      return;
    }

    const cachedIndex =
      sales.findIndex((order) => {
        return order.saleId === cachedId;
      }) - 1;

    if (cachedIndex < 0) {
      await redis.del(cacheKey);
      logger.info("cached sale not found, resetting");
    }

    for (let i = cachedIndex; i >= 0; i--) {
      const sale = sales[i]
      if (!sale.saleId || !sale.orderSource) {
        logger.error(
          `sale order in txn ${sale.txHash} missing saleId or orderSource`
        );
        continue;
      }
      const tokenId = sale.token?.tokenId
      const name = sale.token?.name
      const image = sale.token?.image

      if (!tokenId || !name || !image) {
        logger.error(
          `couldn't return sale order tokenId, name, or image for ${sale.txHash}`
        );
        continue;
      }

      const collection = await getCollection(
        undefined,
        sale.token?.contract,
        1,
        false
      );

      if (!collection?.[0].image || !collection?.[0].name) {
        logger.error(
          `couldn't return sale order collection data for ${sale.txHash}`
        );
        continue;
      }

      const thumbnail = await handleMediaConversion(image, name);

      const authorIcon = await handleMediaConversion(
        collection[0].image ?? RESERVOIR_ICON_URL,
        collection[0].name
      );

      const buyerLink = buildUrl(MARKETPLACE_BASE_URL, `profile/${sale.to}`)
      const sellerLink = buildUrl(MARKETPLACE_BASE_URL, `profile/${sale.from}`)
      const salesEmbed = new EmbedBuilder()
        .setColor(0x8b43e0)
        .setTitle(`${sale.token?.name} has been sold!`)
        .setAuthor({
          name: `${sale.token?.collection?.name}`,
          url: MARKETPLACE_BASE_URL,
          iconURL: `attachment://${authorIcon.name}`,
        })
        .setDescription(
          `Price: ${Intl.NumberFormat('en-US', {
              style: 'currency',
              currency: 'USD',
            }).format(Math.round((sale.price?.amount?.usd ?? 0) * 100) / 100)
          }\nBuyer: ${buyerLink}\nSeller: ${sellerLink}`
        )
        .setThumbnail(`attachment://${thumbnail.name}`)
        .setFooter({ text: `${sale.orderSource}` })
        .setTimestamp();

      // Generating floor token purchase button
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setLabel("View Property")
          .setStyle(5)
          .setURL(buildUrl(MARKETPLACE_BASE_URL, `property/${tokenId}`))
      );
      channel.send({
        embeds: [salesEmbed],
        components: [row],
        files: [thumbnail, authorIcon],
      });
    }
    await redis.set(cacheKey, sales[0].saleId);
  } catch (e) {
    logger.error(`Error ${e} updating new sales`);
  }
}
