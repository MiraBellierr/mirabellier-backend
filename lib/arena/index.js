const utils = require("./utils");
const effects = require("./effects");
const cards = require("./cards");
const collection = require("./collection");
const archive = require("./archive");
const equipment = require("./equipment");
const profile = require("./profile");
const shop = require("./shop");
const cardShop = require("./card-shop");
const combat = require("./combat");
const playback = require("./playback");
const market = require("./market");
const trade = require("./trade");
const notifications = require("./notifications");
const updates = require("./updates");
const leaderboard = require("./leaderboard");
const hallOfFame = require("./hall-of-fame");
const skillTree = require("./skill-tree");
const mint = require("./mint");
const {
  drawArenaCard,
  ensureArenaCardPool,
  getArenaCharacterCatalog,
  rarityFromCharacterRank,
} = require("../arena-characters");

module.exports = {
  ...utils,
  ...effects,
  ...cards,
  ...collection,
  ...archive,
  ...equipment,
  ...profile,
  ...shop,
  ...cardShop,
  ...combat,
  ...playback,
  ...market,
  ...trade,
  ...notifications,
  ...updates,
  ...leaderboard,
  ...hallOfFame,
  ...skillTree,
  ...mint,
  drawArenaCard,
  ensureArenaCardPool,
  getArenaCharacterCatalog,
  rarityFromCharacterRank,
  __test: {
    buildPassiveRuntime: combat.buildPassiveRuntime,
    buildNpcOpponent: combat.buildNpcOpponent,
    calculateAttackOutcome: combat.calculateAttackOutcome,
    calculateEloExchange: utils.calculateEloExchange,
    chooseEloOpponent: combat.chooseEloOpponent,
    consumeTempGuard: combat.consumeTempGuard,
    getDailyOpponentLimit: combat.getDailyOpponentLimit,
    getCardShopPrice: utils.getCardShopPrice,
    isRandomCardOfferAvailable: utils.isRandomCardOfferAvailable,
    getMarketIvBand: utils.getMarketIvBand,
    getMarketPrice: market.getMarketPrice,
    loadCombatSnapshot: combat.loadCombatSnapshot,
    rollFightMaterialRewards: combat.rollFightMaterialRewards,
    runPassivesForTrigger: combat.runPassivesForTrigger,
    simulateFight: combat.simulateFight,
  },
};
