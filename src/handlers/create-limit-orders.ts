import config from "../../lib/config/config";
import EventContext from "../../lib/context/event";
import errorHandler from "../../lib/utils/error-handler";
import { UnexpectedBehaviourError } from "../../lib/utils/errors";
import { TasksTPSL, retryAsync, setLimitOrders, setTPSL } from "../../lib/utils/utils";

export default async (ctx: EventContext, _symbol: string, side: 'BUY' | 'SELL', amount: number, entryPrice: number) => {
  try {
    const posSide = side === 'BUY' ? 'LONG' : 'SHORT'
    console.log(entryPrice)
    await retryAsync(() => setLimitOrders(ctx, { posSide, entryPrice, amount }, true), 15, 1000)

    const slTpTasks: TasksTPSL[] = [[config.stopLoss.onPositionOpen, true, 'entry', entryPrice], [config.takeProfit.onPositionOpen, false, 'entry', entryPrice]]
    const position = ctx.positions?.find(p => p.side === side)
    if (!position) throw new UnexpectedBehaviourError('NO_POSITION', ctx)
    console.log(position)
    await retryAsync(() => setTPSL(ctx, position, slTpTasks), 15, 1000)

  } catch (err) {
    if (errorHandler.isTrustedError(err)) {
      errorHandler.handleError(err);
      return;
    }
    throw err;
  }
} 
