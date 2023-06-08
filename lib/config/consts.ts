'use strict';

import * as Joi from 'joi';

export const REST_PROD_URI = 'https://fapi.binance.com';
export const REST_TESTNET_URI = 'https://testnet.binancefuture.com';
export const defaultReqOpts = { body: {}, method: 'GET', headers: {} };

export const API_ENDPOINTS = {
  exchangeInfo: 'fapi/v1/exchangeInfo',
  positions: 'fapi/v2/positionRisk',
  orders: 'fapi/v1/openOrders',
  balances: 'fapi/v2/balance',
  markPrice: 'fapi/v1/ticker/price',
  createOrder: 'fapi/v1/order',
  cancelAllOrders: 'fapi/v1/allOpenOrders',
  cancelOrder: 'fapi/v1/order',
  serverTime: 'fapi/v1/time'
};

export const binanceErrorSchema = Joi.object({
  code: Joi.number().negative().integer(),
  msg: Joi.string(),
});

export const DEFAULT_LEVERAGE = 10;

export const ASSETS = ['BTC', 'BNB', 'ETH', 'USDT', 'USDC', 'BUSD'];
