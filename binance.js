'use strict';

require('./loadEnv')();

const d = require('debug');
const BinanceClient = require('./BinanceClient');
const openPosition = require('./handlers/openPosition');
const roeHandler = require('./handlers/roe');
const takeProfit = require('./handlers/takeProfit');

const leveragesDebug = d('Leverages');

const { NODE_ENV, BIN_API_KEY, BIN_API_SECRET, LEVERAGES } = process.env;

const isTestnet = NODE_ENV !== 'production';
const client = new BinanceClient(BIN_API_KEY, BIN_API_SECRET, isTestnet);

const setLeverages = async () => {
  const leverages = LEVERAGES.split(',').map((l) => l.split(':'));
  for (const [symbol, leverage] of leverages) {
    try {
      await client.setLeverage(symbol, +leverage);
      leveragesDebug(`Successfuly set leverage x${+leverage} for ${symbol}`);
    } catch (err) {
      leveragesDebug(err);
    }
  }
};

const sleep = async (ms) => new Promise((res) => setTimeout(res, ms));

const testBehaviour = async () => {
  client.emit('openPosition', client, 'ETHUSDT', 'BUY');
  await sleep(2000);
  client.emit('openPosition', client, 'ATOMUSDT', 'SELL');

  await sleep(20000);

  console.log('TP');
  client.emit('takeProfit', client, 'ETHUSDT', 'BUY');
  await sleep(20000);

  console.log('2 TP');
  client.emit('takeProfit', client, 'ETHUSDT', 'BUY');
  await sleep(20000);

  client.emit('takeProfit', client, 'ETHUSDT', 'BUY');
  await sleep(5000);

  client.emit('takeProfit', client, 'ATOMUSDT', 'SELL');
  await sleep(5000);

  client.emit('openPosition', client, 'ETHUSDT', 'SELL');
};

client.afterLoad = async () => {
  await setLeverages();
  setInterval(async () => {
    const roes = await client.getRoes();
    for (const position of roes) client.emit('roe', client, position);
  }, 10 * 1000);

  client.on('openPosition', openPosition);
  client.on('takeProfit', takeProfit);
  client.on('roe', roeHandler);
  // TestBehaviour();
};

module.exports = client;
