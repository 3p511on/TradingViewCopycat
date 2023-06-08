import type { WsMessageFuturesUserDataTradeUpdateEventFormatted } from 'binance/lib/types/websockets';
import type BinanceClient from "../binance-client";
import type EventContext from "../context/event";
import type GlobalContext from "../context/global";
import type { NewFuturesOrderParams } from "../types/futures";

export default class Order {
  public ctx: EventContext | GlobalContext;
  public client: BinanceClient;

  public clientId: string | undefined;
  public id: any;
  public price: number | undefined;
  public reduceOnly: string | undefined;
  public side!: string;
  public posSide: string | undefined;
  public stopPrice: number | undefined;
  public closePosition: string | undefined;
  public symbol!: string;
  public timeInForce: string | undefined;
  public type!: string;


  constructor(ctx: EventContext | GlobalContext, data?: NewFuturesOrderParams) {
    this.ctx = ctx;
    this.client = this.ctx.client;
    if (data) this.init(data);
  }

  init(data: NewFuturesOrderParams) {
    this.clientId = data.clientOrderId;
    this.id = data.orderId;
    this.price = data.price;
    this.reduceOnly = data.reduceOnly;
    this.side = data.side;
    this.posSide = data.positionSide;
    this.stopPrice = data.stopPrice;
    this.closePosition = data?.closePosition;
    this.symbol = data.symbol;
    this.timeInForce = data.timeInForce;
    this.type = data.type;
  }

  update(data: WsMessageFuturesUserDataTradeUpdateEventFormatted) {
    const { order: newOrder } = data
    this.stopPrice = newOrder.stopPrice
    this.price = newOrder.originalPrice
    this.side = newOrder.orderSide
    this.posSide = newOrder.positionSide
    this.timeInForce = newOrder.timeInForce
    this.type = newOrder.orderType
    this.id = newOrder.orderId
    this.symbol = newOrder.symbol
  }

  async cancel() {
    return this.client.api.cancelOrder(this.ctx, this.symbol, this.id)
  }

  get isTakeProfit() {
    return this.type === 'TAKE_PROFIT' || this.type === 'TAKE_PROFIT_MARKET'
  }

  get isStopLoss() {
    return this.type === 'STOP' || this.type === 'STOP_MARKET'
  }

  toJSON() {
    const { clientId, id, price, reduceOnly, side, posSide, stopPrice, closePosition, symbol, timeInForce, type } =
      this;
    return { clientId, id, price, reduceOnly, side, posSide, stopPrice, closePosition, symbol, timeInForce, type };
  }
}
