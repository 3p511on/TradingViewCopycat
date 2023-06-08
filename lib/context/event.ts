'use strict';

import type BinanceClient from "../binance-client";
import Order from '../components/Order';
import Position from '../components/Position';
import { API_ENDPOINTS, ASSETS, DEFAULT_LEVERAGE } from '../config/consts';
import type { FuturesPosition, NewFuturesOrderParams } from "../types/futures";
import { BinanceError, UnexpectedBehaviourError } from "../utils/errors";
import { createOrderBody } from '../utils/utils';
import Context from "./base";

interface IBalances {
  [asset: string]: number
}

export default class EventContext extends Context {
  public cache: {
    leverage: number;
    balances: IBalances | null;
    positions: {
      all: Position[] | null;
      opened: Position[] | null;
    };
    orders: Order[] | null;
    markPrice: number;
  };
  public eventName: string;
  public symbol: string;
  public data: any;
  public otherDebug: any;

  constructor(client: BinanceClient, eventName: string, symbol: string | undefined, ...data: any) {
    super(client)
    if (!symbol) throw new TypeError('No symbol')

    this.cache = {
      leverage: 0,
      balances: null,
      positions: {
        // Nur die, die die Paare betreffen
        all: null,
        opened: null,
      },
      orders: null,
      markPrice: 0,
    };

    this.otherDebug = {
      timestamps: []
    }

    this.eventName = eventName;
    this.symbol = symbol;
    this.data = data;
  }

  get positions() {
    return this.cache.positions.all;
  }

  get openedPositions(): Position[] | null {
    return this.cache.positions.opened;
  }

  get orders() {
    return this.cache.orders;
  }

  get asset() {
    const { symbol } = this;
    return ASSETS.find((a: string) => symbol.endsWith(a));
  }

  get balance() {
    const { cache, asset } = this;
    if (!asset) throw new UnexpectedBehaviourError('NO_ASSET', this)
    const balanceStr = cache?.balances && cache?.balances[asset]
    return balanceStr ? balanceStr : 0
  }

  get leverage() {
    const { cache } = this;
    return cache.leverage;
  }

  async initEventCtx() {
    await this.getOpenedPositions();
    await this.getOrders(this.symbol);
  }

  async getPositions(symbol = this.symbol, force = false): Promise<Position[] | null> {
    const cached = this.cache.positions.all;
    if (cached && !force) return cached;
    const body = { symbol };
    const rawPositions = await this.requestApi(API_ENDPOINTS.positions, { body });
    if (!rawPositions) return null;
    const positions = rawPositions.map((p: FuturesPosition) => new Position(this, p));
    this.cache.positions.all = positions;
    this.cache.leverage = positions[0]?.leverage ?? DEFAULT_LEVERAGE;
    return positions;
  }

  async getPosition(side: 'BUY' | 'SELL', force: boolean | undefined): Promise<Position> {
    const positions = await this.getPositions(this.symbol, force)
    const position = positions?.find(p => p.side === side)
    if (!position) throw new UnexpectedBehaviourError('NO_POSITION', this)
    return position
  }

  async getOpenedPositions(symbol?: string, force: boolean = false): Promise<Position[] | null> {
    const positions = await this.getPositions(symbol, force);
    if (!positions) return null
    const opened = positions.filter((p: Position) => p.isOpened);
    this.cache.positions.opened = opened;
    return opened;
  }

  async getOrders(symbol: string, force: boolean = false) {
    const cached = this.cache.orders;
    if (cached && !force) return cached;
    const body = { symbol };
    const rawOrders = await this.requestApi(API_ENDPOINTS.orders, { body });
    if (!rawOrders) return null;
    const orders = rawOrders.map((o: NewFuturesOrderParams) => new Order(this, o));
    this.cache.orders = orders;
    return orders;
  }

  async getBalances(force = true) {
    const cached = this.cache.balances;
    if (cached && !force) return cached;
    const rawBalances = await this.requestApi(API_ENDPOINTS.balances);
    if (!rawBalances) return null;
    const balances = Object.fromEntries(rawBalances.map((b: any) => [b.asset, +b.balance]));
    this.cache.balances = balances;
    return balances;
  }

  async getBalance(force = false) {
    await this.getBalances(force);
    return this.balance;
  }

  async getMarkPrice(force = false) {
    const { symbol } = this;
    const cached = this.cache.markPrice;
    if (cached && !force) return cached;
    const body = { symbol };
    const rawPrice = await this.requestApi(API_ENDPOINTS.markPrice, { body });
    if (!rawPrice) return null;
    const markPrice = +rawPrice.price;
    this.cache.markPrice = markPrice;
    return markPrice;
  }

  async createOrder(data: any) {
    const body = await createOrderBody(this, data);
    const response = await this.requestApi(API_ENDPOINTS.createOrder, { body, method: 'POST' });
    return new Order(this, response);
  }

  async cancelAllOrders() {
    const body = { symbol: this.symbol }
    const opts = { body, method: 'DELETE' }
    const response = await this.requestApi(API_ENDPOINTS.cancelAllOrders, opts)
    const isSuccess = response?.code === 200
    if (!isSuccess) throw new BinanceError('NOT_OK', this, response, opts)
    return response
  }

  override toJSON() {
    const { cache, eventName, symbol, data } = this;
    return {
      eventName,
      symbol,
      data,
      cache,
    };
  }
}
