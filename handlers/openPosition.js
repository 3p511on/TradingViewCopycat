'use strict';

const debug = require('debug')('OpenPositionEvent');
const { parsePercent } = require('../util');

const { POSITION_OPEN_PERCENT, POSITION_OPEN_VALUES, SL_POSITION_OPEN, TP_POSITION_OPEN, LIMIT_ORDERS } = process.env;

const limitPercents = LIMIT_ORDERS.split(', ')
  .map((s) => s.split(':').map((e) => parsePercent(e)))
  .sort((a, b) => +b[0] - +a[0]);

const PositionSide = {
  SELL: 'SHORT',
  BUY: 'LONG',
};

const getPositionValue = async (client, symbol) => {
  const symbols = Object.fromEntries(POSITION_OPEN_VALUES.split(',').map((e) => e.split(':')));
  const symbolValue = +symbols[symbol];
  if (isNaN(symbolValue)) return null;
  const markPrice = await client.getMarkPrice(symbol);
  const quantity = symbolValue / markPrice;
  return quantity;
};

const getQuantity = async (client, symbol, leverage) => {
  try {
    const positionValue = await getPositionValue(client, symbol);
    if (positionValue && !isNaN(positionValue)) return positionValue;
    else return client.getPartOfBalance(symbol, POSITION_OPEN_PERCENT, leverage);
  } catch (err) {
    return 0;
  }
};

module.exports = async (client, symbol, side) => {
  try {
    const _debugInfo = `Symbol: ${symbol} | Side: ${side}`;

    const currentPositions = await client.getPositions(symbol);
    const currentPositionAmounts = client.getPositionAmounts(currentPositions ?? []);
    const activePositions = currentPositionAmounts.filter(([, posAmount]) => posAmount !== 0);

    if (activePositions.length > 1) {
      for (const position of activePositions) {
        await client.closePosition(symbol, position[0]);
      }
      const debugInfo = [
        'Открыто 2 позиции на одном символе. Закрываю все и продолжаю',
        `${_debugInfo} | Positions: ${activePositions}`,
      ];
      debug(debugInfo.join('\n'));
    }
    const currentPosition = activePositions.length === 1 ? activePositions[0] : null;

    // Если сайд уже открытой позиции равняется той, что надо открыть, игнор
    const currentPositionSide = currentPosition ? currentPosition[0] : null;
    if (currentPositionSide === PositionSide[side]) {
      const debugInfo = [
        'Cайд уже открытой позиции равняется той, что надо открыть',
        `${_debugInfo} | CurrentPosition: ${currentPosition}`,
      ];
      debug(debugInfo.join('\n'));
      return false;
    }

    if (!client.cycle[symbol]) client.cycle[symbol] = [];

    // Является ли прошлый законченным
    // Нужно ли закрыть прошлую позицию
    // Прошлый цикл не закончен, не первый запуск
    const shouldCloseCurrent = (!client.isCompleteCycle && !client.isFirstEvent(symbol)) || currentPosition;

    // Считаем количество монеты для открытия позиции
    // Если нужно закрыть прошлую, меняем знак количества
    // Добавляем нужное количество, процент от баланса
    if (shouldCloseCurrent) {
      await client.closePosition(symbol, currentPositionSide);
    }

    // Открытие позиции и запомнить это
    const leverage = currentPositions[0].leverage;
    const quantity = await getQuantity(client, symbol, leverage);
    const positionSide = side === 'BUY' ? 'LONG' : 'SHORT';
    await client.openPosition(positionSide, side, symbol, quantity);
    client.clearPositionHistory(symbol);
    client.pushPositionHistory(symbol, quantity);
    client.cycle[symbol] = [side];

    // Set limit orders
    const markPrice = await client.getMarkPrice(symbol);
    const direction = side === 'BUY' ? 1 : -1;
    const limitOrders = limitPercents.map(([pPercent, qPercent]) => [
      Math.abs((direction + pPercent) * markPrice),
      quantity * qPercent,
    ]);
    let q = quantity;
    for await (let [i, [price, qty]] of Object.entries(limitOrders)) {
      if (i === limitOrders.length - 1) qty = q;
      const oppositeSide = side === 'BUY' ? 'SELL' : 'BUY';
      await client.createOrder({
        symbol,
        positionSide,
        side: oppositeSide,
        type: 'LIMIT',
        quantity: client.normalizeQty(symbol, qty),
        price: client.normalizePrice(symbol, price),
        timeInForce: 'GTC',
      });
      console.log(`Created LIMIT order for ${symbol} | Price: ${price} | Qty: ${qty}`);
      q -= qty;
    }

    // Удалить прошлый стоп лосс
    await client.cancelPrevious(symbol, 'STOP_MARKET');
    await client.cancelPrevious(symbol, 'TAKE_PROFIT_MARKET');

    // Нужно ли ставить стоп лосс? (Он будет 0 - если нет)
    const shouldSetSL = parsePercent(SL_POSITION_OPEN);
    if (shouldSetSL) {
      const stopPrice = await client.calculatePercent(true, symbol, side, SL_POSITION_OPEN);
      const stopLossSide = side === 'BUY' ? 'SELL' : 'BUY';
      await client.setTPSL(symbol, positionSide, 'STOP_MARKET', stopLossSide, stopPrice);
    }

    const shouldSetTP = parsePercent(TP_POSITION_OPEN);
    if (shouldSetTP) {
      const tpPrice = await client.calculatePercent(false, symbol, side, TP_POSITION_OPEN);
      const tpSide = side === 'BUY' ? 'SELL' : 'BUY';
      await client.setTPSL(symbol, positionSide, 'TAKE_PROFIT_MARKET', tpSide, tpPrice);
    }
    return true;
  } catch (err) {
    console.error(err);
    return false;
  }
};
