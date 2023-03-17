'use strict';

module.exports = class BinanceError extends Error {
  constructor(message, body) {
    super(message);
    this.name = 'BinanceError';
    this.body = body;
    this.code = body?.code;
    this.errorMessage = body?.msg;
  }
};
