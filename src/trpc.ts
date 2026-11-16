import { makeTRPCClient } from '@the-reunited-pieces/dexcom-api';

export const trpc = makeTRPCClient(process.env.TRPC_URL!);
