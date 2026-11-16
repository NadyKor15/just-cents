// Pages Function: full files are never served directly; they go out only through /full/ after payment.
import { json } from '../../worker/index';

export const onRequest = () => json({ ok: false, reason: 'pay first: /full/<offer>?net=…&txid=…' }, 402);
