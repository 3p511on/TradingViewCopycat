import qs, { ParsedUrlQueryInput } from 'node:querystring';
import { fetch, Response } from 'undici';
import type BinanceClient from './binance-client';
import config from './config/config';
import { API_ENDPOINTS, REST_PROD_URI, REST_TESTNET_URI } from './config/consts';
import type EventContext from './context/event';
import type GlobalContext from './context/global';
import errorHandler from './utils/error-handler';
import { encryptMessage, parseResponse, retryAsync } from './utils/utils';

interface FetchOpts {
  body?: ParsedUrlQueryInput;
  method?: string;
  headers?: Record<string, string>;
}

export default class RestApi {
  public client: BinanceClient;

  constructor(client: BinanceClient) {
    this.client = client;
  }

  get uri() {
    return config.isDevEnvironment ? REST_TESTNET_URI : REST_PROD_URI;
  }

  async rawRequest(apiPath: string, opts?: FetchOpts): Promise<Response | null> {
    try {
      // Append public API key to headers
      const { body = {}, method = "GET", headers = {} } = opts ?? {};
      Object.assign(headers, { 'X-MBX-APIKEY': config.binance.key });

      // Encode request body in uri-qs and encrypt for auth
      const params = qs.stringify({ ...body, timestamp: Date.now() });
      const signature = encryptMessage(config.binance.secret, params);
      const uri = `${this.uri}/${apiPath}?${params}&signature=${signature}`;
      // Carry out request
      const response = await fetch(uri, { method, headers });

      return response;
    } catch (err: unknown) {
      if (errorHandler.isTrustedError(err)) {
        errorHandler.handleError(err)
        return null
      }
      throw err

    }
  }

  async cancelOrder(ctx: GlobalContext | EventContext, symbol: string, orderId: number) {
    const body = { symbol, orderId }
    const opts = { body, method: 'DELETE' }
    const response = await ctx.requestApi(API_ENDPOINTS.cancelOrder, opts)
    return response
  }

  async request(apiPath: string, opts?: FetchOpts): Promise<any> {
    try {
      const rawResponse: any = await retryAsync<Response | null>(() => this.rawRequest(apiPath, opts), 15, 2000)
      const response: any = await parseResponse(rawResponse);
      return [response, rawResponse, opts];
    } catch (err: unknown) {
      if (errorHandler.isTrustedError(err)) {
        errorHandler.handleError(err);
        return null
      }
      throw err;
    }
  }
}
