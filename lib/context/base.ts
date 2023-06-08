'use strict';

import type BinanceClient from "../binance-client";
import { binanceErrorSchema } from "../config/consts";
import errorHandler from "../utils/error-handler";
import { BinanceError } from "../utils/errors";

export default class Context {
  public client: BinanceClient;

  constructor(client: BinanceClient) {
    this.client = client;
  }

  get api() {
    return this.client.api;
  }

  async requestApi(apiPath: string, ...opts: any) {
    try {
      const [response]: any = await this.api.request(apiPath, ...opts);
      const isErrorObject = !binanceErrorSchema.validate(response).error;
      if (isErrorObject) throw new BinanceError(`Failed to fetch '${apiPath}'`, this, response, opts);
      return response;
    } catch (err: unknown) {
      if (errorHandler.isTrustedError(err)) {
        errorHandler.handleError(err);
        return null;
      }
      throw err;
    }
  }

  toJSON() {
    return {};
  }
}
