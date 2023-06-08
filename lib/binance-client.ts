import { WebsocketClient } from 'binance';
import { CronJob } from 'cron';
import EventEmitter from 'node:events';
import Order from './components/Order';
import config from './config/config';
import EventContext from './context/event';
import GlobalContext from './context/global';
import RestApi from './rest';
import errorHandler from './utils/error-handler';
import { UnexpectedBehaviourError } from './utils/errors';
import { logger } from './utils/logger';

const EventNamesIgnoreCtx = ['ready']

export default class BinanceClient extends EventEmitter {
  public positionsHistory: {
    [symbol: string]: number
  };
  public cycle: {
    [symbol: string]: string[]
  };
  public extraHistory: {
    [symbol: string]: number
  };
  public slHistory: {
    [symbol: string]: {
      orderId: number;
      percentIndex: number;
    }
  };
  public orderFilledCheck: {
    [symbol: string]: {
      orderId: number;
      amount: number;
      entryPrice: number;
    }
  }
  public globalContext: GlobalContext;
  public roeCronJob: CronJob;
  public startServerTime: number;
  public serverTimeFetched: number;
  public wsClient: WebsocketClient;
  public inProcess: string[];
  public listening: string[];


  constructor() {
    super();
    /** История созданных количества созданных позиций по символам */
    this.positionsHistory = {};
    /** Цикл полученных сигналов. Сколько требуется ТП для полного закрытия? */
    this.cycle = {};
    /** История установленных SL */
    this.slHistory = {};
    this.extraHistory = {}
    this.orderFilledCheck = {}

    /** Глобальный контект для долгоактивных данных */
    this.globalContext = new GlobalContext(this);

    this.roeCronJob = new CronJob('*/30 * * * * *', () => this.getRoe())
    this.startServerTime = 0
    this.serverTimeFetched = 0
    this.wsClient = new WebsocketClient({
      api_key: config.binance.key,
      api_secret: config.binance.secret,
      beautify: true,
    })
    this.inProcess = []
    this.listening = []

    this.init();
  }

  get api() {
    return new RestApi(this);
  }

  /**
   * Получение информации о всех парах на рынке и
   * сохранение в глобальный контекст
   * @event 'ready'
   */
  async init() {
    await this.globalContext.fetchExchangeInfo();
    if (config.onlyPnl) {
      await this.loadPositionsChecker()
      await this.globalContext.getPositions(true)
      await this.globalContext.getOrders(true)
    }

    const { wsClient } = this

    // notification when a connection is opene

    // receive formatted events with beautified keys. Any "known" floats stored in strings as parsed as floats.
    wsClient.on('formattedMessage', (data: any) => {

      if (config.onlyPnl) {
        if (data?.eventType === 'markPriceUpdate') this.onMarkPriceUpdate(data)
        else if (data?.eventType === 'ACCOUNT_UPDATE') this.onAccountChange(data)
        else if (data?.eventType === 'ORDER_TRADE_UPDATE') this.onOrdersChange(data)
      } else {
        if (data?.eventType === 'ORDER_TRADE_UPDATE') {
          const isFulfilled = data.order.orderStatus === 'FILLED'
          if (!isFulfilled) return
          logger.info(`Order is filled`, data.order)
          const saved = this.orderFilledCheck[data.order.symbol]
          if (saved?.orderId !== data.order.orderId) {
            logger.warn('Ордер не сохранен')
            return
          }
          this.emit('createLimitOrders', data.order.symbol, data.order.orderSide, data.order.originalQuantity, saved?.entryPrice)
        }
      }
    });

    // Recommended: receive error events (e.g. first reconnection failed)
    wsClient.on('error', (data) => {
      console.log('ws saw error ', data?.wsKey);
    });

    wsClient.subscribeUsdFuturesUserDataStream(config.isDevEnvironment);

    this.emit('ready', '');
  }

  async onAccountChange(data: any) {
    try {
      const { updateData: { updatedPositions } } = data
      if (updatedPositions) {
        logger.info(`Обновление позиций`, updatedPositions)
        for (const pos of updatedPositions) {
          delete this.slHistory[pos.symbol]
          if (pos.positionAmount && !this.listening.includes(pos.symbol)) {
            this.wsClient.subscribeMarkPrice(pos.symbol, 'usdm', 3000)
            this.listening.push(pos.symbol)
          }
        }
        await this.globalContext.getOpenedPositions(true)
      }
    } catch (err: any) {
      logger.error(err)
    }
  }

  async onOrdersChange(data: any) {
    try {
      const { order } = data
      const { symbol, orderType } = data
      const { orders } = this.globalContext.cache
      if (order) {
        logger.info(`Обновление ордеров`, { symbol, orderType })
        if (order.executionType === 'CANCELED' || order.executionType === 'EXPIRED') {
          const index = orders.findIndex((cachedOrder) => cachedOrder.id === order.orderId);
          if (index !== -1) {
            orders.splice(index, 1);
          }
        } else {
          // Update the existing order in the local cache or add the new order
          const existingOrderIndex = orders.findIndex((cachedOrder) => cachedOrder.id === order.orderId);
          if (existingOrderIndex !== -1) {
            orders[existingOrderIndex]?.update(data);
          } else {
            const newOrder = new Order(this.globalContext)
            newOrder.update(data)
            orders.push(newOrder);
          }
        }
      }
    } catch (err: any) {
      logger.error(err)
    }
  }

  async onMarkPriceUpdate(data: any) {
    try {
      const position = this.globalContext.cache.positions.opened?.find(p => p.symbol === data?.symbol)
      if (!position) return
      position.markPrice = data.markPrice

      const { roeSlPercent, roeSlPercentIndex } = position
      if (roeSlPercent === undefined || !Array.isArray(roeSlPercent)) return

      if (this.inProcess.includes(position.symbol)) return

      const { orders } = this.globalContext.cache
      const slHistory = this.slHistory[position.symbol]
      if (slHistory) {
        const slOrders = orders.filter(o => o.isStopLoss)
        const isOrderSetByRoe = slOrders.find(o => o.id === slHistory.orderId)
        const roeGreater = slHistory.percentIndex > roeSlPercentIndex
        if (!(!isOrderSetByRoe || roeGreater)) {
          // const historyPercent = roeChangePercents[slHistory.percentIndex]
          // @ts-ignore
          // logger.debug(`Пропуск ROE для ${symbol} - ${roe * 100}% - уже был установлен SL по проценту ${historyPercent[0] * 100}% (${slHistory.orderId})`)
          return
        }
      }
      console.log(orders.map(o => `${o.id} - ${o.symbol} - ${o.type} - ${o.posSide} - ${o.stopPrice}`))
      this.emit('roe', position)
      this.inProcess.push(position.symbol)
      setTimeout(() => this.inProcess = this.inProcess.filter(s => s !== position.symbol), 10000)
      console.log('GOOD', position.symbol, position.roe * 100, roeSlPercent)
    } catch (err: any) {
      logger.error(err)
    }

  }

  async loadPositionsChecker() {
    const positions = await this.globalContext.getOpenedPositions()
    if (!positions) throw new UnexpectedBehaviourError('NO_POSITIONS', this.globalContext)
    console.log(positions?.map(p => p.symbol))
    for (const position of positions) {
      this.wsClient.subscribeMarkPrice(position.symbol, 'usdm', 3000)
      this.listening.push(position.symbol)
    }
  }

  get serverTime(): number {
    const delta = Date.now() - this.serverTimeFetched
    return delta + this.startServerTime
  }

  override emit(eventName: string | symbol, ...data: any[]): boolean {
    eventName = eventName.toString()
    if (EventNamesIgnoreCtx.includes(eventName)) {
      super.emit(eventName, ...data)
      return true
    }
    const symbol = data.shift()
    const ctx = new EventContext(this, eventName, symbol, ...data);
    ctx.initEventCtx().then(() => {
      if (symbol && !this.cycle[symbol]) this.cycle[symbol] = [];
      if (symbol && this.extraHistory[symbol] === undefined) this.extraHistory[symbol] = 0
      super.emit(eventName, ctx, symbol, ...data);
    });
    return true;
  }

  async getRoe() {
    try {
      const { globalContext } = this
      const openedPositions = await globalContext.getOpenedPositions(true)
      if (!openedPositions) throw new UnexpectedBehaviourError('GLOBAL_NO_POSITIONS', globalContext)
      for (const position of openedPositions) {
        this.emit('roe', position.symbol, position.side)
      }
    } catch (err) {
      if (errorHandler.isTrustedError(err)) {
        errorHandler.handleError(err)
        return
      }
      console.error(err)
      // throw err
    }
  }

  isFirstEvent(symbol: string) {
    const cycle = this.cycle[symbol];
    return !cycle?.length;
  }

  isCompleteCycle(symbol: string) {
    const cycle = this.cycle[symbol];
    return cycle?.length && cycle?.length >= config?.fullCycleSize;
  }

  toJSON() {
    const { positionsHistory, cycle, slHistory } = this
    return { positionsHistory, cycle, slHistory }
  }
}
