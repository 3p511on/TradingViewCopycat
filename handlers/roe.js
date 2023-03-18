'use strict';

const d = require('debug')('roeHandler');
const { parsePercent } = require('../util');

const { SL_ON_PNL } = process.env;

const stringifyPercent = (percent) => `${(percent * 100).toFixed(2)}%`;

const stopLossVars = SL_ON_PNL.split(', ')
  .map((s) => s.split(':').map((e) => parsePercent(e)))
  .sort((a, b) => +b[0] - +a[0]);

module.exports = async (client, position) => {
  try {
    const { symbol, roe, positionSide } = position;

    // Есть ли для текущего ROE настройки стоп лосса?
    const slPercent = stopLossVars.find(([sl]) => roe >= sl);
    if (!slPercent) throw new Error(`${symbol} - to low ROE ${stringifyPercent(roe)}`);

    const slOrder = (await client.getOrders(symbol)).find((p) => p.type === 'STOP_MARKET');
    const slAlreadySet = client.slHistory[symbol] === slPercent[0];
    if (slOrder && slAlreadySet) {
      return false;
    } else if (!slOrder && slAlreadySet) {
      client.slHistory[symbol] = null;
    }

    // Удалить прошлый СЛ
    await client.cancelPrevious(symbol, 'STOP_MARKET');

    const stopPrice = await client.calculatePercent(true, symbol, positionSide, slPercent[1]);
    const stopLossSide = positionSide === 'LONG' ? 'SELL' : 'BUY';
    await client.setTPSL(symbol, positionSide, 'STOP_MARKET', stopLossSide, stopPrice);

    client.slHistory[symbol] = slPercent[0];
    d('Successfully SL set for %s - %s USDT at ROE %s', symbol, stopPrice.toFixed(2), stringifyPercent(roe));

    return true;
  } catch (err) {
    return false;
  }
};
