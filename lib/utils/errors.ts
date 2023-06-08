'use strict';

import type Context from "../context/base";
import type EventContext from "../context/event";
import type GlobalContext from "../context/global";

type TErrorCode = 'SAME_SIDE' | 'NO_SYMBOLS' | 'NO_MARK_PRICE' | 'NO_ASSET' | 'NO_POSITIONS' | 'CREATED_POS_NOT_FOUND' | 'NO_CYCLE' | 'TP_NO_PERCENT' | 'LIMIT_NO_PERCENT' | 'CYCLE_NOT_STARTED' | 'TP_TWO_POSITIONS' | 'TP_NO_POSITION' | 'TP_COMPLETE_CYCLE' | 'NO_START_QUANTITY' | 'NO_POSITION' | 'GLOBAL_NO_POSITIONS' | 'NO_ORDERS' | 'ROE_NO_PERCENT' | 'NO_CREATED_SL' | 'NO_SERVER_TIME' | 'NO_QUANTITY' | 'NO_ORDER';

// TODO: Make it in scanff
const ERROR_MESSAGES = {
  SAME_SIDE: ({ data, symbol }: any) => `Уже открыта  ${symbol} позиция на сайде ${data[0]}`,
  NO_SYMBOLS: ({ symbol }: any) => `Не найдено информации о паре ${symbol}`,
  NO_MARK_PRICE: ({ symbol }: any) => `markPrice для ${symbol} не найден`,
  NO_ASSET: ({ symbol, data }: any) => `asset для ${symbol} [${data[0]}] не найден`,
  NO_POSITIONS: ({ symbol, data }: any) => `Не найдены позиции для ${symbol} [${data[0]}]`,
  CREATED_POS_NOT_FOUND: ({ symbol, data }: any) => `Не удалось получить созданную позицию для ${symbol} на сайде ${data[0]}`,
  NO_CYCLE: ({ symbol, data }: any) => `Нет цикла для ${symbol} [${data[0]}]`,
  TP_NO_PERCENT: ({ symbol, data }: any) => `Не удалось получить процент для установки ТП на ${symbol} [${data[0]}]`,
  LIMIT_NO_PERCENT: ({ symbol, data }: any) => `Нет процента для установки LIMIT-ордера для ${symbol} [${data[0]}]`,
  CYCLE_NOT_STARTED: ({ symbol, data }: any) => `Цикл не начался для ${symbol} на ${data[0]}`,
  TP_TWO_POSITIONS: ({ symbol, data }: any) => `Открыто больше, чем 1 позиция на ${symbol} [${data[0]}] для ТП`,
  TP_NO_POSITION: ({ symbol, data }: any) => `Нет открытой позиции ${symbol} [${data[0]}] для открытия ТП`,
  TP_COMPLETE_CYCLE: ({ symbol, data }: any) => `${symbol} [${data[0]}] Цикл для ТП уже закрыт. Больше ТП не ожидается`,
  NO_START_QUANTITY: ({ symbol, data }: any) => `StartQuantity не указан на ${symbol} [${data[0]}] TP`,
  NO_POSITION: ({ symbol, data }: any) => `Позиция не найдена ${symbol} [${data[0]}]`,
  GLOBAL_NO_POSITIONS: () => `Не удалось получить глобальный список позиций для ROE`,
  NO_ORDERS: ({ symbol }: any) => `Нет ордеров для символа ${symbol}`,
  ROE_NO_PERCENT: ({ symbol }: any) => `Нет процента для ROE на ${symbol}`,
  NO_CREATED_SL: () => `Не удалось создать SL`,
  NO_SERVER_TIME: () => `Нет времени сервера`,
  NO_QUANTITY: () => `Нет количества`,
  NO_ORDER: () => 'Ордер не создался. Пробую еще раз'
};

export class BaseError extends Error {
  public isOperational: boolean;

  constructor(name: string, description: string, isOperational: boolean) {
    super(description);
    Object.setPrototypeOf(this, new.target.prototype);

    this.name = name;
    this.isOperational = isOperational;

    Error.captureStackTrace(this);
  }
}

export class ConfigError extends BaseError {
  constructor(description = 'Some config value was wrongly provided') {
    super('CONFIG_ERROR', description, false);
  }
}

export class FetchError extends BaseError {
  public response: any;
  public statusCode?: number;

  constructor(description: string, response: any) {
    super('FETCH_ERROR', description, true);
    this.response = response;
    this.statusCode = response?.statusCode;
  }
}

export class BinanceError extends BaseError {
  public code: number;
  public serverMessage: string;
  public ctx: any;
  public request: any;

  constructor(description: string, ctx: any, { code, msg }: { code: number; msg: string }, request: any) {
    super('BINANCE_ERROR', description, true);
    this.code = Math.abs(code);
    this.serverMessage = msg;
    this.request = request
    this.ctx = ctx.toJSON();
  }
}

export class UnexpectedBehaviourError extends BaseError {
  public code: string;
  public ctx: any;

  constructor(code: TErrorCode, ctx?: Context | EventContext | GlobalContext | undefined) {
    const errorMessage = ERROR_MESSAGES[code];
    const description = typeof errorMessage === 'function' ? errorMessage(ctx) : errorMessage;
    super('UNEXPECTED_BEHAVIOUR', description, true);
    this.code = code;
    this.ctx = ctx?.toJSON();
  }
}

