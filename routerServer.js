'use strict';

const express = require('express');
const httpProxy = require('http-proxy');
const settings = require('./routerSettings.json');

const app = express();
const apiProxy = httpProxy.createProxyServer();

app.all('/webhook/:key', (req, res) => {
  try {
    if (!req?.params?.key) throw new Error('No key');
    const { key } = req.params;
    const redirectPort = settings[key];
    if (!redirectPort) throw new Error(`No redirect port for key "${key}"`);
    const target = `http://localhost:${redirectPort}`;
    console.log(`Got key: ${key}. Redirecting to ${target}`);
    return apiProxy.web(req, res, { target });
  } catch (err) {
    console.error(err?.message ?? err);
    return res.status(500).send('Error');
  }
});

app.listen(80, () => {
  console.log(`app listening`);
});
