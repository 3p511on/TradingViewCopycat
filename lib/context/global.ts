'use strict';

import type BinanceClient from "../binance-client";
import Order from "../components/Order";
import Position from '../components/Position';
import { API_ENDPOINTS } from '../config/consts';
import type { FuturesExchangeInfo, FuturesPosition, NewFuturesOrderParams } from "../types/futures";
import { UnexpectedBehaviourError } from "../utils/errors";
import { createOrderBody } from "../utils/utils";
import Context from "./base";
import EventContext from "./event";


interface ICache {
  exchangeInfo: FuturesExchangeInfo | null;
  positions: {
    all: Position[] | null;
    opened: Position[] | null;
  };
  orders: Order[]
}

export default class GlobalContext extends Context {
  public cache: ICache;

  constructor(client: BinanceClient) {
    super(client)

    this.cache = {
      exchangeInfo: null,
      positions: { all: null, opened: null },
      orders: []
    };
  }

  async createOrder(data: any) {
    const body = await createOrderBody(new EventContext(this.client, 'fromGlobal', data?.symbol), data);
    const response = await this.requestApi(API_ENDPOINTS.createOrder, { body, method: 'POST' });
    return new Order(this, response);
  }

  async fetchExchangeInfo() {
    const exchangeInfo = await this.requestApi(API_ENDPOINTS.exchangeInfo);
    this.cache.exchangeInfo = exchangeInfo;
    return exchangeInfo;
  }

  async getServerTime() {
    const { serverTime } = await this.requestApi(API_ENDPOINTS.serverTime)
    if (!serverTime) throw new UnexpectedBehaviourError('NO_SERVER_TIME', this)
    return serverTime
  }

  async getPositions(force = false): Promise<Position[] | null> {
    const cached = this.cache.positions.all;
    if (cached && !force) return cached;
    const rawPositions = await this.requestApi(API_ENDPOINTS.positions);
    if (!rawPositions) return null;
    const positions = rawPositions.map((p: FuturesPosition) => new Position(this, p));
    this.cache.positions.all = positions;
    return positions;
  }

  async getOrders(force: boolean = false) {
    const cached = this.cache.orders;
    if (cached && !force) return cached;
    const rawOrders = await this.requestApi(API_ENDPOINTS.orders);
    if (!rawOrders) return null;
    const orders = rawOrders.map((o: NewFuturesOrderParams) => new Order(this, o));
    this.cache.orders = orders;
    return orders;
  }

  async getOpenedPositions(force: boolean = false): Promise<Position[] | null> {
    const positions = await this.getPositions(force);
    if (!positions) return null
    const opened = positions.filter((p: Position) => p.isOpened);
    this.cache.positions.opened = opened;
    return opened;
  }

  override toJSON() {
    return {}
  }
}
