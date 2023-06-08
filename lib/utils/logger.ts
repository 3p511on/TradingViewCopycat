'use strict';

import * as winston from 'winston';
import Sentry from 'winston-transport-sentry-node';
import config from '../config/config';

const customLevels = {
  levels: {
    trace: 5,
    debug: 4,
    info: 3,
    warn: 2,
    error: 1,
    fatal: 0,
  },
  colors: {
    trace: 'white',
    debug: 'green',
    info: 'green',
    warn: 'yellow',
    error: 'red',
    fatal: 'red',
  },
};

const sentryOpts = {
  sentry: config.sentry,
  skipSentryInit: true,
  customLevels: customLevels.levels,
  level: 'error'
}

const formatter = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.splat(),
  winston.format.printf((info: any) => {
    const { timestamp, level, message, ...meta } = info;
    delete meta.stack;

    const limitArrayElements = (value: any, limit: number) => {
      if (Array.isArray(value)) {
        return value.slice(0, limit);
      }
      return value;
    };

    const replacer = (_key: any, value: any) => {
      const limitedValue = limitArrayElements(value, 10);
      return typeof limitedValue?.toJSON === 'function' ? limitedValue.toJSON() : limitedValue;
    };

    const stringifiedMeta = Object.keys(meta).length ? JSON.stringify(meta, replacer, 2) : '';

    return `${timestamp}\t[${level}]: ${message}${stringifiedMeta}`;
  }),
);

class Logger {
  private logger: winston.Logger;

  constructor() {
    const prodTransport = new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
    });
    const transport = new winston.transports.Console({
      format: formatter,
    });
    this.logger = winston.createLogger({
      level: config.isIntegration ? 'trace' : 'error',
      levels: customLevels.levels,
      transports: [config.isIntegration ? transport : prodTransport, new Sentry(sentryOpts)],
    });
    winston.addColors(customLevels.colors);
  }

  trace(msg: string, meta?: any) {
    this.logger.log('trace', msg, meta);
  }

  debug(msg: string, meta?: any) {
    this.logger.debug(msg, meta);
  }

  info(msg: string, meta?: any) {
    this.logger.info(msg, meta);
  }

  warn(msg: string, meta?: any) {
    this.logger.warn(msg, meta);
  }

  error(msg: string, meta?: any) {
    this.logger.error(msg, meta);
  }

  fatal(msg: string, meta?: any) {
    this.logger.log('fatal', msg, meta);
  }
}

export const logger = new Logger();
