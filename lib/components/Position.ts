'use strict';

import type BinanceClient from "../binance-client";
import { roeChangePercents } from '../config/config';
import type EventContext from "../context/event";
import type { FuturesPosition } from "../types/futures";
import { UnexpectedBehaviourError } from "../utils/errors";
import { calculateTPSLPrice } from "../utils/utils";

export default class Position {
  public ctx: EventContext;
  public client: BinanceClient;
  public entryPrice!: number;
  public leverage!: number;
  public liquidationPrice!: number;
  public markPrice!: number;
  public amount!: number;
  public symbol!: string;
  public pnl!: number;
  public posSide: any;
  public side!: 'BUY' | 'SELL';

  constructor(ctx: any, data: FuturesPosition) {
    this.ctx = ctx;
    this.client = this.ctx.client;
    if (data) this.init(data);
  }

  init(data: any) {
    this.entryPrice = +data.entryPrice;
    this.leverage = +data.leverage;
    this.liquidationPrice = +data.liquidationPrice;
    this.markPrice = +data.markPrice;
    this.amount = +data.positionAmt;
    this.symbol = data.symbol;
    this.pnl = +data.unRealizedProfit;
    this.posSide = data.positionSide;
    this.side = this.posSide === 'LONG' ? 'BUY' : 'SELL';
  }

  async close(quantity: number | undefined = this.amount) {
    const closePositionSide = this.side === 'BUY' ? 'SELL' : 'BUY'
    const closeOptions = { side: closePositionSide, quantity: Math.abs(quantity), positionSide: this.posSide }
    const closedPosition = await Position.create(this.ctx, closeOptions)
    return closedPosition
  }

  static async create(ctx: any, { side, quantity, positionSide }: any) {
    const { symbol } = ctx;
    if (!positionSide) positionSide = side === 'BUY' ? 'LONG' : 'SHORT';
    const body = { symbol, positionSide, side, type: 'MARKET', quantity };
    await ctx.createOrder(body);
    const positions = await ctx.getPositions(ctx.symbol, true)
    const createdPosition = positions.find((p: Position) => p.side === side)
    if (!createdPosition) {
      throw new UnexpectedBehaviourError('CREATED_POS_NOT_FOUND', ctx)
    }
    return createdPosition
  }

  async setTPSL(stopPrice: number, isStopLoss: boolean) {
    const { posSide: positionSide, symbol } = this
    const type = isStopLoss ? 'STOP_MARKET' : 'TAKE_PROFIT_MARKET'
    const side = this.side === 'BUY' ? 'SELL' : 'BUY'
    const body = { positionSide, symbol, side, type, stopPrice, closePosition: true }
    if (isStopLoss) console.log('Stop loss for', symbol, body)
    const order = this.ctx.createOrder(body)
    return order
  }

  calcStopPrice(percent: number, isStopLoss: boolean, priceType: 'mark' | 'entry') {
    const { side } = this
    const price = Math.abs(this[`${priceType}Price`])
    console.log(priceType, price)
    return calculateTPSLPrice(price, percent, side, isStopLoss)
  }

  get isOpened() {
    return Math.abs(this.amount) > 0;
  }

  get roe() {
    const { markPrice } = this
    return this.calculateRoe(markPrice)
  }

  calculateRoe(price: number) {
    const { posSide, leverage, entryPrice } = this
    const direction = posSide === 'LONG' ? 1 : -1
    return (direction * leverage * (price - entryPrice)) / price;
  }

  get roeSlPercent() {
    const { roe } = this
    const slPercent = roeChangePercents.find(([roePercent]) => roePercent && roePercent <= roe)
    return slPercent
  }

  get roeSlPercentIndex() {
    if (!this.roeSlPercent) return -1
    return roeChangePercents.indexOf(this.roeSlPercent)
  }

  toJSON() {
    const { entryPrice, leverage, liquidationPrice, markPrice, amount, symbol, pnl, posSide, side, isOpened, roe, roeSlPercent } = this;
    return { entryPrice, leverage, liquidationPrice, markPrice, amount, symbol, pnl, posSide, side, isOpened, roe, roeSlPercent, };
  }
}
