import '../lib/config/load-env';

import express from 'express';
import config from '../lib/config/config';
import { logger } from '../lib/utils/logger';
import client from './index';

console.log(config)

const app = express();

app.use(express.text());

app.post('/webhook/:password', (req, res) => {
  try {
    const { password } = req.params;
    if (password !== config.webhookPassword) {
      logger.info('Got request, password is not correct', password);
      throw new Error('Password incorrect');
    }
    const [symbol, type, thirdArgument] = req.body.split(' ');
    const isTakeProfit = thirdArgument && isNaN(+thirdArgument)
    const tickPrice = thirdArgument && !isNaN(+thirdArgument) ? +thirdArgument : null
    const side = type === 'LONG' ? 'BUY' : 'SELL';
    logger.info(`Body: ${req.body}`);
    logger.info(`Symbol: ${symbol} | Side: ${side}, | Is take profit: ${isTakeProfit ? 'YES' : "NO"} | TickPrice: ${tickPrice}`);
    const args = [symbol, side];
    if (isTakeProfit) client.emit('takeProfit', ...args);
    else client.emit('openPosition', ...args, tickPrice);
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).send('Error');
  }
});

const port = process.env.PORT || 3030;
app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
