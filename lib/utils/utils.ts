'use strict';

import { createHmac } from 'node:crypto';
import type { Response } from 'undici';
import type Position from '../components/Position';
import config from '../config/config';
import type EventContext from '../context/event';
import { UnexpectedBehaviourError } from '../utils/errors';
import errorHandler from './error-handler';
import { logger } from './logger';

export type TasksTPSL = [number, boolean, 'mark' | 'entry', number?]

export function encryptMessage(key: string, message: string) {
  return createHmac('sha256', key).update(message).digest('hex');
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function parseResponse(response: Response) {
  const header = response.headers.get('content-type')
  if (!header) return response.arrayBuffer();
  if (header.startsWith('application/json')) {
    return response.json();
  } else if (['text/plain', 'text/html'].includes(header)) {
    return response.text();
  }
}

export async function calcConfigPosValue(ctx: EventContext) {
  const { symbol } = ctx;
  const openValue = config.position.openValues[symbol];
  console.log('OpenValue', openValue, symbol)
  if (!openValue) return 0;
  const markPrice = await ctx.getMarkPrice();
  console.log('markPrice', markPrice, symbol)
  if (!markPrice) throw new UnexpectedBehaviourError('NO_MARK_PRICE', ctx)
  const quantity = +openValue / markPrice;
  console.log('quantity', quantity, symbol)

  return quantity;
}

export async function calcPosOpenPercent(ctx: EventContext) {
  const { leverage } = ctx;
  const { openPercent } = config.position;
  const balance = await ctx.getBalance(true);
  const markPrice = await ctx.getMarkPrice();
  if (!markPrice) throw new UnexpectedBehaviourError('NO_MARK_PRICE', ctx)
  return (balance * openPercent * leverage) / markPrice;
}

export async function calcPosQty(ctx: EventContext) {
  const openValue = await calcConfigPosValue(ctx);
  if (openValue) return openValue;
  const openPercent = await calcPosOpenPercent(ctx);
  if (openPercent) return openPercent
  throw new UnexpectedBehaviourError('NO_QUANTITY', ctx)
}

export async function getSymbolInfo(ctx: EventContext) {
  const { client, symbol } = ctx;
  const { symbols } = await client.globalContext.fetchExchangeInfo();
  const symbolInfo = symbols.find((s: any) => s?.symbol === symbol);
  if (!symbolInfo) throw new UnexpectedBehaviourError('NO_SYMBOLS', ctx);
  return symbolInfo
}

export async function getPrecisions(ctx: EventContext) {
  const symbolInfo = await getSymbolInfo(ctx)
  const { quantityPrecision, pricePrecision } = symbolInfo;
  return { quantityPrecision, pricePrecision };
}

export async function fixTickSize(ctx: EventContext, value: number) {
  const symbolInfo = await getSymbolInfo(ctx)
  const filter = symbolInfo.filters.find((f: any) => f?.filterType === 'PRICE_FILTER')
  if (!filter?.tickSize) return value
  const tickSize = +filter.tickSize
  if (value % tickSize !== 0) {
    value = Math.floor(value / tickSize) * tickSize;
  }
  return value
}

export async function valueToFixed(ctx: EventContext, type: 'quantity' | 'price', value: number | string) {
  if (typeof value === 'string') value = +value;
  const precision = (await getPrecisions(ctx))[`${type}Precision`];
  if (type === 'price') value = await fixTickSize(ctx, value)
  const fixedValue = value.toFixed(precision);
  return fixedValue;
}

export async function supplementMarketBody(ctx: EventContext, data: any, body: any) {
  const { quantity } = data;
  const fixedQuantity = await valueToFixed(ctx, 'quantity', quantity);
  Object.assign(body, { quantity: fixedQuantity });
  return body;
}

export async function supplementLimitBody(ctx: EventContext, data: any, body: any) {
  const { timeInForce = 'GTC', quantity, price } = data;
  const fixedQuantity = await valueToFixed(ctx, 'quantity', quantity);
  const fixedPrice = await valueToFixed(ctx, 'price', price);
  Object.assign(body, { quantity: fixedQuantity, price: fixedPrice, timeInForce });
  return body;
}

export async function supplementStopBody(ctx: EventContext, data: any, body: any, isLimit: boolean) {
  const { stopPrice, closePosition } = data;
  const fixedStopPrice = await valueToFixed(ctx, 'price', stopPrice);
  Object.assign(body, { stopPrice: fixedStopPrice, closePosition });
  if (isLimit) return supplementLimitBody(ctx, data, body);
  return body;
}

export async function createOrderBody(ctx: EventContext, data: any = {}) {
  const { symbol } = ctx;
  const { positionSide, side, type } = data;
  const body = { type, symbol, side, positionSide };
  if (type === 'MARKET') {
    await supplementMarketBody(ctx, data, body);
  } else if (type === 'LIMIT') {
    await supplementLimitBody(ctx, data, body);
  } else if (['STOP', 'TAKE_PROFIT'].includes(type)) {
    await supplementStopBody(ctx, data, body, true);
  } else if (['STOP_MARKET', 'TAKE_PROFIT_MARKET'].includes(type)) {
    await supplementStopBody(ctx, data, body, false);
  }
  return body;
}

export function calculateTPSLPrice(price: number, percent: number, side: 'BUY' | 'SELL', isStopLoss: boolean): number {
  let direction = side === 'BUY' ? 1 : -1
  if (isStopLoss) direction *= -1
  const delta = price * percent * direction
  return price + delta
}

export function addHistory(ctx: EventContext, quantity?: number, extra?: boolean) {
  const cycle = ctx.client.cycle[ctx.symbol]
  const entry = quantity ? ctx.data[0] : 'TP'
  if (quantity) ctx.client.positionsHistory[ctx.symbol] = quantity
  if (!cycle || extra) {
    ctx.client.cycle[ctx.symbol] = [entry]
    return
  }
  cycle.push(entry)
}

export function calcPartCloseQuantity(ctx: EventContext, position: Position) {
  const { client, symbol } = ctx

  const startQuantity = client.positionsHistory[symbol]
  if (!startQuantity) {
    throw new UnexpectedBehaviourError('NO_START_QUANTITY', ctx)
  }

  const cycle = client.cycle[symbol]
  if (!cycle) {
    throw new UnexpectedBehaviourError('NO_CYCLE', ctx)
  }

  let quantity = 0
  const isLastExpectedTP = cycle.length + 1 === config.fullCycleSize

  // Последний ожидаемый ТП - закрыть всю позицию
  const percent = config.position.closePercents[cycle.length - 1]
  if (isLastExpectedTP) {
    quantity = Math.abs(position.amount)
  } else {
    // Иначе, частично закрыть текущую позицию
    if (!percent) throw new UnexpectedBehaviourError('TP_NO_PERCENT', ctx)
    quantity = Math.abs(startQuantity * percent)
  }
  return [quantity, percent]
}

export async function setLimitOrders(ctx: EventContext, { posSide, entryPrice, amount }: { posSide: any, entryPrice: number; amount: number; } | Position, changeSide: boolean) {
  let { data: [side], symbol } = ctx
  const successLimits = []
  for (const [pricePercent, positionPercent] of config.limitOrders) {
    try {
      if (!pricePercent || !positionPercent) {
        throw new UnexpectedBehaviourError('LIMIT_NO_PERCENT', ctx)
      }
      if (changeSide) side = side === 'BUY' ? 'SELL' : 'BUY'
      const orderPrice = calculateTPSLPrice(entryPrice, pricePercent, side, true)
      const orderQuantity = Math.abs(amount) * positionPercent;
      const body = { symbol, positionSide: posSide, type: "LIMIT", quantity: orderQuantity, price: orderPrice, timeInForce: "GTC", side }
      const limitOrder = await ctx.createOrder(body)
      logger.info(`Создан LIMIT для ${symbol} на ${side === 'BUY' ? 'открытие' : 'закрытие'} сделки на ${orderQuantity} (${positionPercent * 100}%) при цене ${orderPrice} (${pricePercent * 100}%)`)
      successLimits.push(limitOrder)
    } catch (err) {
      if (errorHandler.isTrustedError(err)) {
        errorHandler.handleError(err);
        continue;
      }
      throw err;
    }
  }
  logger.debug(`Успешно создано ${successLimits.length} из ${config.limitOrders.length} LIMIT-ордеров`)
}

export async function setTPSL(ctx: EventContext, position: Position, tasks: TasksTPSL[]) {
  await ctx.getOrders(ctx.symbol, true)
  const orders = ctx.orders?.filter(o => o.symbol === position.symbol)
  const success = []
  for (const [percent, isStopLoss, priceType, price] of tasks) {
    if (!percent) continue
    // If there's such order, close it
    if (orders) {
      const sameOrders = orders.filter(o => isStopLoss ? o.isStopLoss : o.isTakeProfit)
      for (const order of sameOrders) {
        await order.cancel()
        logger.info(`Закрыт ордер ${order.type} на символе ${order.symbol} для установки нового`)
      }
    }
    if (price) position.entryPrice = price
    const stopPrice = position.calcStopPrice(percent, isStopLoss, priceType)
    const order = await position.setTPSL(stopPrice, isStopLoss)
    if (!order) throw new UnexpectedBehaviourError('NO_ORDER', ctx)
    success.push(order)
    logger.info(`Установлен ${isStopLoss ? 'SL' : 'TP'} на ${order.symbol} [${order.side}] в размере ${stopPrice} (${percent * 100}%)`)
  }
  return success
}

export async function retryAsync<T>(fn: () => Promise<T>, maxAttempts: number, timeoutMs: number): Promise<T> {
  let attempts = 0;
  while (true) {
    try {
      if (attempts !== 0) logger.warn(`Повторение запроса №${attempts}`)
      const result = await fn();
      return result;
    } catch (error) {
      console.error(error)
      attempts++;
      if (attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, timeoutMs * attempts));
      } else {
        if (errorHandler.isTrustedError(error)) {
          errorHandler.handleError(error)
        } else throw error
      }
    }
  }
}
