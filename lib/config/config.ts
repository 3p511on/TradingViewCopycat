'use strict';

import * as Joi from 'joi';
import { ConfigError } from '../utils/errors';
import { parseClosePercents, parsePercent, parsePercentsDict, parseSymbDict } from './parse-utils';

// TODO: Env validation
const envsSchema = Joi.object()
  .keys({
    NODE_ENV: Joi.string().valid('production', 'integration', 'development').required(),
    PORT: Joi.number().required(),
    WEBHOOK_PASSWORD: Joi.string().required(),

    BIN_API_KEY: Joi.string().required(),
    BIN_API_SECRET: Joi.string().required(),

    // Position
    POSITION_OPEN_VALUES: Joi.string().default(''),
    POSITION_OPEN_PERCENT: Joi.string().default(''),
    POSITION_CLOSE_AFTER_TP: Joi.string().default(''),
    LIMIT_ORDER_PRICE_PERCENT: Joi.string().default(''),

    // Stop loss
    SL_POSITION_OPEN: Joi.string().default(''),
    SL_AFTER_TP: Joi.string().default(''),
    SL_ON_ROE: Joi.string().allow('').default(''),

    // Take profit
    TP_POSITION_OPEN: Joi.string().default(''),
    TP_AFTER_TP: Joi.string().default(''),

    // Misc
    LEVERAGES: Joi.string().default(''),
    LIMIT_ORDERS: Joi.string().allow('').default(''),
    ALLOW_EXTRA_POSITION: Joi.number().default(0),
    SET_EXTRA_EVERY: Joi.number().default(0),
    EXTRA_INTERVAL_PERCENT: Joi.string().default(''),
    ONLY_PNL: Joi.number().default(0),
    DONT_CREATE_POSITIONS: Joi.number().default(0),

    SENTRY_DSN: Joi.string().required(),
  })
  .unknown(true);

const { value: envVars, error } = envsSchema.prefs({ errors: { label: 'key' } }).validate(process.env);

if (error) {
  throw new ConfigError(`Config validation error: ${error.message}.`);
}

// Map env vars and make it visible outside module
interface Config {
  env: 'production' | 'integration' | 'development';
  isDevEnvironment: boolean;
  isIntegration: boolean;
  port: number;
  webhookPassword: string;
  binance: {
    key: string;
    secret: string;
  };
  position: {
    openValues: { [symbol: string]: number };
    openPercent: number;
    closePercents: number[];
    allowExtra: boolean;
    setExtraEvery: number;
    extraIntervalPercent: number;
    limitOrderPricePercent: number;
  };
  stopLoss: {
    onPositionOpen: number;
    onTakeProfit: number;
    onRoeChange: number[][];
  };
  takeProfit: {
    onPositionOpen: number;
    onTakeProfit: number;
  }
  leverages: { [symbol: string]: number };
  limitOrders: number[][];
  sentry: {
    dsn: string;
  };
  fullCycleSize: number;
  onlyPnl: boolean;
  createPositions: boolean;
}

const closePercents = parseClosePercents(envVars.POSITION_CLOSE_AFTER_TP)

const config: Config = {
  env: envVars.NODE_ENV,
  webhookPassword: envVars.WEBHOOK_PASSWORD,
  isDevEnvironment: envVars.NODE_ENV === 'development',
  isIntegration: envVars.NODE_ENV !== 'production',
  onlyPnl: !!envVars.ONLY_PNL,
  port: envVars.PORT,
  binance: {
    key: envVars.BIN_API_KEY,
    secret: envVars.BIN_API_SECRET,
  },
  position: {
    openValues: parseSymbDict<number>(envVars.POSITION_OPEN_VALUES, true),
    openPercent: parsePercent(envVars.POSITION_OPEN_PERCENT),
    closePercents,
    allowExtra: !!envVars.ALLOW_EXTRA_POSITION,
    setExtraEvery: envVars.SET_EXTRA_EVERY,
    extraIntervalPercent: parsePercent(envVars.EXTRA_INTERVAL_PERCENT),
    limitOrderPricePercent: parsePercent(envVars.LIMIT_ORDER_PRICE_PERCENT)
  },
  stopLoss: {
    onPositionOpen: parsePercent(envVars.SL_POSITION_OPEN),
    onTakeProfit: parsePercent(envVars.SL_AFTER_TP),
    onRoeChange: parsePercentsDict(envVars.SL_ON_ROE),
  },
  takeProfit: {
    onPositionOpen: parsePercent(envVars.TP_POSITION_OPEN),
    onTakeProfit: parsePercent(envVars.TP_AFTER_TP),
  },
  leverages: parseSymbDict<number>(envVars.LEVERAGES, true),
  limitOrders: parsePercentsDict(envVars.LIMIT_ORDERS),
  sentry: {
    dsn: envVars.SENTRY_DSN,
  },
  fullCycleSize: closePercents.length + 1,
  createPositions: !envVars.DONT_CREATE_POSITIONS
};

export default config;

export const roeChangePercents: number[][] = config.stopLoss.onRoeChange.filter(Array.isArray)
  .filter(arr => arr.length > 0)
  .sort((a, b) => b[0] - a[0]);
