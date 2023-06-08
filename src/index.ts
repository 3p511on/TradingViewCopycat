import BinanceClient from '../lib/binance-client';
import config from '../lib/config/config';
import errorHandler from '../lib/utils/error-handler';
import { logger } from '../lib/utils/logger';
import createLimitOrders from './handlers/create-limit-orders';
import openPositionHandler from './handlers/open-position';
import roeHandler from './handlers/roe';
import takeProfitHandler from './handlers/take-profit';

const client = new BinanceClient();

client.on('ready', async () => {
  const { exchangeInfo } = client.globalContext.cache
  if (!exchangeInfo) throw new TypeError('Exchange info не найдено')
  const symbols = exchangeInfo.symbols.length;
  logger.info(`Клиент успешно запущен. Загружено ${symbols} доступных символов `);

  if (config.env === 'development') {
    client.emit('openPosition', 'BTCUSDT', 'BUY', 27569)
    // await sleep(20000)
    // client.emit('openPosition', 'ETHUSDT', 'SELL')
    // await sleep(20000)
    // client.emit('openPosition', 'ETHUSDT', 'SELL') // - Инорy 
    // await sleep(3000)
    // client.emit('openPosition', 'ETHUSDT', 'SELL') // Ставиьт
    // await sleep(3000)
    // client.emit('openPosition', 'ETHUSDT', 'SELL') // Игнор
    // await sleep(5000)
    // client.emit('openPosition', 'ETHUSDT', 'SELL') // Ставить
  }

});

if (!config.onlyPnl) {
  client.on('openPosition', openPositionHandler);
  client.on('takeProfit', takeProfitHandler)
  client.on('createLimitOrders', createLimitOrders)
}

if (config.onlyPnl) client.on('roe', roeHandler)

process.on('unhandledRejection', (reason) => {
  throw reason;
});

process.on('uncaughtException', (error: unknown) => {
  errorHandler.handleError(error);
  if (!errorHandler.isTrustedError(error)) {
    process.exit(1);
  }
});

export default client
