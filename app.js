'use strict';

require('./loadEnv')();

const debug = require('debug')('Router');
const express = require('express');
const client = require('./binance');
const app = express();

app.use(express.text());

app.post('/webhook/:password', (req, res) => {
  try {
    const { password } = req.params;
    if (password !== process.env.WEBHOOK_PASSWORD) {
      debug('Got request, password is not correct', password);
      throw new Error('Password incorrect');
    }
    const [symbol, type, isTakeProfit] = req.body.split(' ');
    const side = type === 'LONG' ? 'BUY' : 'SELL';
    debug('Body:', req.body);
    debug(`Symbol: ${symbol} | Side: ${side}, | Is take profit: ${isTakeProfit}`);
    const args = [client, symbol, side];
    if (isTakeProfit) client.emit('takeProfit', ...args);
    else client.emit('openPosition', ...args);
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
