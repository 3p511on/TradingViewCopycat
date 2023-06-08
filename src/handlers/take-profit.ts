import config from "../../lib/config/config";
import type EventContext from "../../lib/context/event";
import errorHandler from "../../lib/utils/error-handler";
import { UnexpectedBehaviourError } from "../../lib/utils/errors";
import { logger } from "../../lib/utils/logger";
import { addHistory, calcPartCloseQuantity, setTPSL, TasksTPSL } from "../../lib/utils/utils";

export default async (ctx: EventContext, symbol: string, side: 'BUY' | 'SELL') => {
  try {
    const { openedPositions, client } = ctx;

    // Нет открытых позиций
    if (!Array.isArray(openedPositions) || !openedPositions.length) throw new UnexpectedBehaviourError('NO_POSITIONS', ctx)

    // Цикл не начался - игнор
    if (client.isFirstEvent(symbol)) {
      throw new UnexpectedBehaviourError('CYCLE_NOT_STARTED', ctx)
    }

    // Больше, чем 1 открытая позиция - ошибка
    if (openedPositions.length !== 1) {
      throw new UnexpectedBehaviourError('TP_TWO_POSITIONS', ctx)
    }

    const position = openedPositions.find(p => p.side === side)
    if (!position) {
      throw new UnexpectedBehaviourError('TP_NO_POSITION', ctx)
    }

    // Номер ТП больше ожидаемых - выход
    if (client.isCompleteCycle(symbol)) {
      throw new UnexpectedBehaviourError('TP_COMPLETE_CYCLE', ctx)
    }

    const [quantity, percent] = calcPartCloseQuantity(ctx, position)
    await position.close(quantity)
    addHistory(ctx)
    logger.info(`Частичное закрытие позиции ${symbol} [${side}] на ${quantity} (${percent ? percent : 0 * 100}%)`)

    // Установлено в конфиге СЛ/ТП - установить их доп.
    // TODO: Считать от entryPrice или markPrice?
    const slTpTasks: TasksTPSL[] = [[config.stopLoss.onTakeProfit, true, 'entry'], [config.takeProfit.onTakeProfit, false, 'entry']]
    await setTPSL(ctx, position, slTpTasks)
  } catch (err) {
    if (errorHandler.isTrustedError(err)) {
      errorHandler.handleError(err);
      return;
    }
    throw err;
  }
}
