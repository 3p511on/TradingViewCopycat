'use strict';

const positionSides = { 0: null, 1: 'BUY', '-1': 'SELL' };

const getPositionSide = (amount) => positionSides[Math.sign(amount).toString()];

const checkCycleRightness = (client, symbol, posAmount, debug, _debugInfo) => {
  const positionSide = getPositionSide(posAmount);
  if (!client.cycle[symbol]) client.cycle[symbol] = [];
  if (client.isFirstEvent(symbol) || positionSide === client.cycle[symbol][0]) return true;
  const debugInfo = [
    'Сохраненная история не соответствует действительности',
    `${_debugInfo} | CurrentPosition: ${posAmount} - ${positionSide} | SavedCycle: [${client.cycle[symbol].join(
      ', ',
    )}]`,
  ];
  debug(debugInfo.join('\n'));
  return false;
};

const parsePercent = (percent) => {
  if (typeof percent === 'string') {
    if (percent.endsWith('%')) percent = percent.slice(0, -1);
    percent = +percent;
  }
  if (percent < 1) return percent;
  return percent / 100;
};

module.exports = { getPositionSide, checkCycleRightness, parsePercent };
