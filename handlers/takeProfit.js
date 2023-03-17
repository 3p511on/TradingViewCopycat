'use strict';

const debug = require('debug')('TakeProfitEvent');
const { checkCycleRightness } = require('../util');

const { TP_PERCENTS, SL_AFTER_TP, TP_AFTER_TP } = process.env;
const tpPercents = TP_PERCENTS.split(',');
const PositionSide = {
  SELL: 'SHORT',
  BUY: 'LONG',
};

module.exports = async (client, symbol, side) => {
  try {
    const _debugInfo = `Symbol: ${symbol} | Side: ${side}`;

    // Если цикл еще не начался, ничего не делаем
    if (client.isFirstEvent(symbol)) {
      debug(['Цикл еще не начался, игнор ТП', _debugInfo].join('\n'));
      return false;
    }

    const currentPositions = await client.getPositions(symbol);
    const currentPositionAmounts = client.getPositionAmounts(currentPositions);
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

    // Выход, если номер ТП больше ожидаемых
    if (client.cycle[symbol].length >= client.fullCycleSize) {
      const debugInfo = ['Цикл уже был завершен, а ТП не могут угомониться!', _debugInfo];
      debug(debugInfo.join('\n'));
      return false;
    }

    const curPositionAmount = currentPosition ? currentPosition[1] : 0;
    const isCycleRight = checkCycleRightness(client, symbol, curPositionAmount, debug, _debugInfo);
    if (!isCycleRight && !client.isCompleteCycle(symbol)) return false;

    // Если сайд уже открытой позиции отличается от ТП, че за хрень?
    const currentPositionSide = currentPosition ? currentPosition[0] : null;
    if (currentPositionSide !== PositionSide[side]) {
      const debugInfo = [
        'Какая-то хрень. Сайд ТП отличается от текущей открытой позиции',
        `${_debugInfo} | CurrentPosition: ${currentPosition}`,
      ];
      debug(debugInfo.join('\n'));
      return false;
    }

    let quantity = 0;
    // Если это последний ожидаемый ТП, надо закрыть позицию полностью
    const isLastExpectedTP = client.cycle[symbol].length + 1 === client.fullCycleSize;
    if (isLastExpectedTP) {
      quantity = Math.abs(currentPosition[1]);
    } else {
      // Иначе забрать от изначальной позиции еще часть
      const currentTpIndex = client.cycle[symbol].length;
      const percent = client.parsePercent(tpPercents[currentTpIndex - 1]);
      quantity = client.getPartOfPosition(symbol, percent);
    }

    const partCloseSide = side === 'BUY' ? 'SELL' : 'BUY';
    const positionSide = side === 'BUY' ? 'LONG' : 'SHORT';
    await client.openPosition(positionSide, partCloseSide, symbol, quantity);
    client.cycle[symbol].push('TP');

    // Удалить прошлый стоп лосс
    await client.cancelPrevious(symbol, 'STOP_MARKET');
    await client.cancelPrevious(symbol, 'TAKE_PROFIT_MARKET');

    // Нужно ли ставить стоп лосс? (Он будет 0 - если нет)
    const shouldSetSL = client.parsePercent(SL_AFTER_TP);
    if (shouldSetSL) {
      const stopPrice = await client.calculatePercent(true, symbol, side, SL_AFTER_TP);
      const stopLossSide = side === 'BUY' ? 'SELL' : 'BUY';
      await client.setTPSL(symbol, positionSide, 'STOP_MARKET', stopLossSide, stopPrice);
    }

    const shouldSetTP = client.parsePercent(TP_AFTER_TP);
    if (shouldSetTP) {
      const tpPrice = await client.calculatePercent(false, symbol, side, TP_AFTER_TP);
      const tpSide = side === 'BUY' ? 'SELL' : 'BUY';
      await client.setTPSL(symbol, positionSide, 'TAKE_PROFIT_MARKET', tpSide, tpPrice);
    }

    return true;
  } catch (err) {
    console.error(err);
    return false;
  }
};
