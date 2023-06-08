'use strict';

import client from '..';
import Position from '../../lib/components/Position';
import config from '../../lib/config/config';
import type EventContext from "../../lib/context/event";
import errorHandler from '../../lib/utils/error-handler';
import { UnexpectedBehaviourError } from '../../lib/utils/errors';
import { logger } from '../../lib/utils/logger';
import { addHistory, calcPosQty, retryAsync, setLimitOrders, setTPSL, TasksTPSL } from '../../lib/utils/utils';

export default async (ctx: EventContext, symbol: string, side: 'BUY' | 'SELL', tickPrice: number | undefined, iteration: number = 0) => {
  try {
    if (iteration > 3) {
      logger.warn('Пропускаю действие, потому что он повторяется больше 3 раз неудачно')
      return
    }

    const { openedPositions, client, orders } = ctx;
    if (!Array.isArray(openedPositions)) throw new UnexpectedBehaviourError('NO_POSITIONS', ctx)

    const isCompleteCycle = client.isCompleteCycle(symbol);
    const isFirstEvent = client.isFirstEvent(symbol);

    const { allowExtra, setExtraEvery, extraIntervalPercent, limitOrderPricePercent } = config.position

    const sameSide = openedPositions.find((p) => p.side === side);
    const isExtra = sameSide && allowExtra
    const extraHistory = client.extraHistory[symbol]


    if (!extraIntervalPercent) {
      if (isExtra && setExtraEvery !== extraHistory && openedPositions?.length > 0) {
        client.extraHistory[symbol] += 1;
        logger.warn(`Пропускаю ивент на открытие ${symbol} [${side}] из-за соблюдения интервала (${client.extraHistory[symbol]}/${setExtraEvery})`)
        return
      } else {
        client.extraHistory[symbol] = 0
      }
    }


    // If some positions are opened
    if (openedPositions?.length > 0 && config.createPositions) {
      if (openedPositions.length === 1) {
        // When it's same side and extra not allowed, error
        if (sameSide && !config.position.allowExtra) throw new UnexpectedBehaviourError('SAME_SIDE', ctx);
      }

      // When there're two positions on SHORT and LONG, or just opposite side,
      // the position can be closed
      const twoPositions = openedPositions.length > 1;
      const isOppositeSide = openedPositions.find(p => p.side !== side)
      const shouldClose = !isCompleteCycle && !isFirstEvent && !isExtra
      for (const position of openedPositions) {
        if (shouldClose || twoPositions || isOppositeSide) {
          await position.close();
          logger.info(`Закрыта позиция ${position.symbol} на сайде ${position.posSide} в размере ${position.amount}`)
        }
      }
    }

    // Cancel all previous orders
    await ctx.cancelAllOrders()
    if (Array.isArray(orders)) logger.info(`Закрыто ${orders.length} ордеров на паре ${symbol} [${side}] из-за открытия новой позиции`)

    // Create position
    let position: Position;
    if (config.createPositions) {
      let quantity = await calcPosQty(ctx);

      // Если есть tickPrice и в настройках указан процент для отклонения
      // создаем лимит ордер на создание позиции по цене
      if (tickPrice && limitOrderPricePercent) {
        const positionSide: 'LONG' | 'SHORT' = side === 'BUY' ? 'LONG' : 'SHORT'
        const orderPrice: number = positionSide === 'LONG' ? tickPrice - tickPrice * limitOrderPricePercent : tickPrice + tickPrice * limitOrderPricePercent
        const limitOrderBody = { symbol, positionSide, type: 'LIMIT', quantity, price: orderPrice, timeInForce: 'GTC', side }
        const limitOrder = await ctx.createOrder(limitOrderBody)
        if (!limitOrder.id) throw new UnexpectedBehaviourError('NO_ORDER', ctx)
        console.log(limitOrder)
        logger.info(`Создан LIMIT для ${symbol} на открытие сделки на ${quantity} при цене ${orderPrice} (${limitOrderPricePercent * 100}%) | TickPrice: ${tickPrice}`)
        ctx.client.orderFilledCheck[symbol] = { orderId: limitOrder.id, amount: quantity, entryPrice: tickPrice }
        throw new Error('skip')
      } else {
        if (extraIntervalPercent) {
          if (isExtra && setExtraEvery !== extraHistory && openedPositions[0]) {
            client.extraHistory[symbol] += 1;
            quantity = Math.abs(openedPositions[0]?.amount * extraIntervalPercent)
            logger.warn(`Интервал - ${symbol} [${side}]. | Новое количество ${quantity} | (${client.extraHistory[symbol]}/${setExtraEvery})`)
          } else {
            client.extraHistory[symbol] = 0
          }
        }

        const createdPosition = await Position.create(ctx, { quantity, side });
        if (!createdPosition.amount) throw new UnexpectedBehaviourError('NO_POSITION', ctx)
        addHistory(ctx, Math.abs(createdPosition.amount), isExtra)
        logger.info(`Открыта позиция ${symbol} [${side}] на ${quantity}`)
        position = createdPosition
      }
    } else {
      const foundedPosition: Position | undefined = openedPositions.find(p => p.side === side)
      if (!foundedPosition) {
        throw new UnexpectedBehaviourError('NO_POSITION', ctx)
      }
      position = foundedPosition
    }

    // Set limit orders
    await retryAsync(() => setLimitOrders(ctx, position, true), 15, 1000)

    // Set SL/TP
    const slTpTasks: TasksTPSL[] = [[config.stopLoss.onPositionOpen, true, 'entry'], [config.takeProfit.onPositionOpen, false, 'entry']]
    await retryAsync(() => setTPSL(ctx, position, slTpTasks), 15, 1000)
  } catch (err: Error | any) {
    if (err?.message === 'skip') return
    if (err instanceof UnexpectedBehaviourError) {
      // Timestamp for this request is outside of the recvWindow.
      if (err.code === 'NO_POSITIONS' || err.code === 'NO_POSITION' || err.code === "NO_ORDER") {
        // TODO
        client.emit('openPosition', symbol, side, tickPrice, iteration + 1)
        return
      }
    }
    if (errorHandler.isTrustedError(err)) {
      errorHandler.handleError(err);
      return;
    }
    throw err;
  }
};

