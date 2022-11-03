export default {
  RESERVOIR_ICON:
    "https://cdn.discordapp.com/icons/872790973309153280/0dc1b70867aeeb2ee32563f575c191c6.webp?size=4096",
  ALERT_COOLDOWN: 60 * 30, // 30 minute cooldown
  PRICE_CHANGE_OVERRIDE: 0.1, // 10% price change
  ALERT_ENABLED: true, // enable alerts
  TRACKED_CONTRACTS: [
    "0x9690b63eb85467be5267a3603f770589ab12dc95",
    "0xda5cf3a42ebacd2d8fcb53830b1025e01d37832d",
    "0xf55b615b479482440135ebf1b907fd4c37ed9420",
    "0x251b5f14a825c537ff788604ea1b58e49b70726f",
    "0x521f9c7505005cfa19a8e5786a9c3c9c9f5e6f42",
    "0x31158181b4b91a423bfdc758fc3bf8735711f9c5",
    "0x59775fd5f266c216d7566eb216153ab8863c9c84",
    "0x7c104b4db94494688027cced1e2ebfb89642c80f",
    "0x8634c23d5794ed177e9ffd55b22fdb80a505ab7b",
  ],
  CHANNEL_IDS: {
    mainChannel: "1033122826581987413",
    listingChannel: "1036364146461118534",
    salesChannel: "1037788405809021019",
  },
  ALERT_CONTRACT: "0x8a90cab2b38dba80c64b7734e58ee1db38b8992e",
  APPLICATION_ID: "1037398798831472691",
  REDIS_HOST: "127.0.0.1",
  REDIS_PORT: 6379,
};
