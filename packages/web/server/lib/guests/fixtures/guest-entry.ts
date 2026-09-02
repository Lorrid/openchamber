import { connectHost } from '@openchamber/sdk';

const host = connectHost();
void host.toast({ kind: 'info', message: 'HELLO-1' });
