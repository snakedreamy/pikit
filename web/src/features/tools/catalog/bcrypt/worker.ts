import {
  generateBcryptHashSync,
  verifyBcryptHashSync,
  type BcryptGenerateOutput,
  type BcryptVerifyOutput,
} from './logic';

export type BcryptWorkerRequest =
  | { id: number; op: 'generate'; password: string; rounds: number; username: string }
  | { id: number; op: 'verify'; password: string; hash: string };

export type BcryptWorkerResponse =
  | { id: number; op: 'generate'; result: BcryptGenerateOutput }
  | { id: number; op: 'verify'; result: BcryptVerifyOutput };

self.onmessage = (ev: MessageEvent<BcryptWorkerRequest>) => {
  const msg = ev.data;
  if (msg.op === 'generate') {
    const result = generateBcryptHashSync(msg.password, msg.rounds, msg.username);
    const reply: BcryptWorkerResponse = { id: msg.id, op: 'generate', result };
    self.postMessage(reply);
  } else {
    const result = verifyBcryptHashSync(msg.password, msg.hash);
    const reply: BcryptWorkerResponse = { id: msg.id, op: 'verify', result };
    self.postMessage(reply);
  }
};
