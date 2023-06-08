'use strict';

import * as Sentry from '@sentry/node';
import config from '../config/config';
import { BaseError } from './errors';
import { logger } from './logger';

Sentry.init({
  dsn: config.sentry.dsn,
  tracesSampleRate: 1.0,
  integrations: [
    new Sentry.Integrations.Http({ tracing: true }),
  ],
  attachStacktrace: true,
  includeLocalVariables: true,
  normalizeDepth: 10
});

class ErrorHandler {
  handleError(err: unknown) {
    logger.error('[ErrorHandler]', err);
    Sentry.captureException(err,);
  }

  isTrustedError(error: unknown) {
    if (error instanceof BaseError) {
      return error?.isOperational;
    }
    return false;
  }
}

export default new ErrorHandler();
