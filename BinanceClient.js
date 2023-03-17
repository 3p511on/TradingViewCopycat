'use strict';

const { createHmac } = require('node:crypto');
const EventEmitter = require('node:events');
const { stringify } = require('node:querystring');
const debug = require('debug')('BinanceClient');
const { fetch } = require('undici');
const BinanceError = require('./BinanceError');
const { getPositionSide } = require('./util');

const { TP_PERCENTS } = process.env;
const tpPercents = TP_PERCENTS.split(',');
const fullCycleSize = tpPercents.length + 1;
const assets = ['BTC', 'BNB', 'ETH', 'USDT', 'USDC', 'BUSD'];
const defaultRequestOptions = { body: {}, method: 'GET', headers: {} };
const encryptMessage = (key, message) => createHmac('sha256', key).update(message).digest('hex');

module.exports = class BinanceClient extends EventEmitter {
  constructor(key, secret, isTestnet = false) {
    super();
    this.key = key;
    this.secret = secret;
    this.isTestnet = isTestnet;
    this.fullCycleSize = fullCycleSize;
    this.afterLoad = () => undefined;
    this.positionsHistory = {
      // ETHUSDT: [3],
    };
    this.cycle = {
      // ETHUSDT: ['BUY'],
    };
    this.init();
  }

  get restApiUri() {
    const productionUri = 'https://fapi.binance.com';
    const testNetUri = 'https://testnet.binancefuture.com';
    return this.isTestnet ? testNetUri : productionUri;
  }

  isFirstEvent(symbol) {
    const symbolCycle = this.cycle[symbol];
    if (!symbolCycle) return true;
    return symbolCycle?.length === 0;
  }

  isCompleteCycle(symbol) {
    const symbolCycle = this.cycle[symbol] ?? [];
    return symbolCycle.length >= this.fullCycleSize;
  }

  async init() {
    await this.fetchExchangeInfo();
    this.afterLoad();
  }

  request(path, opts = {}) {
    opts = { ...defaultRequestOptions, ...opts };
    const { body, method, headers } = opts;
    const params = stringify({ ...body, timestamp: Date.now() });
    const signature = encryptMessage(this.secret, params);
    debug('Request signature', signature);
    const uri = `${this.restApiUri}/${path}?${params}&signature=${signature}`;
    debug('Request uri', uri);
    Object.assign(headers, { 'X-MBX-APIKEY': this.key });
    return fetch(uri, { method, headers });
  }

  async fetchExchangeInfo() {
    try {
      const path = 'fapi/v1/exchangeInfo';
      const res = await fetch(`${this.restApiUri}/${path}`);
      const json = await res.json();
      this.exchangeInfo = json;
      return json;
    } catch (err) {
      console.error("FATAL: Couldn't fetch exchange info");
      debug(err);
      return null;
    }
  }

  getPrecisions(symbol) {
    if (!this.exchangeInfo) throw new Error('Exchange info was not fetched');
    const { symbols } = this.exchangeInfo;
    const symbolInfo = symbols.find((s) => s.symbol === symbol);
    const { quantityPrecision, pricePrecision } = symbolInfo;
    return { quantityPrecision, pricePrecision };
  }

  maxQtyAllowed(symbol) {
    if (!this.exchangeInfo) throw new Error('Exchange info was not fetched');
    const { symbols } = this.exchangeInfo;
    const symbolInfo = symbols.find((s) => s.symbol === symbol);
    return symbolInfo;
  }

  async createOrder({ symbol, side, type, quantity, stopPrice, positionSide, closePosition }) {
    if (!this.exchangeInfo) throw new Error('Exchange info was not fetched');
    try {
      const path = 'fapi/v1/order';
      const body = { symbol, side, type, positionSide };
      if (stopPrice) Object.assign(body, { stopPrice });
      if (closePosition) Object.assign(body, { closePosition });
      if (quantity) Object.assign(body, { quantity });
      const res = await this.request(path, { body, method: 'POST' });
      const json = await res.json();
      if (json?.code) throw new BinanceError('Request error', json);
      return json;
    } catch (err) {
      console.error('CreateOrder ERR:', err);
      if (err?.code === -2027) {
        console.error(err);
        const newQty = quantity * 0.9;
        console.error('Пробую еще раз для ', newQty);
        return this.createOrder({ symbol, side, type, quantity: this.normalizeQty(symbol, newQty), positionSide });
      }
      return null;
    }
  }

  normalizeQty(symbol, qty) {
    const { quantityPrecision } = this.getPrecisions(symbol);
    const fixedQuantity = qty.toFixed(quantityPrecision);
    return fixedQuantity;
  }

  openPosition(positionSide, side, symbol, quantity) {
    const fixedQuantity = this.normalizeQty(symbol, quantity);
    const body = { positionSide, symbol, side, type: 'MARKET', quantity: fixedQuantity };
    return this.createOrder(body);
  }

  setTPSL(symbol, positionSide, type, side, stopPrice) {
    const { pricePrecision } = this.getPrecisions(symbol);
    const fixedStopPrice = stopPrice.toFixed(pricePrecision);
    const body = { symbol, side, type, stopPrice: fixedStopPrice, positionSide, closePosition: true };
    return this.createOrder(body);
  }

  async getBalance(reqAsset) {
    const res = await this.request('fapi/v2/balance');
    const json = await res.json();
    const balanceAssets = Object.fromEntries(json.map(({ asset, availableBalance }) => [asset, availableBalance]));
    const balance = +balanceAssets[reqAsset] ?? 0;
    return balance;
  }

  getSymbolAsset(symbol) {
    return assets.find((a) => symbol.endsWith(a));
  }

  parsePercent(percent) {
    if (typeof percent === 'string') {
      if (percent.endsWith('%')) percent = percent.slice(0, -1);
      percent = +percent;
    }
    if (percent < 1) return percent;
    return percent / 100;
  }

  async getBookTicker(symbol) {
    const body = { symbol };
    const res = await this.request('fapi/v1/ticker/bookTicker', { body });
    const { askPrice, bidPrice } = await res.json();
    return { askPrice: +askPrice, bidPrice: +bidPrice };
  }

  async getMarkPrice(symbol) {
    const body = { symbol };
    const res = await this.request('fapi/v1/ticker/price', { body });
    const { price } = await res.json();
    return +price;
  }

  async getPartOfBalance(symbol, percent, leverage) {
    const asset = this.getSymbolAsset(symbol);
    const balance = await this.getBalance(asset);
    const price = await this.getMarkPrice(symbol);
    return (balance * this.parsePercent(percent) * leverage) / price;
  }

  async getPositions(symbol) {
    const body = { symbol };
    const res = await this.request('fapi/v2/positionRisk', { body });
    const positions = await res.json();
    return positions;
  }

  getPositionAmounts(positions) {
    return positions.map((p) => [p.positionSide, +p.positionAmt]);
  }

  getPartOfPosition(symbol, percent) {
    const positionHistory = this.positionsHistory[symbol];
    if (!positionHistory) throw new Error('No position history');
    const initialPart = positionHistory[0];
    return initialPart * this.parsePercent(percent);
  }

  pushPositionHistory(symbol, amount) {
    const alreadyExists = this.positionsHistory[symbol];
    if (!alreadyExists) return alreadyExists.push(amount);
    this.positionsHistory[symbol] = [amount];
    return true;
  }

  clearPositionHistory(symbol) {
    this.positionsHistory[symbol] = [];
  }

  async calculatePercent(isStopLoss, symbol, side, percent) {
    if (percent === 0) return 0;
    const price = await this.getMarkPrice(symbol);
    let orderDirection = side === 'SELL' ? 1 : -1;
    if (!isStopLoss) orderDirection *= -1;
    const piece = price * this.parsePercent(percent) * orderDirection;
    return price + piece;
  }

  async setLeverage(symbol, leverage) {
    const body = { symbol, leverage };
    const res = await this.request('fapi/v1/leverage', { body, method: 'POST' });
    const json = await res.json();
    if (json?.code) throw new BinanceError('Request error', json);
    return json;
  }

  async getOrders(symbol) {
    const body = { symbol };
    const res = await this.request('fapi/v1/openOrders', { body });
    const json = await res.json();
    if (json?.code) throw new BinanceError('Request error', json);
    return json;
  }

  async cancelMultipleOrders(symbol, orderIdList) {
    const body = { symbol, orderIdList: `[${orderIdList}]` };
    const res = await this.request('fapi/v1/batchOrders', { body, method: 'DELETE' });
    const json = await res.json();
    if (json?.find((r) => r?.code)) throw new BinanceError('Cancel orders error', json);
    return true;
  }

  async cancelPrevious(symbol, type = 'STOP_MARKET') {
    const openOrders = await this.getOrders(symbol);
    const stopLossOrders = openOrders.filter((o) => o.type === type);
    if (stopLossOrders.length === 0) return true;
    const orderIdList = stopLossOrders.map((o) => o.orderId);
    await this.cancelMultipleOrders(symbol, orderIdList);
    return true;
  }

  async closePosition(symbol, positionSide) {
    const positions = await this.getPositions(symbol);
    const amounts = await this.getPositionAmounts(positions);
    const position = amounts.find(([pSide]) => pSide === positionSide);
    const side = getPositionSide(position[1]) === 'BUY' ? 'SELL' : 'BUY';
    return this.openPosition(positionSide, side, symbol, Math.abs(position[1]));
  }
};
