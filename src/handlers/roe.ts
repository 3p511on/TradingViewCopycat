import type Position from "../../lib/components/Position";
import type EventContext from "../../lib/context/event";
import errorHandler from "../../lib/utils/error-handler";
import { UnexpectedBehaviourError } from '../../lib/utils/errors';
import { setTPSL, TasksTPSL } from '../../lib/utils/utils';

export default async (ctx: EventContext, position: Position) => {
  try {
    const { client } = ctx

    const { roeSlPercent, roeSlPercentIndex } = position

    // @ts-ignore
    const slTpTasks: TasksTPSL[] = [[roeSlPercent[1], true, 'mark']]

    const [createdOrder] = await setTPSL(ctx, position, slTpTasks)
    if (!createdOrder) {
      throw new UnexpectedBehaviourError('NO_CREATED_SL', ctx)
    }
    client.slHistory[position.symbol] = { percentIndex: roeSlPercentIndex, orderId: createdOrder.id }
  } catch (err) {
    if (errorHandler.isTrustedError(err)) {
      errorHandler.handleError(err);
      return;
    }
    throw err;
  }
}
